"""Exercise the configured model services through the repository's typed clients."""
import argparse
import asyncio
import io
import json
import math
import time
from pathlib import Path

from PIL import Image, ImageDraw
from xr_ai_models import (
    ChatMessage, load_models_config, make_embedding, make_llm, make_stt,
    make_tts, make_vlm,
)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).parents[1] / "yaml/models.runpod.json")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--idle-seconds", type=float, default=60)
    parser.add_argument("--report", type=Path, default=Path(__file__).parents[1] / "artifacts/runpod-service-check.json")
    args = parser.parse_args()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    config = load_models_config(args.config)
    services = {name: factory(config, name) for name, factory in (
        ("llm", make_llm), ("vlm", make_vlm), ("stt", make_stt),
        ("tts", make_tts), ("embedding", make_embedding),
    )}
    report = {"config": str(args.config), "checks": [], "passed": False}

    async def check(name, action):
        started = time.monotonic()
        value = await action()
        record = {"name": name, "seconds": round(time.monotonic() - started, 3), "result": value}
        report["checks"].append(record)
        print(json.dumps(record), flush=True)
        return value

    try:
        for name, service in services.items():
            async def health(service=service):
                assert await service.health(), "Service is unhealthy"
                return "healthy"
            await check(name + ".health", health)

        async def embedding():
            vectors = await services["embedding"].embed(["query: tea preparation", "passage: Steep tea in hot water."])
            assert len(vectors) == 2 and all(len(v) == 2048 for v in vectors)
            assert all(math.isfinite(x) for v in vectors for x in v)
            return {"vectors": 2, "dimensions": 2048}
        await check("embedding.request", embedding)

        async def vision():
            image = Image.new("RGB", (320, 160), "white")
            draw = ImageDraw.Draw(image)
            for x in (30, 130, 230):
                draw.ellipse((x, 40, x + 60, 100), fill="red")
            encoded = io.BytesIO()
            image.save(encoded, format="PNG")
            (args.report.parent / "service-test-image.png").write_bytes(encoded.getvalue())
            response = await services["vlm"].ask_image(encoded.getvalue(), "How many red circles are shown? Reply with only the number.", max_tokens=16)
            assert response.content.strip().lower().rstrip(".") in {"3", "three"}, response.content
            return response.content.strip()
        await check("vlm.image", vision)

        for round_number in range(args.rounds):
            if round_number:
                print(f"Idle for {args.idle_seconds:g}s before round {round_number + 1}", flush=True)
                await asyncio.sleep(args.idle_seconds)
            async def speech_roundtrip():
                audio = await services["tts"].synthesize("What is two plus two?", response_format="wav")
                assert len(audio) > 1000
                (args.report.parent / "service-test-speech.wav").write_bytes(audio)
                transcript = await services["stt"].transcribe(audio)
                assert transcript.strip(), "Empty transcription"
                response = await services["llm"].chat([
                    ChatMessage(role="system", content="Answer in one short sentence."),
                    ChatMessage(role="user", content=transcript),
                ], max_tokens=64, temperature=0, enable_thinking=False)
                assert "4" in response.content or "four" in response.content.lower(), (transcript, response.content)
                return {"audio_bytes": len(audio), "transcript": transcript, "answer": response.content.strip()}
            await check(f"speech_roundtrip.{round_number + 1}", speech_roundtrip)
        report["passed"] = True
    finally:
        await asyncio.gather(*(s.close() for s in services.values()), return_exceptions=True)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
