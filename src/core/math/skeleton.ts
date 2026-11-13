import type { Bone, PuppetDef, Vec2 } from '../../types';
import { add, angleOf, clamp, dist, rotate, scale, sub, wrapAngle } from './vec2';

export interface BoneWorld {
  /** 世界(影人本地)原点 */
  origin: Vec2;
  /** 世界旋转(弧度) */
  rotation: number;
  /** 末端位置 */
  tip: Vec2;
}

export type Pose = Map<string, number>; // boneId -> 相对静止的旋转增量

/** 由姿态增量计算所有骨骼的世界变换 */
export function solveSkeleton(def: PuppetDef, poseDelta: Pose): Map<string, BoneWorld> {
  const byId = new Map(def.bones.map((b) => [b.id, b]));
  const out = new Map<string, BoneWorld>();

  const visit = (bone: Bone): BoneWorld => {
    const cached = out.get(bone.id);
    if (cached) return cached;

    let parentRot = 0;
    let parentOrigin: Vec2 = [0, 0];
    if (bone.parentId) {
      const p = byId.get(bone.parentId);
      if (!p) throw new Error(`骨骼 ${bone.id} 找不到父节点 ${bone.parentId}`);
      const pw = visit(p);
      parentRot = pw.rotation;
      parentOrigin = pw.origin;
    }
    const localRot = bone.restRotation + (poseDelta.get(bone.id) ?? 0);
    const worldRot = parentRot + localRot;
    const origin = add(parentOrigin, rotate(bone.restLocal, parentRot));
    const tip = add(origin, rotate([bone.length, 0], worldRot));
    const w: BoneWorld = { origin, rotation: worldRot, tip };
    out.set(bone.id, w);
    return w;
  };

  def.bones.forEach(visit);
  return out;
}

/** 静止姿态(无增量)下的世界变换,用于绑定/对位 */
export function restWorld(def: PuppetDef): Map<string, BoneWorld> {
  return solveSkeleton(def, new Map());
}

/** 把关节限制应用到姿态增量上 */
export function applyLimits(def: PuppetDef, poseDelta: Pose): void {
  for (const b of def.bones) {
    if (!b.limits) continue;
    const cur = poseDelta.get(b.id) ?? 0;
    poseDelta.set(b.id, clamp(wrapAngle(cur), b.limits[0], b.limits[1]));
  }
}

export interface IkResult {
  rootDelta: number;
  midDelta: number;
}

/**
 * 两骨解析 IK(屏幕坐标,y 向下)。
 * @param root  肩关节世界坐标
 * @param mid   肘(静止/当前)世界坐标 —— 用来推断弯曲方向
 * @param end   腕当前坐标
 * @param target 目标点
 * @param l1 上臂长度 l2 前臂长度
 * @param pole 弯曲方向偏好
 * @returns root/mid 两块骨的世界绝对旋转角
 */
export function solveTwoBoneIk(
  root: Vec2,
  mid: Vec2,
  end: Vec2,
  target: Vec2,
  l1: number,
  l2: number,
  pole: 1 | -1,
): IkResult {
  const toTarget = sub(target, root);
  let d = dist(target, root);
  const maxReach = l1 + l2 - 1e-4;
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, maxReach);
  const dir = (() => {
    const l = Math.hypot(toTarget[0], toTarget[1]);
    return l < 1e-9 ? [1, 0] as Vec2 : scale(toTarget, 1 / l);
  })();

  // 余弦定理求肘关节角
  const cosMid = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
  let midBend = Math.acos(cosMid); // 内角
  // 当前弯曲侧:用 (mid-root) 与 (end-root) 的叉积符号判断
  const a = sub(mid, root);
  const b = sub(end, root);
  const currentSide = a[0] * b[1] - a[1] * b[0];
  const side = currentSide === 0 ? pole : Math.sign(currentSide) as 1 | -1;

  const baseAng = angleOf(dir);
  const cosRoot = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const rootAng = baseAng - side * Math.acos(cosRoot);
  // mid 骨的世界角:root 骨世界角 + 弯折
  const midAng = rootAng + side * (Math.PI - midBend);
  return { rootDelta: rootAng, midDelta: midAng };
}

/**
 * 对一条 IK 链求解并写回姿态增量(带限制松弛)。
 * @param chainDef root/mid/end 骨骼 id
 * @param target 影人本地空间目标
 * @param poseDelta 读写的姿态增量
 * @returns 是否命中
 */
export function applyIkChain(
  def: PuppetDef,
  chainDef: { rootBoneId: string; midBoneId: string; endBoneId: string; pole: 1 | -1 },
  target: Vec2,
  poseDelta: Pose,
): boolean {
  const byId = new Map(def.bones.map((b) => [b.id, b]));
  const root = byId.get(chainDef.rootBoneId)!;
  const mid = byId.get(chainDef.midBoneId)!;
  const endB = byId.get(chainDef.endBoneId)!;

  // 先迭代若干轮:解 IK -> 应用关节限制 -> 重解,让限制与 IK 互相妥协
  let hit = false;
  for (let iter = 0; iter < 6; iter++) {
    const world = solveSkeleton(def, poseDelta);
    const rw = world.get(root.id)!;
    const mw = world.get(mid.id)!;
    // 末端效应器 = endBone 的关节原点(腕/踝),不是它的 tip(手柄拖的就是关节点)
    const ew = world.get(endB.id)!;
    const effector: Vec2 = ew.origin;

    const res = solveTwoBoneIk(rw.origin, mw.origin, effector, target, root.length, mid.length, chainDef.pole);

    // 世界角 -> 相对父节点局部角 -> 相对静止增量
    const rootParentRot = root.parentId ? world.get(root.parentId)!.rotation : 0;
    const rootDelta = wrapAngle(res.rootDelta - rootParentRot - root.restRotation);
    const midDelta = wrapAngle(res.midDelta - res.rootDelta - mid.restRotation);

    poseDelta.set(root.id, rootDelta);
    poseDelta.set(mid.id, midDelta);

    // 限制
    const before = [poseDelta.get(root.id)!, poseDelta.get(mid.id)!];
    applyLimits(def, poseDelta);
    const after = [poseDelta.get(root.id)!, poseDelta.get(mid.id)!];

    const limited = Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]);
    const reached = dist(effector, target) < 2;
    hit = reached;
    if (limited < 1e-4 || reached) break;
  }
  return hit;
}

/** 部件锚点 -> 实例内世界坐标与旋转(供 CPU 拾取/包围盒) */
export function anchorTransform(
  def: PuppetDef,
  world: Map<string, BoneWorld>,
  anchor: { boneId: string; offset: Vec2; followRotation: boolean; rotationOffset: number },
): { pos: Vec2; rotation: number } {
  const bw = world.get(anchor.boneId)!;
  const pos = add(bw.origin, rotate(anchor.offset, bw.rotation));
  const rotation = anchor.followRotation ? bw.rotation + anchor.rotationOffset : anchor.rotationOffset;
  return { pos, rotation };
}
