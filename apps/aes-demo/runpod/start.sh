#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export HF_HOME=/workspace/models HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DOWNLOAD_TIMEOUT=120
export XDG_CACHE_HOME=/workspace/cache/aes TORCHINDUCTOR_CACHE_DIR=/workspace/cache/aes/torchinductor
export AES_ENVS=${AES_ENVS:-/opt/aes-envs}
export CUDA_HOME="$AES_ENVS/omni/lib/python3.12/site-packages/nvidia/cu13"
export PATH="$CUDA_HOME/bin:$PATH"
export MAX_JOBS=2 FLASHINFER_NVCC_THREADS=1
mkdir -p /workspace/logs/aes /workspace/cache/aes
start() {
 local name=$1 exe=$2 port=$3
 if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
  if python3 - "$PWD/$name.yaml" "$AES_ENVS/$name/bin/" <<'CHECK'
import sys
from pathlib import Path
for proc in Path('/proc').iterdir():
 if not proc.name.isdigit(): continue
 try:
  args=(proc/'cmdline').read_bytes().decode().split('\0')
  if args[0].startswith(sys.argv[2]) and sys.argv[1] in args:
   sys.exit(0)
 except (OSError,UnicodeError): pass
sys.exit(1)
CHECK
  then echo "$name already healthy (AES deployment)"; return; fi
  echo "Port $port belongs to another deployment; stop it first" >&2; exit 1
 fi
 PATH="$AES_ENVS/$name/bin:$PATH" nohup "$AES_ENVS/$name/bin/$exe" --config "$PWD/$name.yaml" >"/workspace/logs/aes/$name.log" 2>&1 </dev/null &
 local pid=$!
 echo "$pid" > "/workspace/logs/aes/$name.pid"
 for ((i=0;i<600;i++)); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then echo "$name healthy"; return; fi
  kill -0 "$pid" 2>/dev/null || { tail -60 "/workspace/logs/aes/$name.log"; exit 1; }
  sleep 2
 done
 echo "$name startup timed out" >&2; exit 1
}
if [[ $# -eq 0 ]]; then set -- omni stt tts; fi
for service in "$@"; do
 case "$service" in
  omni) start omni nemotron_omni_llm_server 8108 ;;
  stt) start stt stt_server 8103 ;;
  tts) start tts pocket_tts_server 8105 ;;
  *) echo "Unknown service: $service" >&2; exit 1 ;;
 esac
done
