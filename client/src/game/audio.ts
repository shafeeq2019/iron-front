import { getSettings, onSettings } from './settings';

export type Sfx =
  | 'rifle' | 'mg' | 'pistol' | 'cannon' | 'heavy' | 'rocket' | 'artillery' | 'arc' | 'autocannon'
  | 'hitSmall' | 'explosion' | 'bigExplosion' | 'infantryDown'
  | 'click' | 'select' | 'ack' | 'error' | 'place' | 'complete' | 'ready' | 'alert' | 'sweep' | 'cash' | 'victory' | 'defeat';

/**
 * Procedural audio: every sound and the music are synthesized at runtime with
 * WebAudio, so the game ships no external audio assets.
 */
class AudioEngine {
  ctx: AudioContext | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  private active = 0;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicStep = 0;
  private musicNext = 0;
  private musicOn = false;
  private section = 0;
  /** Listener position in world coordinates and view radius for attenuation. */
  listener = { x: 0, y: 0, r: 900 };

  constructor() {
    onSettings((s) => this.applyVolumes(s.sfxVolume, s.musicVolume));
  }

  /** Must be called from a user gesture on iOS/Safari. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = getSettings();
      this.applyVolumes(s.sfxVolume, s.musicVolume);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private applyVolumes(sfx: number, music: number) {
    if (!this.ctx) return;
    this.sfxGain.gain.value = sfx * 0.9;
    this.musicGain.gain.value = music * 0.5;
  }

  private noise(t: number, dur: number, gain: number, filter: BiquadFilterType, f0: number, f1: number, q = 1, dest?: AudioNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt).connect(g).connect(dest ?? this.sfxGain);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  private tone(t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1: number, dest?: AudioNode, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Plays a sound effect; world-positioned sounds are attenuated by distance from the camera. */
  play(name: Sfx, wx?: number, wy?: number, vol = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    let v = vol;
    if (wx !== undefined && wy !== undefined) {
      const d = Math.hypot(wx - this.listener.x, wy - this.listener.y);
      if (d > this.listener.r * 1.6) return;
      v *= Math.max(0.15, 1 - d / (this.listener.r * 1.6));
    }
    const now = ctx.currentTime;
    const minGap = name === 'mg' || name === 'autocannon' ? 0.07 : name === 'rifle' ? 0.05 : 0.03;
    if (now - (this.last.get(name) ?? 0) < minGap) return;
    if (this.active > 24) return;
    this.last.set(name, now);
    this.active++;
    setTimeout(() => this.active--, 400);
    const t = now + 0.005;
    switch (name) {
      case 'rifle': this.noise(t, 0.07, 0.35 * v, 'bandpass', 2400, 900, 0.8); break;
      case 'pistol': this.noise(t, 0.05, 0.25 * v, 'bandpass', 3000, 1500, 1); break;
      case 'mg': this.noise(t, 0.05, 0.3 * v, 'bandpass', 1800, 700, 0.9); break;
      case 'autocannon': this.noise(t, 0.08, 0.35 * v, 'lowpass', 1600, 400, 1); this.tone(t, 0.06, 0.15 * v, 'square', 180, 90); break;
      case 'cannon': this.noise(t, 0.25, 0.55 * v, 'lowpass', 1400, 120, 1); this.tone(t, 0.22, 0.4 * v, 'sine', 140, 45); break;
      case 'heavy': this.noise(t, 0.35, 0.6 * v, 'lowpass', 1100, 90, 1); this.tone(t, 0.3, 0.5 * v, 'sine', 110, 35); break;
      case 'rocket': this.noise(t, 0.4, 0.35 * v, 'bandpass', 600, 2800, 2); break;
      case 'artillery': this.noise(t, 0.5, 0.6 * v, 'lowpass', 900, 60, 1); this.tone(t, 0.45, 0.5 * v, 'sine', 90, 30); break;
      case 'arc': {
        this.tone(t, 0.25, 0.25 * v, 'sawtooth', 900 + Math.random() * 400, 160);
        this.noise(t, 0.3, 0.3 * v, 'highpass', 3000, 1200, 2);
        break;
      }
      case 'hitSmall': this.noise(t, 0.12, 0.25 * v, 'lowpass', 2500, 300, 1); break;
      case 'explosion': this.noise(t, 0.6, 0.7 * v, 'lowpass', 1500, 60, 0.7); this.tone(t, 0.5, 0.45 * v, 'sine', 90, 28); break;
      case 'bigExplosion':
        this.noise(t, 1.3, 0.9 * v, 'lowpass', 1200, 40, 0.7);
        this.tone(t, 1.0, 0.6 * v, 'sine', 70, 22);
        this.noise(t + 0.12, 0.9, 0.4 * v, 'lowpass', 700, 50, 0.7);
        break;
      case 'infantryDown': this.noise(t, 0.15, 0.18 * v, 'bandpass', 500, 250, 1.5); break;
      case 'click': this.tone(t, 0.04, 0.12 * v, 'square', 1400, 1200); break;
      case 'select': this.tone(t, 0.06, 0.12 * v, 'triangle', 880, 1320); break;
      case 'ack': this.tone(t, 0.05, 0.12 * v, 'triangle', 660, 660); this.tone(t + 0.06, 0.07, 0.12 * v, 'triangle', 990, 990); break;
      case 'error': this.tone(t, 0.12, 0.15 * v, 'square', 220, 180); this.tone(t + 0.13, 0.15, 0.15 * v, 'square', 180, 140); break;
      case 'place': this.noise(t, 0.2, 0.4 * v, 'lowpass', 800, 100, 1); this.tone(t, 0.15, 0.3 * v, 'square', 120, 60); break;
      case 'complete': [523, 659, 784].forEach((f, i) => this.tone(t + i * 0.08, 0.18, 0.13 * v, 'triangle', f, f)); break;
      case 'ready': [587, 880].forEach((f, i) => this.tone(t + i * 0.09, 0.14, 0.12 * v, 'triangle', f, f)); break;
      case 'alert': for (let i = 0; i < 3; i++) this.tone(t + i * 0.18, 0.12, 0.14 * v, 'square', 740, 740); break;
      case 'sweep': this.tone(t, 1.2, 0.18 * v, 'sine', 300, 1400); this.tone(t + 0.2, 1.0, 0.1 * v, 'sine', 600, 2000); break;
      case 'cash': this.tone(t, 0.05, 0.08 * v, 'square', 1800, 1800); break;
      case 'victory': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.16, 0.5, 0.18 * v, 'triangle', f, f)); break;
      case 'defeat': [440, 392, 349, 262].forEach((f, i) => this.tone(t + i * 0.3, 0.6, 0.18 * v, 'sawtooth', f, f * 0.98)); break;
    }
  }

  // ------------------------------------------------------------- music

  /** Procedural, looping military-synth score scheduled ahead with a lookahead timer. */
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.musicStep = 0;
    this.musicNext = this.ctx.currentTime + 0.1;
    this.scheduleMusic();
  }
  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }
  private scheduleMusic() {
    if (!this.musicOn || !this.ctx) return;
    const ctx = this.ctx;
    const bpm = 104;
    const step = 60 / bpm / 4; // 16th notes
    // Minor-key progression (Am, F, C, G / Dm, Am, E, Am), one chord per bar.
    const progA = [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]];
    const progB = [[38, 45, 50, 53], [45, 52, 57, 60], [40, 47, 52, 56], [45, 52, 57, 60]];
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    while (this.musicNext < ctx.currentTime + 0.25) {
      const s = this.musicStep;
      const t = this.musicNext;
      const bar = Math.floor(s / 16) % 4;
      if (s % 64 === 0) this.section = (this.section + 1) % 4;
      const prog = this.section % 2 === 0 ? progA : progB;
      const chord = prog[bar];
      const intense = this.section >= 2;
      const g = this.musicGain;
      // Bass ostinato
      if (s % 2 === 0) {
        const pattern = [0, 0, 12, 0, 0, 7, 0, 12];
        const n = chord[0] - 12 + pattern[(s / 2) % 8];
        this.tone(t, step * 1.8, 0.22, 'sawtooth', midi(n), midi(n), g, 0.01);
      }
      // Kick & snare-like noise
      if (s % 4 === 0) this.tone(t, 0.18, 0.5, 'sine', 120, 40, g, 0.002);
      if (s % 8 === 4) this.noise(t, 0.16, intense ? 0.28 : 0.18, 'bandpass', 1800, 900, 0.7, g);
      if (intense && s % 2 === 1) this.noise(t, 0.04, 0.06, 'highpass', 7000, 5000, 1, g);
      // Pad on each bar
      if (s % 16 === 0) for (const n of chord.slice(1)) this.tone(t, step * 15, 0.05, 'triangle', midi(n), midi(n), g, 0.4);
      // Lead arpeggio in later sections
      if (this.section !== 0 && s % 4 === 2) {
        const n = chord[(s / 4 + bar) % 4 | 0] + 12;
        this.tone(t, step * 2.5, 0.05, 'square', midi(n), midi(n), g, 0.01);
      }
      this.musicNext += step;
      this.musicStep++;
    }
    this.musicTimer = setTimeout(() => this.scheduleMusic(), 100);
  }

  // ------------------------------------------------------------- announcer

  private lastSpeech = 0;
  /** Spoken notifications via the browser's speech synthesis (optional). */
  say(text: string) {
    if (!getSettings().announcer || typeof speechSynthesis === 'undefined') return;
    const now = performance.now();
    if (now - this.lastSpeech < 1500) return;
    this.lastSpeech = now;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 0.75;
      u.volume = Math.min(1, getSettings().sfxVolume + 0.2);
      speechSynthesis.speak(u);
    } catch {
      /* not supported */
    }
  }
}

export const audio = new AudioEngine();
