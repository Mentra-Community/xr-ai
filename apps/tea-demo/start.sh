#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export PATH="$PWD/../local-vlm/deps:$PATH"
export UV_CONFIG_FILE="$PWD/../../uv.toml"
export LOCAL_VLM_BACKEND=vulkan
exec .venv/bin/tea_demo
