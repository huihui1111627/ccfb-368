import type { PuppetDef, PuppetInstance, Vec2 } from '../types';
import { evaluateTimeline, type EvaluatedScene } from '../core/animation/evaluate';
import type { Pose } from '../core/math/skeleton';
import { Store } from '../core/state/store';
import { Renderer } from '../render/Renderer';
import { ViewportController } from '../render/ViewportController';

/**
 * 应用上下文:一个 Renderer + 一个 rAF 渲染循环,五个页面共享。
 * 编辑期的实时姿态(livePose / liveIk)独立于时间线,拖拽时优先。
 */
export class AppContext {
  store: Store;
  renderer: Renderer;
  controller: ViewportController;
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;

  /** instanceId -> 姿态增量(未关键帧化的实时编辑) */
  livePose = new Map<string, Pose>();
  /** instanceId -> chainId -> IK 目标(实时) */
  liveIk = new Map<string, Map<string, Vec2>>();

  currentTime = 0;
  playing = false;
  /** 真实显示帧率(按 rAF 间隔统计,受显示器 vsync 约束) */
  displayFps = 60;
  private frameIntervals: number[] = [];
  private rafId = 0;
  private lastTs = 0;
  private scene: EvaluatedScene | null = null;
  private frameListeners = new Set<(t: number) => void>();
  private timeListeners = new Set<(t: number) => void>();
  mode: 'edit' | 'play' = 'edit';

  constructor(store: Store, canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.store = store;
    this.canvas = canvas;
    this.overlay = overlay;
    this.renderer = new Renderer(canvas);
    this.controller = new ViewportController(
      this.renderer,
      store,
      overlay,
      () => this.computeScene(),
      () => this.defs(),
    );

    // 实时 IK 拖拽:写入 liveIk
    this.controller.ikCallback = (instanceId, chainId, target) => {
      if (!this.liveIk.has(instanceId)) this.liveIk.set(instanceId, new Map());
      this.liveIk.get(instanceId)!.set(chainId, target);
    };
    // 实时关节旋转:写入 livePose
    this.controller.rotationCallback = (instanceId, boneId, delta) => {
      if (!this.livePose.has(instanceId)) this.livePose.set(instanceId, new Map());
      const def = this.store.getPuppetDef(this.store.state.instances.find((i) => i.id === instanceId)!.defId)!;
      const bone = def.bones.find((b) => b.id === boneId);
      let v = delta;
      if (bone?.limits) v = Math.max(bone.limits[0], Math.min(bone.limits[1], v));
      this.livePose.get(instanceId)!.set(boneId, v);
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(320, Math.round(r.width * dpr));
      const hgt = Math.max(240, Math.round(r.height * dpr));
      canvas.width = w;
      canvas.height = hgt;
      overlay.width = w;
      overlay.height = hgt;
      this.renderer.resize(w, hgt);
    };
    const ro = new ResizeObserver(resize);
    // canvas 可能尚未挂入 DOM,轮询到有父节点再观察
    const arm = () => {
      if (canvas.parentElement) {
        ro.observe(canvas.parentElement);
        resize();
      } else {
        requestAnimationFrame(arm);
      }
    };
    arm();

    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);

    // 调试/自动化钩子
    (window as unknown as { __SHADOW_APP__?: AppContext }).__SHADOW_APP__ = this;
  }

  defs(): Map<string, PuppetDef> {
    return new Map(this.store.state.puppets.map((p) => [p.id, p]));
  }

  /** 按当前时间 + 实时编辑量求场景 */
  computeScene(): EvaluatedScene {
    this.scene = evaluateTimeline(
      this.store.state.timeline,
      this.defs(),
      this.store.state.instances,
      this.currentTime,
      this.livePose.size ? this.livePose : undefined,
      this.liveIk.size ? this.liveIk : undefined,
    );
    return this.scene;
  }

  getScene(): EvaluatedScene {
    return this.scene ?? this.computeScene();
  }

  onFrame(fn: (t: number) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onTime(fn: (t: number) => void): () => void {
    this.timeListeners.add(fn);
    return () => this.timeListeners.delete(fn);
  }

  setTime(t: number) {
    this.currentTime = Math.max(0, Math.min(this.store.state.timeline.duration, t));
    for (const fn of this.timeListeners) fn(this.currentTime);
  }

  play() {
    this.playing = true;
    this.mode = 'play';
  }

  pause() {
    this.playing = false;
    this.mode = 'edit';
  }

  /** 清空实时编辑姿态(关键帧烘焙后调用) */
  clearLive() {
    this.livePose.clear();
    this.liveIk.clear();
  }

  /** 把当前 live 姿态烘焙成时间线关键帧 */
  bakeKeyframe(instance: PuppetInstance) {
    const t = this.currentTime;
    const tl = this.store.state.timeline;
    const pose = this.livePose.get(instance.id);
    if (pose) {
      for (const [boneId, delta] of pose) {
        this.upsertKeyframe(instance.id, 'boneRotation', boneId, t, [delta]);
      }
    }
    const ik = this.liveIk.get(instance.id);
    if (ik) {
      for (const [chainId, target] of ik) {
        this.upsertKeyframe(instance.id, 'ikTarget', chainId, t, [target[0], target[1]]);
      }
    }
    // root 变换也记录
    this.upsertKeyframe(instance.id, 'boneRotation', 'root', t, [instance.x, instance.y, instance.rotation, instance.scale]);
  }

  private upsertKeyframe(instanceId: string, type: 'boneRotation' | 'ikTarget', targetId: string, t: number, value: number[]) {
    const tl = this.store.state.timeline;
    let ch = tl.channels.find((c) => c.instanceId === instanceId && c.type === type && c.targetId === targetId);
    if (!ch) {
      ch = {
        id: `ch_${Math.random().toString(36).slice(2, 10)}`,
        instanceId,
        type,
        targetId,
        keyframes: [],
      };
      tl.channels.push(ch);
    }
    const tol = 0.06;
    const exist = ch.keyframes.find((k) => Math.abs(k.t - t) < tol);
    if (exist) {
      exist.value = value;
      exist.t = t;
    } else {
      ch.keyframes.push({
        id: `kf_${Math.random().toString(36).slice(2, 10)}`,
        t,
        value,
        ease: [0.42, 0, 0.58, 1],
      });
      ch.keyframes.sort((a, b) => a.t - b.t);
    }
  }

  private loop(ts: number) {
    const dt = this.lastTs ? (ts - this.lastTs) / 1000 : 0;
    this.lastTs = ts;
    if (dt > 0 && dt < 1) {
      this.frameIntervals.push(dt);
      if (this.frameIntervals.length > 60) this.frameIntervals.shift();
      const avg = this.frameIntervals.reduce((a, b) => a + b, 0) / this.frameIntervals.length;
      this.displayFps = Math.round(1 / avg);
    }
    if (this.playing) {
      const dur = this.store.state.timeline.duration;
      this.currentTime += dt;
      if (this.currentTime >= dur) this.currentTime = 0; // 循环播放
      for (const fn of this.timeListeners) fn(this.currentTime);
    }
    const scene = this.computeScene();
    this.renderer.render(
      this.defs(),
      this.store.state.instances,
      scene,
      this.store.state.light,
      this.store.state.stageColor,
      ts / 1000,
      { pan: this.controller.pan, zoom: this.controller.zoom },
    );
    this.controller.drawOverlay(scene);
    for (const fn of this.frameListeners) fn(ts / 1000);
    this.rafId = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
  }
}
