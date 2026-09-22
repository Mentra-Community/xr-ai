#!/usr/bin/env bash
set -euo pipefail
cd /workspace/xr-ai/apps/tea-demo/runpod
export HF_HOME=/workspace/models
export HF_HUB_DISABLE_TELEMETRY=1
export HF_HUB_DOWNLOAD_TIMEOUT=120
export XDG_CACHE_HOME=/workspace/cache
export TORCHINDUCTOR_CACHE_DIR=/workspace/cache/torchinductor
export CUDA_HOME=/workspace/envs/omni/lib/python3.12/site-packages/nvidia/cu13
export MAX_JOBS=2 FLASHINFER_NVCC_THREADS=1
mkdir -p /workspace/logs /workspace/cache

start_service() {
  local name=$1 environment=$2 executable=$3 config=$4 port=$5
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
    echo "$name already healthy"
    return
  fi
  local service_path="/workspace/envs/$environment/bin:$CUDA_HOME/bin:$PATH"
  PATH="$service_path" nohup "/workspace/envs/$environment/bin/$executable" \
    --config "$PWD/$config" >"/workspace/logs/$name.log" 2>&1 </dev/null &
  local launcher_pid=$!
  for ((attempt=0; attempt<450; attempt++)); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      echo "$name healthy on $port"
      return
    fi
    if ! kill -0 "$launcher_pid" 2>/dev/null; then
      echo "$name exited before becoming healthy; see /workspace/logs/$name.log" >&2
      return 1
    fi
    sleep 2
  done
  echo "$name startup timed out; see /workspace/logs/$name.log" >&2
  return 1
}

# Reserve Omni's cache before the smaller models allocate their GPU memory.
start_service omni omni nemotron_omni_llm_server omni.yaml 8108
start_service stt stt stt_server stt.yaml 8103
start_service tts tts pocket_tts_server tts.yaml 8105
start_service embedding omni embedding_server embedding.yaml 8109
echo XR_ALL_SERVICES_READY
