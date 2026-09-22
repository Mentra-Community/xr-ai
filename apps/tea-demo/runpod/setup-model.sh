#!/usr/bin/env bash
set -euo pipefail
mkdir -p /workspace/xr-ai
if [[ ! -f /workspace/xr-ai/services/nemotron-omni-llm/pyproject.toml ]]; then
  tar -xzf /workspace/xr-ai-source.tar.gz -C /workspace/xr-ai
fi
python -m venv /opt/xr-env
/opt/xr-env/bin/pip install --no-cache-dir uv
/opt/xr-env/bin/uv pip install --python /opt/xr-env/bin/python --no-cache \
  -e /workspace/xr-ai/utils/xr-ai-logging \
  -e /workspace/xr-ai/utils/xr-ai-vllm \
  -e /workspace/xr-ai/services/nemotron-omni-llm 'vllm==0.27.1' \
  'nvidia-cuda-nvcc==13.0.88' 'nvidia-cuda-crt==13.0.88' 'nvidia-nvvm==13.0.88'
/opt/xr-env/bin/uv pip install --python /opt/xr-env/bin/python --no-cache --no-deps \
  'flashinfer-jit-cache==0.6.16.post3+cu130' --index-url https://flashinfer.ai/whl/cu130
# FlashInfer expects the toolkit layout rather than the wheel's library names.
cuda_root=/opt/xr-env/lib/python3.12/site-packages/nvidia/cu13
ln -sfn lib "$cuda_root/lib64"
for library in libcudart libcublas libcublasLt; do
  ln -sfn "$library.so.13" "$cuda_root/lib/$library.so"
done
echo XR_OMNI_INSTALL_COMPLETE
