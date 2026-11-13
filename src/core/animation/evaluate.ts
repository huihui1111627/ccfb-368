import type { AnimChannel, Keyframe, PuppetDef, PuppetInstance, Timeline, Vec2 } from '../../types';
import { applyIkChain, type Pose } from '../math/skeleton';
import { clamp, cubicBezierEase, lerp, wrapAngle } from '../math/vec2';

/** 在一条通道上按时间 t 采样,返回插值后的 value */
export function sampleChannel(ch: AnimChannel, t: number): number[] | null {
  const kfs = ch.keyframes;
  if (kfs.length === 0) return null;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return [...sorted[0].value];
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return [...last.value];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = Math.max(1e-6, b.t - a.t);
      const x = (t - a.t) / span;
      const ease = cubicBezierEase(a.ease[0], a.ease[1], a.ease[2], a.ease[3])(x);
      return a.value.map((av, idx) => {
        const bv = b.value[idx] ?? av;
        if (ch.type === 'boneRotation') {
          // 角度走最短弧
          return av + wrapAngle(bv - av) * ease;
        }
        return lerp(av, bv, ease);
      });
    }
  }
  return [...last.value];
}

export interface RootTransform {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface EvaluatedScene {
  /** 每个实例的姿态增量(boneId -> 旋转增量) */
  poses: Map<string, Pose>;
  /** 每个实例的根变换覆盖(x,y,rotation,scale) */
  roots: Map<string, RootTransform>;
  /** 当前 IK 目标(供编辑器叠加显示) */
  ikTargets: Map<string, Map<string, Vec2>>; // instanceId -> chainId -> target
}

/**
 * 求整个时间线在 t 时刻的场景姿态。
 * @param livePose 编辑器里未关键帧化的实时拖拽姿态(优先级高于动画)
 * @param liveIk 编辑器里实时 IK 目标
 */
export function evaluateTimeline(
  timeline: Timeline,
  defs: Map<string, PuppetDef>,
  instances: PuppetInstance[],
  t: number,
  livePose?: Map<string, Pose>,
  liveIk?: Map<string, Map<string, Vec2>>,
): EvaluatedScene {
  const poses = new Map<string, Pose>();
  const roots = new Map<string, RootTransform>();
  const ikTargets = new Map<string, Map<string, Vec2>>();

  for (const inst of instances) {
    const pose: Pose = new Map();
    const ik = new Map<string, Vec2>();
    poses.set(inst.id, pose);
    ikTargets.set(inst.id, ik);
    roots.set(inst.id, { x: inst.x, y: inst.y, rotation: inst.rotation, scale: inst.scale });
  }

  // 1) 关键帧通道采样
  for (const ch of timeline.channels) {
    const val = sampleChannel(ch, t);
    if (!val) continue;
    const pose = poses.get(ch.instanceId);
    if (!pose) continue;
    if (ch.type === 'boneRotation') {
      if (ch.targetId === 'root') {
        const r = roots.get(ch.instanceId)!;
        // root 通道 value: [x, y, rotation(可选), scale(可选)]
        r.x = val[0] ?? r.x;
        r.y = val[1] ?? r.y;
        if (val.length >= 3) r.rotation = val[2];
        if (val.length >= 4) r.scale = val[3];
      } else {
        pose.set(ch.targetId, val[0] ?? 0);
      }
    } else if (ch.type === 'ikTarget') {
      ikTargets.get(ch.instanceId)!.set(ch.targetId, [val[0], val[1]]);
    }
  }

  // 2) 实时编辑姿态覆盖(拖拽中)
  if (livePose) {
    for (const [instId, p] of livePose) {
      const target = poses.get(instId);
      if (!target) continue;
      for (const [bid, rot] of p) target.set(bid, rot);
    }
  }
  if (liveIk) {
    for (const [instId, m] of liveIk) {
      const target = ikTargets.get(instId);
      if (!target) continue;
      for (const [cid, v2] of m) target.set(cid, v2);
    }
  }

  // 3) IK 求解(在动画/实时目标合并之后)
  for (const inst of instances) {
    const def = defs.get(inst.defId);
    if (!def) continue;
    const pose = poses.get(inst.id)!;
    const ik = ikTargets.get(inst.id)!;
    for (const chain of inst.ikChains) {
      const target = ik.get(chain.id);
      if (!target) continue;
      applyIkChain(def, chain, target, pose);
    }
  }

  return { poses, roots, ikTargets };
}

/** 把当前 IK 目标烘焙成 boneRotation 关键帧(导出动作 JSON 时可选用) */
export function bakeIkToRotation(
  def: PuppetDef,
  inst: PuppetInstance,
  target: Vec2,
): { rootDelta: number; midDelta: number; rootBoneId: string; midBoneId: string } {
  const pose: Pose = new Map();
  const chain = inst.ikChains[0];
  applyIkChain(def, chain, target, pose);
  return {
    rootDelta: pose.get(chain.rootBoneId) ?? 0,
    midDelta: pose.get(chain.midBoneId) ?? 0,
    rootBoneId: chain.rootBoneId,
    midBoneId: chain.midBoneId,
  };
}

/** 新建关键帧的默认缓动:缓入缓出 */
export function defaultEase(): [number, number, number, number] {
  return [0.42, 0, 0.58, 1];
}

export function linearEase(): [number, number, number, number] {
  return [0, 0, 1, 1];
}

export function makeKeyframe(tSec: number, value: number[], ease = defaultEase()): Keyframe {
  return { id: `kf_${Math.random().toString(36).slice(2, 10)}`, t: tSec, value, ease };
}

/** 通道里在指定时间 ±tolerance 内是否已有关键帧 */
export function findKeyframeAt(ch: AnimChannel, t: number, tolerance = 0.05): Keyframe | undefined {
  return ch.keyframes.find((k) => Math.abs(k.t - t) < tolerance);
}

export function clampTime(t: number, timeline: Timeline): number {
  return clamp(t, 0, timeline.duration);
}
