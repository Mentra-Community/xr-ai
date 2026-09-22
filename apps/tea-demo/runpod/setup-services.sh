#!/usr/bin/env bash
set -euo pipefail
export UV_CACHE_DIR=/workspace/cache/uv
export UV_LINK_MODE=hardlink
mkdir -p /workspace/envs /workspace/cache
python3 -m venv /workspace/envs/bootstrap
/workspace/envs/bootstrap/bin/pip install uv
uv_bin=/workspace/envs/bootstrap/bin/uv
repo=/workspace/xr-ai
"$uv_bin" venv --allow-existing /workspace/envs/omni --python python3
"$uv_bin" --config-file "$repo/uv.toml" pip install --python /workspace/envs/omni/bin/python \
  -e "$repo/utils/xr-ai-logging" -e "$repo/utils/xr-ai-vllm" \
  -e "$repo/services/nemotron-omni-llm" -e "$repo/services/embedding-server" \
  'vllm==0.27.1' 'nvidia-cuda-nvcc==13.0.88' 'nvidia-cuda-crt==13.0.88' 'nvidia-nvvm==13.0.88'
"$uv_bin" pip install --python /workspace/envs/omni/bin/python --no-deps \
  'flashinfer-jit-cache==0.6.16.post3+cu130' --index-url https://flashinfer.ai/whl/cu130
cuda_root=/workspace/envs/omni/lib/python3.12/site-packages/nvidia/cu13
ln -sfn lib "$cuda_root/lib64"
for library in libcudart libcublas libcublasLt; do
  ln -sfn "$library.so.13" "$cuda_root/lib/$library.so"
done
UV_PROJECT_ENVIRONMENT=/workspace/envs/stt "$uv_bin" --config-file "$repo/uv.toml" \
  sync --project "$repo/services/stt-server" --python python3
UV_PROJECT_ENVIRONMENT=/workspace/envs/tts "$uv_bin" --config-file "$repo/uv.toml" \
  sync --project "$repo/services/pocket-tts" --python python3
echo XR_SERVICES_INSTALL_COMPLETE
