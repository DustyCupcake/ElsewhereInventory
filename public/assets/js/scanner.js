/**
 * Camera + QR scanning module.
 * Wraps native BarcodeDetector (Chrome) and jsQR (fallback).
 * Supports haptic feedback, audio feedback, and manual-trigger mode.
 *
 * Usage:
 *   const scanner = new Scanner(videoEl, onDetected);
 *   await scanner.start();
 *   scanner.stop();
 */

import { getSettings } from './account.js?v=1.0.0';

const SCAN_MS    = 350;
const MAX_DIM    = 640;
const USE_NATIVE = typeof BarcodeDetector !== 'undefined';

let _detector = null;
async function getDetector() {
  if (!_detector && USE_NATIVE) {
    _detector = new BarcodeDetector({ formats: ['qr_code'] });
  }
  return _detector;
}

// ── Audio tones ───────────────────────────────────────────────────────────────

let _audioCtx = null;
function _getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  return _audioCtx;
}

function _playTone(freq, durationMs, type = 'sine') {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {}
}

function _feedbackSuccess() {
  const s = getSettings();
  if (s.haptic !== false && 'vibrate' in navigator) navigator.vibrate(50);
  if (s.sound  !== false) _playTone(880, 80);
}

function _feedbackError() {
  const s = getSettings();
  if (s.haptic !== false && 'vibrate' in navigator) navigator.vibrate([50, 30, 50]);
  if (s.sound  !== false) { _playTone(300, 80); }
}

export { _feedbackSuccess as scanFeedbackSuccess, _feedbackError as scanFeedbackError };

// ── Scanner class ─────────────────────────────────────────────────────────────

export class Scanner {
  constructor(videoEl, onDetected) {
    this._video       = videoEl;
    this._onDetected  = onDetected;
    this._stream      = null;
    this._raf         = null;
    this._canvas      = document.createElement('canvas');
    this._ctx         = this._canvas.getContext('2d', { willReadFrequently: true });
    this._active      = false;
    this._lastScan    = 0;

    // Trigger-mode state
    this._triggerPending = false;
    this._triggerHandlers = null;
  }

  async start() {
    if (this._active) return;
    this._active = true;

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
        audio: false,
      });
      this._video.srcObject = this._stream;
      await this._video.play();
      this._startLoop();
    } catch (err) {
      this._active = false;
      throw err;
    }
  }

  stop() {
    this._active = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    this._video.srcObject = null;
    this._removeTriggerHandlers();
  }

  _startLoop() {
    const s = getSettings();
    if (s.triggerMode === 'trigger') {
      this._installTriggerHandlers();
    } else {
      this._autoLoop();
    }
  }

  _autoLoop() {
    if (!this._active) return;
    this._raf = requestAnimationFrame(() => this._autoLoop());
    const now = performance.now();
    if (now - this._lastScan < SCAN_MS) return;
    this._lastScan = now;
    if (this._video.readyState < 2) return;
    this._decode();
  }

  _installTriggerHandlers() {
    // Volume keys (works on some Android browsers via keyboard events)
    const onKey = (e) => {
      if (e.key === 'VolumeUp' || e.key === 'VolumeDown') {
        e.preventDefault();
        this._captureFrame();
      }
    };

    // Tap anywhere on document that isn't a button/input/link
    const onPointer = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag && ['button', 'a', 'input', 'select', 'textarea', 'label'].includes(tag)) return;
      if (e.target?.closest?.('[role="button"]')) return;
      this._captureFrame();
    };

    document.addEventListener('keydown', onKey, { capture: true });
    document.addEventListener('pointerdown', onPointer, { capture: true });

    this._triggerHandlers = { onKey, onPointer };
  }

  _removeTriggerHandlers() {
    if (!this._triggerHandlers) return;
    document.removeEventListener('keydown', this._triggerHandlers.onKey, { capture: true });
    document.removeEventListener('pointerdown', this._triggerHandlers.onPointer, { capture: true });
    this._triggerHandlers = null;
  }

  _captureFrame() {
    if (!this._active || this._triggerPending) return;
    this._triggerPending = true;
    // Short debounce so a single physical button press doesn't fire twice
    setTimeout(() => { this._triggerPending = false; }, 300);
    if (this._video.readyState < 2) return;
    this._decode();
  }

  async _decode() {
    if (USE_NATIVE) {
      const det = await getDetector();
      try {
        const codes = await det.detect(this._video);
        if (codes.length) this._emit(codes[0].rawValue);
      } catch {/* ignore */}
      return;
    }

    // jsQR fallback
    const { videoWidth: vw, videoHeight: vh } = this._video;
    if (!vw || !vh) return;

    const scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
    const w     = Math.round(vw * scale);
    const h     = Math.round(vh * scale);

    this._canvas.width  = w;
    this._canvas.height = h;
    this._ctx.drawImage(this._video, 0, 0, w, h);

    const imgData = this._ctx.getImageData(0, 0, w, h);
    const result  = window.jsQR?.(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
    if (result?.data) this._emit(result.data);
  }

  _emit(value) {
    if (!value || !this._active) return;
    this.stop();
    this._onDetected(_extractQrParam(value) ?? value);
  }
}

function _extractQrParam(raw) {
  if (!raw.startsWith('http')) return null;
  try {
    return new URL(raw).searchParams.get('qr');
  } catch {
    return null;
  }
}
