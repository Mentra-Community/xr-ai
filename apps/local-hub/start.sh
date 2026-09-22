#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! docker info >/dev/null 2>&1; then
  if [[ "$(id -gn)" == docker ]]; then
    echo "Docker is unavailable; start the Docker service first." >&2
    exit 1
  fi
  exec sudo -n -u "$(id -un)" -g docker -- "$PWD/start.sh"
fi
source .env
export XR_AI_SKIP_HWCODEC_CHECK=1
exec ../../services/device-io-hub/.venv/bin/device_io_hub --config "$PWD/device_io_hub.yaml" --ready-file "$PWD/ready"
