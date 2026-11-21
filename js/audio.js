/**
 * Tiny WebAudio synth — no samples, no dependencies.
 * All sounds are created lazily after the first user gesture.
 */
export class SoundEngine {
  constructor({ muted = false } = {}) {
    this.muted = muted;
    this.ctx = null;
  }

  get available() {
    return typeof window !== "undefined" && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  /** Must be called from a user gesture at least once (autoplay policies). */
  unlock() {
    if (!this.available) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted && this.ctx?.state === "running") {
      this.ctx.suspend().catch(() => {});
    } else if (!this.muted && this.ctx) {
      this.ctx.resume().catch(() => {});
    }
  }

  tone({
    freq = 440,
    to = freq,
    duration = 0.1,
    type = "sine",
    volume = 0.045,
    delay = 0,
    attack = 0.006,
  } = {}) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), now);
    if (to !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  start() {
    this.unlock();
    [392, 523.25, 659.25, 783.99].forEach((freq, i) => {
      this.tone({ freq, duration: 0.11, type: "triangle", volume: 0.04, delay: i * 0.07 });
    });
  }

  eat() {
    this.tone({ freq: 740, to: 1180, duration: 0.08, type: "sine", volume: 0.05 });
    this.tone({ freq: 1480, to: 1770, duration: 0.06, type: "triangle", volume: 0.022, delay: 0.045 });
  }

  bonus() {
    [880, 1174, 1568].forEach((freq, i) => {
      this.tone({ freq, duration: 0.07, type: "triangle", volume: 0.035, delay: i * 0.05 });
    });
  }

  die() {
    this.tone({ freq: 300, to: 48, duration: 0.55, type: "sawtooth", volume: 0.055 });
    this.tone({ freq: 150, to: 40, duration: 0.62, type: "square", volume: 0.025, delay: 0.03 });
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
      this.tone({ freq, duration: 0.16, type: "triangle", volume: 0.04, delay: i * 0.09 });
    });
  }

  pause() {
    this.tone({ freq: 320, to: 240, duration: 0.1, type: "sine", volume: 0.03 });
  }

  click() {
    this.tone({ freq: 920, to: 780, duration: 0.035, type: "square", volume: 0.018 });
  }
}
