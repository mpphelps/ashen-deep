// Web Audio playback for the browser version. Sounds are synthesized in a worker (no stutter), then played
// through a mixer: effects on one bus, music on another with crossfades.
const VOL: Record<string, number> = { warn: 0.65, ashes: 0.7, menu: 0.7, talk: 0.8 };
export type AudioMode = 0 | 1 | 2;
export const AUDIO_MODE_NAMES = ['music + sound', 'sound only', 'muted'];

export class WebAudio {
  ctx: AudioContext | null = null;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  sfx = new Map<string, AudioBuffer>();
  music = new Map<string, AudioBuffer>();
  current: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  want: string | null = null;
  mode: AudioMode = 0;
  last: Record<string, number> = {};
  started = false;

  /** Browsers only allow audio after a key press or click. */
  unlock(firstTrack: string | null): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    this.started = true;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.ctx.destination);
    try {
      const w = new Worker('music-worker.js');
      w.onmessage = (ev: MessageEvent) => {
        const { kind, id, sr, data } = ev.data as { kind: string; id: string; sr: number; data: Float32Array };
        if (kind === 'done') return w.terminate();
        const buf = this.ctx!.createBuffer(1, data.length, sr);
        buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        (kind === 'sfx' ? this.sfx : this.music).set(id, buf);
        if (kind === 'music' && id === this.want && !this.current) this.setMusic(id);
      };
      w.postMessage({ first: firstTrack });
    } catch {
      // no workers (e.g. opened from file://): stay silent rather than freeze the page
    }
  }

  play(id: string): void {
    if (!this.ctx || this.mode === 2) return;
    const b = this.sfx.get(id);
    if (!b) return;
    const now = performance.now();
    if (now - (this.last[id] ?? 0) < 45) return;
    this.last[id] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = VOL[id] ?? 1;
    src.connect(g).connect(this.sfxBus);
    src.start();
  }

  setMusic(id: string | null): void {
    this.want = id;
    if (!this.ctx) return;
    const target = this.mode === 0 ? id : null;
    if (this.current?.id === target) return;
    const t = this.ctx.currentTime;
    if (this.current) {
      const old = this.current;
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 1.5);
      old.src.stop(t + 1.6);
      this.current = null;
    }
    if (!target) return;
    const b = this.music.get(target);
    if (!b) return; // arrives from the worker shortly; picked up then
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 2);
    src.connect(g).connect(this.musicBus);
    src.start();
    this.current = { id: target, src, gain: g };
  }

  cycleMode(): AudioMode {
    this.mode = ((this.mode + 1) % 3) as AudioMode;
    const w = this.want;
    this.setMusic(null);
    this.want = w;
    this.setMusic(w);
    return this.mode;
  }
}
