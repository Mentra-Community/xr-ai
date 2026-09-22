// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/** Receives video and optional microphone audio from a WHEP session. The application owns its lifetime. */
export class WhepCamera {
  track = null;
  audioTrack = null;
  onAudioTrack = null;
  onError = null;
  #peer = null;
  #abort = new AbortController();
  #resource = null;
  #closed = false;

  static validateURL(endpoint) {
    let url;
    try { url = new URL(endpoint); } catch { throw new Error('Enter a full WHEP playback URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Enter an HTTP or HTTPS WHEP playback URL without embedded credentials.');
    }
    if (window.location.protocol === 'https:' && url.protocol !== 'https:') {
      throw new Error('An HTTPS page requires an HTTPS camera URL.');
    }
    return url.href;
  }

  async open(endpoint) {
    const url = new URL(WhepCamera.validateURL(endpoint));
    if (this.#closed || this.#peer) throw new Error('Camera session already used.');
    const peer = this.#peer = new RTCPeerConnection();
    const { signal } = this.#abort;
    const timeout = setTimeout(() => this.#abort.abort(Object.assign(new Error('Camera connection timed out.'), { retryable: true })), 15000);
    let ready = false;
    let resolveTrack;
    const incoming = new Promise(resolve => { resolveTrack = resolve; });
    peer.ontrack = ({ track }) => {
      if (track.kind === 'audio') {
        this.audioTrack = track;
        this.onAudioTrack?.(track);
        return;
      }
      if (track.kind !== 'video') return;
      this.track = track;
      const accept = () => resolveTrack(track);
      if (track.muted) track.addEventListener('unmute', accept, { once: true });
      else accept();
      track.addEventListener('mute', () => {
        if (ready && !this.#closed) this.onError?.(new Error('Camera stream interrupted.'));
      });
      track.addEventListener('ended', () => {
        if (!this.#closed) this.onError?.(new Error('Camera stream ended.'));
      }, { once: true });
    };
    peer.onconnectionstatechange = () => {
      if (!['failed', 'disconnected'].includes(peer.connectionState) || this.#closed) return;
      const error = Object.assign(new Error('Camera connection failed.'), { retryable: true });
      if (ready) this.onError?.(error);
      else this.#abort.abort(error);
    };
    // Send a complete offer so receivers need no trickle-ICE PATCH support.
    const aborted = new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    const negotiate = async () => {
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== 'complete') {
        await new Promise(resolve => {
          peer.onicegatheringstatechange = () => {
            if (peer.iceGatheringState === 'complete') resolve();
          };
        });
      }
      signal.throwIfAborted();
      let response;
      try {
        response = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/sdp' },
          body: peer.localDescription.sdp, signal,
        });
      } catch (error) {
        if (!signal.aborted) error.retryable = true;
        throw error;
      }
      if (response.status !== 201) {
        throw Object.assign(new Error(`Camera receiver returned HTTP ${response.status}. Check the WHEP playback URL.`), {
          retryable: [404, 408, 429, 500, 502, 503, 504].includes(response.status),
        });
      }
      const location = response.headers.get('Location');
      if (!location) throw new Error('Camera receiver did not expose its WHEP session Location header.');
      this.#resource = new URL(location, response.url || url).href;
      if (this.#closed) {
        this.#deleteResource();
        signal.throwIfAborted();
      }
      const sdp = await response.text();
      signal.throwIfAborted();
      await peer.setRemoteDescription({ type: 'answer', sdp });
      return incoming;
    };
    try {
      const track = await Promise.race([negotiate(), aborted]);
      ready = true;
      return track;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  close() {
    this.#closed = true;
    this.#abort.abort(new DOMException('Camera stopped.', 'AbortError'));
    this.#peer?.close();
    this.track?.stop();
    this.audioTrack?.stop();
    this.audioTrack = null;
    this.onAudioTrack = null;
    this.track = null;
    this.#peer = null;
    this.#deleteResource();
  }

  #deleteResource() {
    if (this.#resource) {
      const resource = this.#resource;
      this.#resource = null;
      fetch(resource, { method: 'DELETE', keepalive: true }).catch(() => {});
    }
  }
}
