// 音效：原版的十段 wav，走 Web Audio。
//
// App 端（QuickJS 宿主）没有音频 API，这个模块整个变成空操作——比赛照跑，
// 只是没声音。浏览器里 AudioContext 必须在用户手势里创建，所以由「开始」
// 按钮调 unlock()。
const NAMES = ['engine_low', 'engine_high', 'skid', 'rumble', 'count', 'go', 'lap', 'best', 'checkpoint', 'bump'] as const;
type Name = (typeof NAMES)[number];

const ONE_SHOT_GAIN: Partial<Record<Name, number>> = {
  count: 0.9,
  go: 1,
  lap: 0.9,
  best: 1,
  checkpoint: 0.5,
  bump: 0.8,
};

interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type Ctx = AudioContext;

export class Sounds {
  private ctx: Ctx | null = null;
  private buffers = new Map<Name, AudioBuffer>();
  private loops: Partial<Record<'low' | 'high' | 'skid' | 'rumble', Loop>> = {};
  private master: GainNode | null = null;
  muted = false;

  get available(): boolean {
    return typeof (globalThis as { AudioContext?: unknown }).AudioContext === 'function';
  }

  /** 在用户手势里调用。 */
  unlock(): void {
    if (!this.available) return;
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);
    for (const name of NAMES) {
      fetch(`/sounds/${name}.wav`)
        .then((r) => r.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => {
          this.buffers.set(name, buffer);
          this.startLoops();
        })
        .catch((e: unknown) => console.warn(`[sounds] ${name}: ${String(e)}`));
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.7;
  }

  play(name: Name, rateVariance = 0): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !buffer || !this.master) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (rateVariance) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * rateVariance;
    const gain = ctx.createGain();
    gain.gain.value = ONE_SHOT_GAIN[name] ?? 1;
    source.connect(gain).connect(this.master);
    source.start();
  }

  /** 每帧：引擎两段按转速交叉淡入并变调，打滑和压草的循环按强度开关。 */
  update(revs: number, skid: number, rumble: number, running: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const band = (centre: number) => Math.max(0, 1 - Math.abs(revs - centre) / 0.5);
    const set = (loop: Loop | undefined, gain: number, rate?: number) => {
      if (!loop) return;
      loop.gain.gain.setTargetAtTime(running ? gain : 0, t, 0.05);
      if (rate !== undefined) loop.source.playbackRate.setTargetAtTime(rate, t, 0.05);
    };
    set(this.loops.low, 0.55 * band(0.35), 0.75 + revs * 0.6);
    set(this.loops.high, 0.55 * band(0.85), 0.7 + revs * 0.5);
    set(this.loops.skid, 0.85 * skid);
    set(this.loops.rumble, 0.7 * rumble);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  private startLoops(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const want: ['low' | 'high' | 'skid' | 'rumble', Name][] = [
      ['low', 'engine_low'],
      ['high', 'engine_high'],
      ['skid', 'skid'],
      ['rumble', 'rumble'],
    ];
    for (const [key, name] of want) {
      if (this.loops[key]) continue;
      const buffer = this.buffers.get(name);
      if (!buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start();
      this.loops[key] = { source, gain };
    }
  }
}
