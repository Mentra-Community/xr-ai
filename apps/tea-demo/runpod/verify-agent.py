"""Publish test microphone/camera tracks and require a routed agent reply."""
import argparse
import asyncio
import json
import re
import shlex
import time
import wave
from pathlib import Path

from livekit import api, rtc
from PIL import Image


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--expect", required=True)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--idle-seconds", type=float, default=60)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--require-audio", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    env = {}
    for line in (root / "apps/local-hub/.env").read_text().splitlines():
        parts = shlex.split(line)
        if parts and parts[0] == "export":
            key, value = parts[1].split("=", 1)
            env[key] = value
    identity = f"service-check-{time.time_ns()}"
    token = api.AccessToken(env["LIVEKIT_API_KEY"], env["LIVEKIT_API_SECRET"]).with_identity(identity).with_grants(
        api.VideoGrants(room_join=True, room="xr-room")
    ).to_jwt()
    room = rtc.Room()
    replies = asyncio.Queue()
    audible = asyncio.Event()
    receivers = set()
    report = {"participant": identity, "rounds": [], "passed": False}

    @room.on("data_received")
    def received(packet):
        if packet.topic == "agent.response":
            replies.put_nowait(packet.data.decode())

    @room.on("track_subscribed")
    def subscribed(track, publication, participant):
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return

        async def receive_audio():
            stream = rtc.AudioStream(track)
            try:
                async for event in stream:
                    if any(abs(sample) > 100 for sample in event.frame.data):
                        audible.set()
            finally:
                await stream.aclose()

        task = asyncio.create_task(receive_audio())
        receivers.add(task)
        task.add_done_callback(receivers.discard)

    source = video = producer = None
    await room.connect("ws://127.0.0.1:7880", token)
    try:
        with wave.open(str(args.audio), "rb") as audio:
            assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
            rate, pcm = audio.getframerate(), audio.readframes(audio.getnframes())
        source = rtc.AudioSource(rate, 1)
        track = rtc.LocalAudioTrack.create_audio_track("test-microphone", source)
        await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        if args.image:
            image = Image.open(args.image).convert("RGB")
            video = rtc.VideoSource(*image.size)
            track = rtc.LocalVideoTrack.create_video_track("test-camera", video)
            await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA))
            frame = rtc.VideoFrame(*image.size, rtc.VideoBufferType.RGB24, image.tobytes())

            async def produce():
                while True:
                    video.capture_frame(frame)
                    await asyncio.sleep(0.1)
            producer = asyncio.create_task(produce())
        await asyncio.sleep(2)
        for index in range(args.rounds):
            if index:
                await asyncio.sleep(args.idle_seconds)
            while not replies.empty():
                replies.get_nowait()
            audible.clear()
            started = time.monotonic()
            chunk = rate // 50
            padded = bytes(rate * 2) + pcm + bytes(rate * 4)
            for offset in range(0, len(padded), chunk * 2):
                data = padded[offset:offset + chunk * 2].ljust(chunk * 2, b"\0")
                await source.capture_frame(rtc.AudioFrame(data, rate, 1, chunk))
            await source.wait_for_playout()
            reply = await asyncio.wait_for(replies.get(), 40)
            record = {"round": index + 1, "reply": reply, "seconds": round(time.monotonic() - started, 3)}
            report["rounds"].append(record)
            print(json.dumps(record), flush=True)
            assert re.search(args.expect, reply, re.IGNORECASE), reply
            if args.require_audio:
                await asyncio.wait_for(audible.wait(), 30)
                record["return_audio_received"] = True
        report["passed"] = True
    finally:
        if producer:
            producer.cancel()
            await asyncio.gather(producer, return_exceptions=True)
        for task in receivers:
            task.cancel()
        await asyncio.gather(*receivers, return_exceptions=True)
        await room.disconnect()
        if source:
            await source.aclose()
        if video:
            await video.aclose()
        await asyncio.sleep(1)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
