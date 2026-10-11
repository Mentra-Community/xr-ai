<!--
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

# AES Mentra deployment

`apps/aes-demo/` configures the stock simple VLM worker and DeviceIOHub for the
Mentra LAN adapter. It changes deployment addresses and model selection only;
backend and sample source remain at NVIDIA main commit
`364c1666a113566c9c973bfd02fa7572ef18fa27` (fetched October 11, 2026).

The laptop runs the hub and stock `simple_vlm_example_worker`. Model requests
use private forwards on ports 18103 (Parakeet), 18105 (Pocket TTS), and 18108
(Nemotron Omni). `yaml/models.json` owns those endpoints. `yaml/worker.yaml`
uses the stock sample's prompt and voice-conversation configuration.

From the repository root, synchronize the stock projects and start the stack:

```bash
uv --config-file uv.toml sync --project services/device-io-hub
uv --config-file uv.toml sync --project agent-samples/simple-vlm-example/worker
bash apps/aes-demo/start-local.sh
```

The launcher reads private `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` values
from `apps/aes-demo/.env`. The bridge adapter must use the same values. Runtime
logs are in `apps/aes-demo/runtime/`.

The companion bridge repository's `aes-demo` branch owns the phone miniapp,
MediaMTX receiver, standalone client adapter, test harness, installation QR,
and full startup/rollback instructions. Its caption viewer subscribes read-only
to the existing local capture IPC topic for its participant. No tea-worker
web-event patch or custom NVIDIA web client is required. This is a pinned
internal-caption integration; revalidate it before changing the upstream ref.

On the existing GPU pod, use the separate `/workspace/xr-ai-aes-demo` checkout:

```bash
bash apps/aes-demo/runpod/setup.sh
bash apps/aes-demo/runpod/start.sh
```

The scripts install isolated environments under `/opt/aes-envs`, use retained
weights under `/workspace/models`, and write logs under `/workspace/logs/aes`.
The CUDA compiler is selected explicitly for Blackwell JIT compilation. The
base deployment and environments under `/workspace/xr-ai` and `/workspace/envs`
remain intact. `/opt` may need reprovisioning after a pod stop.

Stop only this deployment's models with:

```bash
bash apps/aes-demo/runpod/stop.sh
```

The pre-update source is saved on `rollback/pre-aes-demo-20261011` at `66506b28`.
Full local archives and the server source/config archive are listed in the
bridge README. Stop AES processes before restoring the old deployment.
