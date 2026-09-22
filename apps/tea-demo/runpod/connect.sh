#!/usr/bin/env bash
set -euo pipefail
runtime_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# A single supervisor owns all private forwards and reconnects after Wi-Fi loss.
exec 9>"$runtime_dir/tunnel.lock"
flock -n 9 || exit 0
child_pid=""
stop_tunnel() {
  trap - TERM INT
  if [[ -n "$child_pid" ]]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  exit 0
}
trap stop_tunnel TERM INT
while true; do
  ssh -N \
    -i "$HOME/.ssh/xr_ai_runpod" \
    -o IdentitiesOnly=yes -o BatchMode=yes \
    -o UserKnownHostsFile="$HOME/.ssh/xr_ai_runpod_known_hosts" \
    -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
    -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
    -L 127.0.0.1:18103:127.0.0.1:8103 \
    -L 127.0.0.1:18105:127.0.0.1:8105 \
    -L 127.0.0.1:18108:127.0.0.1:8108 \
    -L 127.0.0.1:18109:127.0.0.1:8109 \
    -p "${RUNPOD_SSH_PORT:?Set RUNPOD_SSH_PORT from the resumed pod}" "root@${RUNPOD_SSH_HOST:?Set RUNPOD_SSH_HOST from the resumed pod}" &
  child_pid=$!
  wait "$child_pid" || true
  child_pid=""
  echo "Model tunnel disconnected; retrying in three seconds." >&2
  sleep 3 &
  child_pid=$!
  wait "$child_pid" || true
  child_pid=""
done
