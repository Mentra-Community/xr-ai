// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @fileoverview Sample application — JavaScript equivalent of AppModel.swift + ContentView.swift.
 *
 * Wires observable model state to DOM elements using vanilla JS (no framework).
 * All model fields and action names mirror AppModel.swift exactly; DOM bindings
 * replace SwiftUI's @Observable / @Bindable machinery.
 *
 * Shared logic lives in /App/core.js; this file owns only the model instance,
 * the error toast, and the bootstrap call.
 *
 * @module App/app
 */

import {
  $,
  createBaseModel, renderBase,
  enumerateCameras  as _enumerateCameras,
  connect           as _connect,
  disconnect        as _disconnect,
  startAudio        as _startAudio,
  stopAudio         as _stopAudio,
  startCamera       as _startCamera,
  sendCustom        as _sendCustom,
  wireBaseEvents,
} from '/App/core.js';
import { WhepCamera } from './WhepCamera.js';

// ─────────────────────────────────────────────────────────────────────────────
// Model state  (mirrors AppModel.swift field-for-field)
// ─────────────────────────────────────────────────────────────────────────────

const model = {
  ...createBaseModel(),
  /** @type {string|null} Most recent final agent reply text. */
  agentResponse: null,
  transcripts: [],
  cameraSource: null,
  cameraPending: false,
};

// Topics carrying the agent's final text reply. Different samples publish on
// different topics (e.g. simple-vlm-example uses `vlm.response`, xr-render-demo
// uses `agent.response`); both route into the Agent panel and are suppressed
// from the "Received" list.
const AGENT_REPLY_TOPICS = new Set(['agent.response', 'vlm.response']);

let cameraGeneration = 0;
let streamCamera = null;
let streamAudioWanted = false;
let retryTimer = null;
let cancelRetry = null;

function releaseStreamCamera() {
  streamCamera?.close();
  streamCamera = null;
  clearTimeout(retryTimer);
  cancelRetry?.();
  cancelRetry = null;
}

function clearCameraPreview() {
  const videoEl = $('camera-preview');
  videoEl.onresize = null;
  videoEl.srcObject = null;
  videoEl.style.transform = '';
  videoEl.closest('.preview-card').style.aspectRatio = '';
}

function showPublishedCameraPreview() {
  clearCameraPreview();
  const track = model.session?.cameraTrack;
  if (!track) return;

  const videoEl = $('camera-preview');
  const previewCard = videoEl.closest('.preview-card');
  videoEl.srcObject = new MediaStream([track]);

  const updateAspectRatio = () => {
    const settings = track.getSettings();
    const width = videoEl.videoWidth || settings.width;
    const height = videoEl.videoHeight || settings.height;
    if (width && height) {
      previewCard.style.aspectRatio = `${width} / ${height}`;
    }
  };
  videoEl.onresize = updateAspectRatio;
  updateAspectRatio();

  const facingMode = track.getSettings().facingMode ?? '';
  videoEl.style.transform = facingMode === 'user' ? 'scaleX(-1)' : '';
  console.info('Camera preview uses published track settings', track.getSettings());
}

// ─────────────────────────────────────────────────────────────────────────────
// Error toast
// ─────────────────────────────────────────────────────────────────────────────

let _toastTimer = null;

function showError(message) {
  model.lastError = message;
  const toast = $('error-toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    model.lastError = null;
  }, 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render + bound actions
// ─────────────────────────────────────────────────────────────────────────────

function render() {
  renderBase(model);

  const connected = model.connectionState === 'connected';
  const webcamSelected = model.cameraSource === 'webcam';
  const streamSelected = model.cameraSource === 'webrtc';
  model.session?.setAudioPlaybackMuted(streamSelected);
  $('camera-btn').textContent = webcamSelected ? 'Stop Webcam' : 'Start Webcam';
  $('camera-btn').className = `btn ${webcamSelected ? 'btn-destructive' : 'btn-secondary'}`;
  $('webrtc-camera-btn').textContent = streamSelected ? 'Stop WebRTC Camera' : 'Start WebRTC Camera';
  $('webrtc-camera-btn').className = `btn ${streamSelected ? 'btn-destructive' : 'btn-secondary'}`;
  $('webrtc-camera-btn').disabled = !connected;
  $('webrtc-camera-url').disabled = streamSelected;
  $('camera-select').disabled = model.cameraPending || model.isCameraActive;
  $('preview-placeholder').classList.toggle('waiting', model.cameraPending);
  $('preview-placeholder').textContent = model.cameraPending
    ? (streamSelected ? 'Waiting for stream…' : 'Starting webcam…') : 'Camera off';
  $('camera-preview').closest('.preview-card').setAttribute('aria-busy', String(model.cameraPending));
  if (model.cameraPending) $('camera-status').textContent = streamSelected ? 'Waiting for stream…' : 'Starting…';

  // Camera preview elements.
  const video       = $('camera-preview');
  const placeholder = $('preview-placeholder');
  const liveBadge   = $('preview-live-badge');
  if (model.isCameraActive) {
    video.classList.add('active');
    placeholder.style.display = 'none';
    liveBadge.classList.add('active');
  } else {
    video.classList.remove('active');
    placeholder.style.display = '';
    liveBadge.classList.remove('active');
  }

  const transcriptEl = $('transcript-text');
  const transcriptText = model.transcripts.join("\n\n") || 'Your speech will appear here…';
  if (transcriptEl.textContent !== transcriptText) {
    transcriptEl.textContent = transcriptText;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
  transcriptEl.classList.toggle('empty', model.transcripts.length === 0);

  // Agent response.
  const responseEl = $('agent-response-text');
  if (model.agentResponse) {
    responseEl.textContent = model.agentResponse;
    responseEl.classList.remove('empty');
  } else {
    responseEl.textContent = 'Waiting for agent…';
    responseEl.classList.add('empty');
  }
}

function enumerateCameras() { return _enumerateCameras(model, render); }

async function stopCamera() {
  const generation = ++cameraGeneration;
  const stopStreamAudio = model.cameraSource === 'webrtc';
  streamAudioWanted = false;
  releaseStreamCamera();
  model.cameraSource = null;
  model.cameraPending = false;
  model.isCameraActive = false;
  clearCameraPreview();
  render();
  try {
    const stoppingAudio = stopStreamAudio ? model.session?.stopAudio() : undefined;
    if (stopStreamAudio) model.isAudioActive = false;
    await Promise.all([model.session?.stopCamera(), stoppingAudio]);
    render();
  } catch (error) {
    if (generation === cameraGeneration) showError(error.message);
  }
}

async function startCamera() {
  const stopping = stopCamera();
  const generation = cameraGeneration;
  model.cameraSource = 'webcam';
  model.cameraPending = true;
  render();
  await stopping;
  if (generation !== cameraGeneration) return;
  // Capture into a draft so a permission prompt completing after Stop cannot
  // overwrite the next camera source's UI state.
  const session = model.session;
  const draft = { ...model, session: {
    startCamera(config) {
      if (generation !== cameraGeneration) throw new DOMException('Camera stopped.', 'AbortError');
      return session.startCamera(config);
    },
  } };
  await _startCamera(draft, {
    render: () => {}, enumerateCameras,
    showError: message => { if (generation === cameraGeneration) showError(message); },
  });
  if (generation !== cameraGeneration) return;
  model.isCameraActive = draft.isCameraActive;
  model.cameraPending = false;
  if (model.isCameraActive) showPublishedCameraPreview();
  else model.cameraSource = null;
  render();
}

async function startWebRtcCamera(wantAudio = true) {
  const raw = $('webrtc-camera-url').value.trim();
  let url;
  try {
    url = WhepCamera.validateURL(raw);
  } catch (error) {
    showError(error.message);
    $('webrtc-camera-url').focus();
    return;
  }
  const stopping = stopCamera();
  const generation = cameraGeneration;
  model.cameraSource = 'webrtc';
  streamAudioWanted = wantAudio;
  model.cameraPending = true;
  const stoppingAudio = model.session?.stopAudio();
  model.isAudioActive = false;
  try { localStorage.setItem('xr-ai.whep-camera-url', url); } catch { /* Storage may be disabled. */ }
  render();
  await Promise.all([stopping, stoppingAudio]);
  while (generation === cameraGeneration) {
    const receiver = streamCamera = new WhepCamera();
    receiver.onError = () => {
      if (generation === cameraGeneration) void startWebRtcCamera(streamAudioWanted);
    };
    try {
      const track = await receiver.open(url);
      if (generation !== cameraGeneration) return;
      await model.session.publishCameraTrack(track);
      if (generation !== cameraGeneration) return;
      receiver.onAudioTrack = () => {
        if (streamAudioWanted && generation === cameraGeneration) void startAudio();
      };
      if (receiver.audioTrack && streamAudioWanted) await startAudio();
      if (generation !== cameraGeneration) return;
      model.isCameraActive = true;
      model.cameraPending = false;
      showPublishedCameraPreview();
      render();
      return;
    } catch (error) {
      receiver.close();
      if (generation !== cameraGeneration) return;
      if (!error.retryable) {
        await stopCamera();
        showError(error.message);
        return;
      }
      await new Promise(resolve => {
        cancelRetry = resolve;
        retryTimer = setTimeout(resolve, 3000);
      });
      cancelRetry = null;
    }
  }
}

async function startAudio() {
  if (model.cameraSource !== 'webrtc') return _startAudio(model, render, showError);
  streamAudioWanted = true;
  const generation = cameraGeneration;
  const track = streamCamera?.audioTrack;
  if (!track) {
    showError('Waiting for stream audio. Enable microphone audio on the publisher.');
    return;
  }
  try {
    await model.session.publishMicrophoneTrack(track);
    if (generation !== cameraGeneration || !streamAudioWanted) return;
    model.isAudioActive = true;
    render();
  } catch (error) {
    if (generation === cameraGeneration && streamAudioWanted) showError(error.message);
  }
}
function stopAudio() {
  streamAudioWanted = false;
  return _stopAudio(model, render, showError);
}
async function disconnect() {
  await stopCamera();
  try {
    await _disconnect(model, render);
  } finally {
    clearCameraPreview();
    render();
  }
}
function sendCustom(text)   { return _sendCustom(model, text, showError); }
function connect()          {
  return _connect(model, {
    render, showError, enumerateCameras, startCamera, stopCamera,
    onStateChange(state) {
      if (state !== 'connected' && model.cameraSource) void stopCamera();
    },
    onDataReceived(topic, data) {
      if (topic === '_capture.voice.stt') {
        const text = new TextDecoder().decode(data).trim();
        if (text) model.transcripts = [...model.transcripts, text].slice(-20);
        render();
        return true;
      }
      if (AGENT_REPLY_TOPICS.has(topic)) {
        model.agentResponse = new TextDecoder().decode(data);
        render();
        return true; // suppress from the received messages list
      }
      return false;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

wireBaseEvents(model, {
  connect, disconnect, startAudio, stopAudio, startCamera, stopCamera, sendCustom,
  toggleCamera: () => model.cameraSource === 'webcam' ? stopCamera() : startCamera(),
});
// Camera providers can supply a pairing page without coupling the client to their SDK.
const pairingPage = new URLSearchParams(window.location?.search || '').get('cameraPairingUrl');
if (pairingPage) {
  try {
    const url = new URL(pairingPage);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid pairing URL');
    $('camera-pairing-frame').src = url.href;
    $('camera-pairing').hidden = false;
    $('camera-pairing').open = true;
  } catch { showError('Camera pairing URL must be an HTTP or HTTPS address.'); }
}
$('webrtc-camera-url').value = 'http://localhost:8889/mentra-live/whep';
try {
  $('webrtc-camera-url').value = localStorage.getItem('xr-ai.whep-camera-url') || $('webrtc-camera-url').value;
} catch { /* Storage may be disabled. */ }
$('webrtc-camera-btn').addEventListener('click', () => {
  if (model.cameraSource === 'webrtc') void stopCamera();
  else void startWebRtcCamera();
});
window.addEventListener('pagehide', () => {
  cameraGeneration += 1;
  releaseStreamCamera();
  clearCameraPreview();
  const pendingDisconnect = model.session?.disconnect();
  if (pendingDisconnect) pendingDisconnect.catch(() => {});
});
render();
