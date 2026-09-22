#!/usr/bin/env bash
set -euo pipefail
export CUDA_HOME=/opt/xr-env/lib/python3.12/site-packages/nvidia/cu13
export PATH="/opt/xr-env/bin:$CUDA_HOME/bin:$PATH"
export HF_HOME=/workspace/models
export HF_HUB_DISABLE_TELEMETRY=1
export HF_HUB_DOWNLOAD_TIMEOUT=120
export MAX_JOBS=2
export FLASHINFER_NVCC_THREADS=1
exec nemotron_omni_llm_server --config /workspace/omni.yaml --ready-file /workspace/omni.ready
