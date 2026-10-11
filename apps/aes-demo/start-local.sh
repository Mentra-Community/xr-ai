#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
app="$PWD/apps/aes-demo"
if ! docker info >/dev/null 2>&1; then
  exec sudo -n -u "$(id -un)" -g docker -- "$app/start-local.sh"
fi
set -a
source "$app/.env"
set +a
export XR_AI_SKIP_HWCODEC_CHECK=1
mkdir -p "$app/runtime"
services/device-io-hub/.venv/bin/device_io_hub --config "$app/yaml/hub.yaml" >"$app/runtime/hub.log" 2>&1 &
hub_pid=$!
cleanup() { kill "$hub_pid" "${worker_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for ((i=0;i<60;i++)); do
  kill -0 "$hub_pid" || { tail -40 "$app/runtime/hub.log"; exit 1; }
  if curl -fsS http://127.0.0.1:8080/ >/dev/null; then break; fi
  sleep 1
done
agent-samples/simple-vlm-example/worker/.venv/bin/simple_vlm_example_worker --config "$app/yaml/worker.yaml" >"$app/runtime/worker.log" 2>&1 &
worker_pid=$!
wait -n "$hub_pid" "$worker_pid"
