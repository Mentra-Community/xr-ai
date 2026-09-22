<!--
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

# Mentra glasses demo deployment

The application in `apps/tea-demo/` runs the tea worker and retrieval service on
this computer. `apps/local-hub/` runs the hub and web client. Model services run
on a GPU pod, reached through private SSH forwards. The phone bridge is in
[the Mentra bridge repository](https://github.com/Mentra-Community/Mentra-Nvidia-XR-AI-bridge).

## Model services

The tested pod has an RTX PRO 6000 Blackwell with 96 GB VRAM and a persistent
50 GB volume mounted at `/workspace`. Its four services use about 75 GB VRAM
and 37 GB disk after installation and warm-up. Put this checkout at
`/workspace/xr-ai` on the pod, then run:

```sh
bash /workspace/xr-ai/apps/tea-demo/runpod/setup-services.sh
bash /workspace/xr-ai/apps/tea-demo/runpod/start-services.sh
```

The current scripts are qualified for Python 3.12 and CUDA 13. They install
Omni, Parakeet transcription, Pocket TTS, and Nemotron embeddings using the
repository's model servers. Environments, weights, and caches live on the
persistent volume. `setup-model.sh` and `start-model.sh` are older single-model
experiments; use the service scripts above for the complete deployment.

After resuming a stopped pod, run `start-services.sh` again and obtain the
current public SSH address and port from RunPod. On this computer, with the
SSH key at `~/.ssh/xr_ai_runpod`, run:

```sh
export RUNPOD_SSH_HOST=<pod-public-ip>
export RUNPOD_SSH_PORT=<pod-ssh-port>
bash apps/tea-demo/runpod/connect.sh
```

The tunnel reconnects automatically after transient failures. Its host and port
must be updated if RunPod reassigns them. Models bind to pod loopback only;
local ports 18103, 18105, 18108, and 18109 serve transcription, speech,
Omni, and embeddings respectively. `models.json` selects these endpoints.

## Desktop and phone

From the repository root, resolve the desktop projects with the repository's
qualified dependencies:

```sh
uv --config-file uv.toml sync --project services/device-io-hub
uv --config-file uv.toml sync --project apps/tea-demo
```

Create `apps/local-hub/.env` with exported `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` values generated for this deployment. Keep that file
private. Start Docker, then run each of these in a separate terminal:

```sh
bash apps/local-hub/start.sh
bash apps/tea-demo/start.sh
```

Start the bridge receiver and install server as described in its README. Open
`http://localhost:8080/?cameraPairingUrl=http%3A%2F%2Flocalhost%3A3147%2Fpair`
to install and pair the phone from the NVIDIA page. The default desktop identity
is `web-client`; it must match the bridge reply relay's configured identity.

`yaml/worker.yaml` enables exact-frame diagnostic captures under the ignored
`artifacts/` directory. Those files can contain camera images and transcripts;
keep them local. Remove `debug_frames_dir` to disable capture.

## Verification and shutdown

Run `apps/tea-demo/runpod/verify-services.py` with the tea application's Python
environment to check all five model roles and repeated requests after idle.
`verify-agent.py` publishes test audio/video to the local hub; use its `--help`
for input fixtures, expected replies, and return-audio verification. Generated
reports and media fixtures remain in ignored `artifacts/` directories.

Stop the designated pod with RunPod's **Stop** action, keeping its persistent
volume. Do not terminate/delete the pod or its volume. Stopped compute releases
the GPU; retained storage continues to incur storage charges.
