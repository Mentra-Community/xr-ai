#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
export UV_CACHE_DIR=${UV_CACHE_DIR:-/opt/aes-cache} UV_LINK_MODE=hardlink
uv_bin=${UV_BIN:-/workspace/envs/bootstrap/bin/uv}
export AES_ENVS=${AES_ENVS:-/opt/aes-envs}
"$uv_bin" venv --allow-existing "$AES_ENVS/omni" --python python3
"$uv_bin" --config-file "$repo/uv.toml" pip install --python "$AES_ENVS/omni/bin/python" \
 -e "$repo/utils/xr-ai-logging" -e "$repo/utils/xr-ai-vllm" -e "$repo/services/nemotron-omni-llm"
for spec in stt:stt-server tts:pocket-tts; do
 UV_PROJECT_ENVIRONMENT="$AES_ENVS/${spec%%:*}" "$uv_bin" --config-file "$repo/uv.toml" sync --project "$repo/services/${spec#*:}" --python python3
done

"$uv_bin" pip install --python "$AES_ENVS/omni/bin/python" 'nvidia-cuda-nvcc==13.0.88' 'nvidia-cuda-crt==13.0.88' 'nvidia-nvvm==13.0.88'
cuda_root="$AES_ENVS/omni/lib/python3.12/site-packages/nvidia/cu13"
ln -sfn lib "$cuda_root/lib64"
for library in libcudart libcublas libcublasLt; do
 ln -sfn "$library.so.13" "$cuda_root/lib/$library.so"
done

"$uv_bin" pip install --python "$AES_ENVS/omni/bin/python" --no-deps 'flashinfer-jit-cache==0.6.18.post1+cu130' --index-url https://flashinfer.ai/whl/cu130
