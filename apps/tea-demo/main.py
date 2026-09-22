import json
from pathlib import Path
from xr_ai_launcher import Process, run_stack

APP = Path(__file__).resolve().parent

def run():
    models = json.loads((APP / "yaml/models.json").read_text())["models"]
    processes = []
    if models["vlm"]["endpoint"]["base_url"] == "http://127.0.0.1:8100":
        processes.append(Process("camera-model", "../local-vlm/worker", "local_vlm_model"))
    processes.extend([
        Process("tea-retrieval", ".", "rag_service", config="yaml/rag.yaml"),
        Process("tea-agent", ".", "tea_making_worker", config="yaml/worker.yaml"),
    ])
    run_stack(processes, APP)

if __name__ == "__main__":
    run()
