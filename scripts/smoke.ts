// 纯逻辑冒烟测试:数学、骨架、IK、缓动、动画求值(不依赖 DOM/WebGL)
import { cubicBezierEase, rad, wrapAngle } from '../src/core/math/vec2';
import { applyIkChain, solveSkeleton, applyLimits } from '../src/core/math/skeleton';
import { sampleChannel } from '../src/core/animation/evaluate';
import type { AnimChannel, Bone, PuppetDef, Vec2 } from '../src/types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${name} ${extra}`); }
}

// 1. 缓动:端点与单调性
const ease = cubicBezierEase(0.42, 0, 0.58, 1);
check('ease(0)=0', Math.abs(ease(0)) < 1e-9);
check('ease(1)=1', Math.abs(ease(1) - 1) < 1e-9);
let mono = true;
let prev = -1;
for (let i = 0; i <= 50; i++) { const y = ease(i / 50); if (y < prev - 1e-9) mono = false; prev = y; }
check('缓动单调不减', mono);
check('wrapAngle 归位', Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapAngle(Math.PI * 3) + Math.PI) < 1e-9);

// 2. 构造最小骨架测 IK:root -> mid -> end(末端为零长标记骨,效应器是其关节原点)
const mkBone = (id: string, parent: string | null, local: Vec2, restRot: number, len: number, limits: [number, number] | null): Bone => ({
  id, name: id, parentId: parent, restLocal: local, restRotation: restRot, limits, length: len,
});
const def: PuppetDef = {
  id: 't', name: 't', kind: 'procedural', atlasSize: 64,
  bones: [
    mkBone('root', null, [0, 0], 0, 50, null),
    mkBone('mid', 'root', [50, 0], 0, 50, [rad(-150), rad(10)]),
    mkBone('end', 'mid', [50, 0], 0, 0, null),
  ],
  parts: [], caps: [],
  palette: { leather: '#000', leatherDark: '#000', accent: '#000', ink: '#000' },
  createdAt: 0,
};

// 静止姿态末端(腕关节原点)在 (100,0),两骨臂展 = 50+50 = 100
const rest = solveSkeleton(def, new Map());
check('静止末端 x=100', Math.abs(rest.get('end')!.origin[0] - 100) < 1e-6, `got ${rest.get('end')!.origin[0]}`);
check('静止末端 y=0', Math.abs(rest.get('end')!.origin[1]) < 1e-6);

// IK:把末端拖到正下方 (50, 86.6),两骨等长 50,可达
const pose = new Map<string, number>();
applyIkChain(def, { rootBoneId: 'root', midBoneId: 'mid', endBoneId: 'end', pole: 1 }, [50, 86.6], pose);
const solved = solveSkeleton(def, pose);
const tip = solved.get('end')!.origin;
check('IK 命中目标 x', Math.abs(tip[0] - 50) < 1.5, `got ${tip[0]}`);
check('IK 命中目标 y', Math.abs(tip[1] - 86.6) < 1.5, `got ${tip[1]}`);

// IK 超距:目标在最大臂展外,应被钳制而非发散
const pose2 = new Map<string, number>();
applyIkChain(def, { rootBoneId: 'root', midBoneId: 'mid', endBoneId: 'end', pole: 1 }, [999, 0], pose2);
const s2 = solveSkeleton(def, pose2);
const tip2 = s2.get('end')!.origin;
check('IK 超距钳制在臂展内', Math.hypot(tip2[0], tip2[1]) <= 100.5, `got ${Math.hypot(tip2[0], tip2[1])}`);

// 3. 关节限位
const pose3 = new Map([['mid', rad(80)]]);
applyLimits(def, pose3);
check('限位钳制上限', Math.abs((pose3.get('mid') ?? 0) - rad(10)) < 1e-9);

// 4. 关键帧采样:线性 + 角度最短弧
const ch: AnimChannel = {
  id: 'c', instanceId: 'i', type: 'boneRotation', targetId: 'b',
  keyframes: [
    { id: 'a', t: 0, value: [0], ease: [0, 0, 1, 1] },
    { id: 'b', t: 1, value: [rad(90)], ease: [0, 0, 1, 1] },
  ],
};
const midVal = sampleChannel(ch, 0.5)!;
check('线性中点插值', Math.abs(midVal[0] - rad(45)) < 1e-9);
const before = sampleChannel(ch, -1)!;
check('时间钳制到首帧', before[0] === 0);
const after = sampleChannel(ch, 5)!;
check('时间钳制到末帧', Math.abs(after[0] - rad(90)) < 1e-9);

// 角度最短弧:从 170° 到 -170°,中点应靠近 180° 而不是绕远
const ch2: AnimChannel = {
  id: 'c2', instanceId: 'i', type: 'boneRotation', targetId: 'b',
  keyframes: [
    { id: 'a', t: 0, value: [rad(170)], ease: [0, 0, 1, 1] },
    { id: 'b', t: 1, value: [rad(-170)], ease: [0, 0, 1, 1] },
  ],
};
const wrap = sampleChannel(ch2, 0.5)![0];
check('角度走最短弧', Math.abs(Math.abs(wrap) - Math.PI) < 0.01, `got ${wrap}`);

console.log(`\n逻辑测试:${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
