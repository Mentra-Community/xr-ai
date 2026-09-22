// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./web_camera_test_loader.mjs', import.meta.url);

const { LiveKitBackend } = await import(
  '../../client-samples/web/StreamKit/Backends/LiveKit/LiveKitBackend.js'
);

function makeMediaTrack(settings = {}) {
  return {
    stopCount: 0,
    getSettings: () => ({ width: 1280, height: 720, facingMode: 'environment', ...settings }),
    stop() {
      this.stopCount += 1;
    },
  };
}

function makePublishedTrack(mediaTrack) {
  return {
    mediaStreamTrack: mediaTrack,
    stopCount: 0,
    stop() {
      this.stopCount += 1;
      mediaTrack.stop();
    },
  };
}

function makeRoom(publishTrack, { localTracks = [], remoteTracks = [], quality = 'unknown' } = {}) {
  const handlers = new Map();
  const room = {
    state: 'disconnected',
    remoteParticipants: new Map(remoteTracks.length ? [[
      'remote',
      { trackPublications: new Map(remoteTracks.map((track, i) => [String(i), { track }])) },
    ]] : []),
    unpublishedTracks: [],
    startAudioCalls: 0,
    localParticipant: {
      connectionQuality: quality,
      trackPublications: new Map(localTracks.map((track, i) => [String(i), { track }])),
      publishTrack,
      publishData: async () => {},
      unpublishTrack: async track => {
        globalThis.__livekitRoom.unpublishedTracks.push(track);
      },
    },
    on(event, handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    },
    removeAllListeners() {
      handlers.clear();
    },
    async startAudio() {
      this.startAudioCalls += 1;
    },
    async connect() {
      this.state = 'connected';
    },
    async disconnect() {
      this.state = 'disconnected';
    },
  };
  return room;
}

async function connectedBackend(t, publishTrack, options = {}) {
  const room = makeRoom(publishTrack, options);
  globalThis.__livekitRoom = room;
  const backend = new LiveKitBackend({
    host: 'localhost',
    port: 7880,
    secure: false,
    token: 'test-token',
    tokenURL: null,
    hubIdentity: null,
  });
  t.after(() => backend.disconnect());
  options.configure?.(backend);
  await backend.connect({ identity: 'browser-test' });
  return { backend, room };
}

function installMediaDevices(getUserMedia) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia } },
  });
}

class FakeClassList {
  values = new Set();

  add(value) {
    this.values.add(value);
  }

  toggle(value, force) {
    if (force) this.values.add(value); else this.values.delete(value);
  }

  remove(value) {
    this.values.delete(value);
  }
}

function installAppBrowser(model) {
  const previewCard = { style: {}, setAttribute() {} };
  const video = {
    classList: new FakeClassList(),
    closest: () => previewCard,
    onresize: null,
    srcObject: null,
    style: {},
    videoHeight: 0,
    videoWidth: 0,
  };
  const element = () => ({
    classList: new FakeClassList(),
    style: {},
    textContent: '',
    value: '',
    addEventListener() {},
  });
  globalThis.__elements = new Map([
    ['camera-preview', video],
    ['preview-placeholder', element()],
    ['preview-live-badge', element()],
    ['agent-response-text', element()],
    ['error-toast', element()],
    ...['camera-btn', 'webrtc-camera-btn', 'webrtc-camera-url', 'camera-select', 'camera-status'].map(id => [id, element()]),
  ]);
  globalThis.__appBaseModel = model;
  globalThis.window = {
    addEventListener: () => {},
  };
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }

    getVideoTracks() {
      return this.tracks;
    }
  };
  return { previewCard, video };
}

test('primes remote audio on connect and retries before sending', async (t) => {
  const { backend, room } = await connectedBackend(t, async () => {});

  assert.equal(room.startAudioCalls, 1);
  await backend.send('hello');
  assert.equal(room.startAudioCalls, 2);
});

test('publishes and previews the captured full-frame camera track', async (t) => {
  const capturedTracks = [makeMediaTrack(), makeMediaTrack()];
  let currentTrack = capturedTracks[0];
  const captureConstraints = [];
  const publishedTracks = [];
  const publishedWrappers = [];
  installMediaDevices(async constraints => {
    captureConstraints.push(constraints);
    return { getVideoTracks: () => [currentTrack] };
  });

  const { backend, room } = await connectedBackend(t, async mediaTrack => {
    publishedTracks.push(mediaTrack);
    const wrapper = makePublishedTrack(mediaTrack);
    publishedWrappers.push(wrapper);
    return { videoTrack: wrapper };
  });
  const model = {
    agentResponse: null,
    isCameraActive: false,
    selectedCameraId: 'camera-7',
    session: backend,
  };
  const { previewCard, video } = installAppBrowser(model);
  await import(`../../client-samples/web/App/app.js?test=${Date.now()}`);

  await globalThis.__appActions.startCamera();

  assert.deepEqual(captureConstraints[0], {
    audio: false,
    video: { deviceId: { exact: 'camera-7' }, resizeMode: 'none' },
  });
  assert.equal(publishedTracks[0], capturedTracks[0]);
  assert.equal(backend.cameraTrack, capturedTracks[0]);
  assert.equal(video.srcObject.getVideoTracks()[0], capturedTracks[0]);
  assert.equal(previewCard.style.aspectRatio, '1280 / 720');

  await globalThis.__appActions.stopCamera();

  assert.equal(capturedTracks[0].stopCount, 1);
  assert.equal(publishedWrappers[0].stopCount, 1);
  assert.equal(room.unpublishedTracks[0], publishedWrappers[0]);
  assert.equal(video.srcObject, null);
  assert.equal(video.onresize, null);
  assert.equal(previewCard.style.aspectRatio, '');

  currentTrack = capturedTracks[1];
  await globalThis.__appActions.startCamera();
  assert.equal(video.srcObject.getVideoTracks()[0], capturedTracks[1]);

  await globalThis.__appActions.disconnect();

  assert.equal(capturedTracks[1].stopCount, 1);
  assert.equal(publishedWrappers[1].stopCount, 1);
  assert.equal(video.srcObject, null);
  assert.equal(video.onresize, null);
  assert.equal(previewCard.style.aspectRatio, '');
});

test('stops the captured camera track when LiveKit publication fails', async (t) => {
  const mediaTrack = makeMediaTrack();
  installMediaDevices(async () => ({ getVideoTracks: () => [mediaTrack] }));
  const failure = new Error('publication failed');
  const { backend } = await connectedBackend(t, async () => {
    throw failure;
  });

  await assert.rejects(backend.startCamera({ facing: 'environment' }), failure);

  assert.equal(mediaTrack.stopCount, 1);
  assert.equal(backend.cameraTrack, null);
});

test('reports the highest selected-transport RTT and all inbound-track jitter', async (t) => {
  const report = new Map([
    ['transport', {
      id: 'transport', type: 'transport', selectedCandidatePairId: 'active-pair',
    }],
    ['transport-2', {
      id: 'transport-2', type: 'transport', selectedCandidatePairId: 'active-pair-2',
    }],
    ['stale-pair', {
      id: 'stale-pair', type: 'candidate-pair', state: 'succeeded',
      currentRoundTripTime: 0.9,
    }],
    ['active-pair', {
      id: 'active-pair', type: 'candidate-pair', nominated: false,
      currentRoundTripTime: 0.042,
    }],
    ['active-pair-2', {
      id: 'active-pair-2', type: 'candidate-pair', nominated: false,
      currentRoundTripTime: 0.055,
    }],
    ['inbound-audio', { id: 'inbound-audio', type: 'inbound-rtp', jitter: 0.003 }],
    ['inbound-video', { id: 'inbound-video', type: 'inbound-rtp', jitter: 0.007 }],
  ]);
  const track = { getRTCStatsReport: async () => report };
  let resolveMetrics;
  const metricsPromise = new Promise(resolve => { resolveMetrics = resolve; });

  await connectedBackend(t, async () => {}, {
    quality: 'good',
    remoteTracks: [track],
    configure: backend => { backend.onNetworkMetrics = resolveMetrics; },
  });

  const metrics = await metricsPromise;
  assert.equal(metrics.quality, 'good');
  assert.equal(metrics.roundTripTimeMs, 55);
  assert.equal(metrics.receiveJitterMs, 7);
});

test('maps network quality and rejects invalid RTC measurements', async (t) => {
  const invalidReport = new Map([
    ['pair', {
      id: 'pair', type: 'candidate-pair', nominated: true,
      currentRoundTripTime: Number.POSITIVE_INFINITY,
    }],
    ['inbound', { id: 'inbound', type: 'inbound-rtp', jitter: -1 }],
  ]);
  const track = { getRTCStatsReport: async () => invalidReport };

  for (const [quality, expected] of [
    ['excellent', 'excellent'],
    ['good', 'good'],
    ['poor', 'poor'],
    ['lost', 'lost'],
    ['unknown', 'unknown'],
    ['unexpected', 'unknown'],
  ]) {
    let resolveMetrics;
    const metricsPromise = new Promise(resolve => { resolveMetrics = resolve; });
    await connectedBackend(t, async () => {}, {
      quality,
      localTracks: [track],
      configure: backend => { backend.onNetworkMetrics = resolveMetrics; },
    });
    const metrics = await metricsPromise;
    assert.equal(metrics.quality, expected);
    assert.equal(metrics.roundTripTimeMs, null);
    assert.equal(metrics.receiveJitterMs, null);
  }
});

test('stops network polling after a terminal room disconnect', async (t) => {
  let statsCalls = 0;
  const track = {
    async getRTCStatsReport() {
      statsCalls += 1;
      return new Map();
    },
  };
  const { room } = await connectedBackend(t, async () => {}, { localTracks: [track] });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(statsCalls, 1);

  room.state = 'disconnected';
  room.emit('connectionStateChanged', 'disconnected');
  await new Promise(resolve => setTimeout(resolve, 1_100));

  assert.equal(statsCalls, 1);
});

test('publishes a clone of an external camera and preserves the caller track on stop', async t => {
  const original = makeMediaTrack();
  const clone = makeMediaTrack();
  Object.assign(original, { kind: 'video', readyState: 'live', clone: () => clone });
  const { backend } = await connectedBackend(t, async media => {
    assert.equal(media, clone);
    return { videoTrack: makePublishedTrack(media) };
  });
  await backend.publishCameraTrack(original);
  assert.equal(backend.cameraTrack, clone);
  await backend.stopCamera();
  assert.equal(clone.stopCount, 1);
  assert.equal(original.stopCount, 0);
});

test('stopping during external camera publication prevents a late camera from staying live', async t => {
  let complete;
  const published = new Promise(resolve => { complete = resolve; });
  const clone = makeMediaTrack();
  const input = { kind: 'video', readyState: 'live', clone: () => clone };
  const { backend, room } = await connectedBackend(t, () => published);
  const pending = backend.publishCameraTrack(input);
  await new Promise(resolve => setTimeout(resolve, 0));
  await backend.stopCamera();
  const wrapper = makePublishedTrack(clone);
  complete({ videoTrack: wrapper });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(backend.cameraTrack, null);
  assert.equal(clone.stopCount, 1);
  assert.deepEqual(room.unpublishedTracks, [wrapper]);
});

const { WhepCamera } = await import('../../client-samples/web/App/WhepCamera.js');

function installWhepBrowser(t, fetch) {
  const previous = { fetch: globalThis.fetch, peer: globalThis.RTCPeerConnection, window: globalThis.window };
  globalThis.window = { location: { protocol: 'http:' } };
  globalThis.fetch = fetch;
  const peers = [];
  globalThis.RTCPeerConnection = class {
    iceGatheringState = 'complete';
    closed = false;
    constructor() { peers.push(this); }
    transceivers = [];
    addTransceiver(kind, options) { this.transceivers.push({ kind, ...options }); }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription() {
      this.track = { kind: 'video', muted: false, stopCount: 0, addEventListener() {}, stop() { this.stopCount++; } };
      this.ontrack({ track: this.track });
      this.audioTrack = { kind: 'audio', muted: false, stopCount: 0, stop() { this.stopCount++; } };
      this.ontrack({ track: this.audioTrack });
    }
    close() { this.closed = true; }
  };
  t.after(() => {
    globalThis.fetch = previous.fetch;
    globalThis.RTCPeerConnection = previous.peer;
    globalThis.window = previous.window;
  });
  return peers;
}

test('WHEP owns and deletes its receiver session on stop', async t => {
  const requests = [];
  const peers = installWhepBrowser(t, async (url, options) => {
    requests.push([String(url), options.method]);
    return new Response('answer', { status: 201, headers: { Location: '/camera/session/1' } });
  });
  const receiver = new WhepCamera();
  const track = await receiver.open('http://receiver.example/camera/whep');
  assert.equal(track, peers[0].track);
  assert.equal(receiver.audioTrack, peers[0].audioTrack);
  assert.deepEqual(peers[0].transceivers, [
    { kind: 'video', direction: 'recvonly' },
    { kind: 'audio', direction: 'recvonly' },
  ]);
  receiver.close();
  receiver.close();
  assert.equal(track.stopCount, 1);
  assert.equal(peers[0].audioTrack.stopCount, 1);
  assert.equal(peers[0].closed, true);
  assert.deepEqual(requests, [
    ['http://receiver.example/camera/whep', 'POST'],
    ['http://receiver.example/camera/session/1', 'DELETE'],
  ]);
});

test('WHEP treats an absent publisher as retryable and closes the failed peer', async t => {
  const peers = installWhepBrowser(t, async () => new Response('', { status: 404 }));
  const receiver = new WhepCamera();
  await assert.rejects(receiver.open('http://receiver.example/camera/whep'), { retryable: true });
  assert.equal(peers[0].closed, true);
});

test('WHEP deletes a session whose POST completes after cancellation', async t => {
  let respond;
  const deleted = [];
  installWhepBrowser(t, async (url, options) => {
    if (options.method === 'DELETE') { deleted.push(String(url)); return new Response(); }
    return new Promise(resolve => { respond = resolve; });
  });
  const receiver = new WhepCamera();
  const pending = receiver.open('http://receiver.example/camera/whep');
  await new Promise(resolve => setTimeout(resolve, 0));
  receiver.close();
  await assert.rejects(pending, { name: 'AbortError' });
  respond(new Response('answer', { status: 201, headers: { Location: '/late-session' } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(deleted, ['http://receiver.example/late-session']);
});


test('external microphone publishes a clone without capturing the laptop mic', async t => {
  const clone = makeMediaTrack();
  const source = { kind: 'audio', readyState: 'live', ...makeMediaTrack(), clone: () => clone };
  let published;
  const { backend, room } = await connectedBackend(t, async (track, options) => {
    assert.equal(options.source, 'microphone');
    published = makePublishedTrack(track);
    return { audioTrack: published };
  });
  await backend.publishMicrophoneTrack(source);
  await backend.stopAudio();
  assert.equal(clone.stopCount, 1);
  assert.equal(source.stopCount, 0);
  assert.deepEqual(room.unpublishedTracks, [published]);
});

test('stopping during external microphone publication prevents a late audio track', async t => {
  const clone = makeMediaTrack();
  const source = { kind: 'audio', readyState: 'live', clone: () => clone };
  let finish;
  const { backend, room } = await connectedBackend(t, () => new Promise(resolve => { finish = resolve; }));
  const publishing = backend.publishMicrophoneTrack(source);
  await new Promise(resolve => setTimeout(resolve, 0));
  await backend.stopAudio();
  const published = makePublishedTrack(clone);
  finish({ audioTrack: published });
  await assert.rejects(publishing, { name: 'AbortError' });
  assert.equal(clone.stopCount, 1);
  assert.deepEqual(room.unpublishedTracks, [published]);
});


test('playback mute covers existing and future audio tracks without stopping input', async t => {
  const priorDocument = globalThis.document;
  globalThis.document = { body: { appendChild() {} } };
  t.after(() => { globalThis.document = priorDocument; });
  const { backend, room } = await connectedBackend(t, async () => {});
  const first = { style: {}, muted: false, play: async () => {}, remove() {} };
  const second = { style: {}, muted: false, play: async () => {}, remove() {} };
  room.emit('trackSubscribed', {kind: 'audio', sid: 'one', attach: () => first});
  backend.setAudioPlaybackMuted(true);
  assert.equal(first.muted, true);
  room.emit('trackSubscribed', {kind: 'audio', sid: 'two', attach: () => second});
  assert.equal(second.muted, true);
  assert.equal(room.unpublishedTracks.length, 0);
  backend.setAudioPlaybackMuted(false);
  assert.equal(first.muted, false);
  assert.equal(second.muted, false);
});
