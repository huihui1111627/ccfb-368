import type { Bone, JointCap, PuppetDef, PuppetPalette, PuppetPart, Vec2 } from '../../types';
import { rad, uid } from '../math/vec2';
import { buildAtlas } from './atlas';
import { carvedDot, carvedScroll, drawJointCap, drawLimb, leatherEdge, leatherFill } from './draw';

/* ------------------------------------------------------------------ */
/* 骨架声明式定义                                                       */
/* ------------------------------------------------------------------ */

interface BoneSpec {
  id: string;
  name: string;
  parent: string | null;
  /** 静止姿态的绝对世界坐标(关节点) */
  world: Vec2;
  /** 静止姿态的绝对世界旋转角(度,屏幕 y 向下,0=朝右) */
  worldDeg: number;
  length: number;
  limitDeg: [number, number];
}

// 直接给定自洽的绝对世界坐标与角度。人形直立,头在上(y 小),脚在下(y 大)。
function skeletonSpecs(): BoneSpec[] {
  return [
    { id: 'root', name: '腰根', parent: null, world: [0, 150], worldDeg: 90, length: 0, limitDeg: [-180, 180] },

    // 脊柱链:向上(-y),世界角 -90
    { id: 'spine', name: '躯干', parent: 'root', world: [0, 10], worldDeg: -90, length: 140, limitDeg: [-25, 25] },
    { id: 'neck', name: '颈', parent: 'spine', world: [0, -58], worldDeg: -90, length: 14, limitDeg: [-35, 35] },
    { id: 'head', name: '头', parent: 'neck', world: [0, -72], worldDeg: -90, length: 46, limitDeg: [-40, 40] },

    // 左臂:肩→肘→腕,自然下垂略向外
    { id: 'shoulderL', name: '左肩', parent: 'spine', world: [-12, 16], worldDeg: -135, length: 10, limitDeg: [-60, 60] },
    { id: 'elbowL', name: '左肘', parent: 'shoulderL', world: [-40, 44], worldDeg: -110, length: 48, limitDeg: [-130, 10] },
    { id: 'wristL', name: '左腕', parent: 'elbowL', world: [-58, 94], worldDeg: -98, length: 56, limitDeg: [-120, 20] },

    // 右臂:镜像
    { id: 'shoulderR', name: '右肩', parent: 'spine', world: [12, 16], worldDeg: -45, length: 10, limitDeg: [-60, 60] },
    { id: 'elbowR', name: '右肘', parent: 'shoulderR', world: [40, 44], worldDeg: -70, length: 48, limitDeg: [-10, 130] },
    { id: 'wristR', name: '右腕', parent: 'elbowR', world: [58, 94], worldDeg: -82, length: 56, limitDeg: [-20, 120] },

    // 左腿:髋→膝→踝,近竖直向下(90° 附近)
    { id: 'hipL', name: '左髋', parent: 'root', world: [-12, 150], worldDeg: 100, length: 12, limitDeg: [-50, 50] },
    { id: 'kneeL', name: '左膝', parent: 'hipL', world: [-22, 226], worldDeg: 95, length: 78, limitDeg: [-120, 10] },
    { id: 'ankleL', name: '左踝', parent: 'kneeL', world: [-16, 300], worldDeg: 88, length: 76, limitDeg: [-30, 90] },

    // 右腿:镜像
    { id: 'hipR', name: '右髋', parent: 'root', world: [12, 150], worldDeg: 80, length: 12, limitDeg: [-50, 50] },
    { id: 'kneeR', name: '右膝', parent: 'hipR', world: [22, 226], worldDeg: 85, length: 78, limitDeg: [-10, 120] },
    { id: 'ankleR', name: '右踝', parent: 'kneeR', world: [16, 300], worldDeg: 92, length: 76, limitDeg: [-90, 30] },
  ];
}

function buildBones(specs: BoneSpec[]): Bone[] {
  const worldMap = new Map(specs.map((s) => [s.id, s]));
  return specs.map((s) => {
    let restLocal: Vec2 = [...s.world];
    let restRotation = rad(s.worldDeg);
    if (s.parent) {
      const pw = worldMap.get(s.parent)!;
      // 世界坐标差,再反向旋转回父级局部系(父局部系相对世界旋转了 pw.worldDeg)
      const dx = s.world[0] - pw.world[0];
      const dy = s.world[1] - pw.world[1];
      const pa = rad(-pw.worldDeg);
      const c = Math.cos(pa), si = Math.sin(pa);
      restLocal = [dx * c - dy * si, dx * si + dy * c];
      restRotation = rad(s.worldDeg - pw.worldDeg);
    }
    return {
      id: s.id,
      name: s.name,
      parentId: s.parent,
      restLocal,
      restRotation,
      limits: [rad(s.limitDeg[0]), rad(s.limitDeg[1])],
      length: s.length,
    } satisfies Bone;
  });
}

/* ------------------------------------------------------------------ */
/* 躯干 / 头 / 袍摆 绘制                                                */
/* ------------------------------------------------------------------ */

function drawTorso(pal: PuppetPalette): HTMLCanvasElement {
  const w = 132, h = 188;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  const cx = w / 2;
  const path = () => {
    ctx.moveTo(cx - 30, 6);                 // 左肩
    ctx.quadraticCurveTo(cx, -2, cx + 30, 6);
    ctx.lineTo(cx + 52, h - 26);            // 右袍摆
    ctx.quadraticCurveTo(cx + 30, h - 4, cx, h - 8);
    ctx.quadraticCurveTo(cx - 30, h - 4, cx - 52, h - 26);
    ctx.closePath();
  };
  ctx.save();
  ctx.beginPath();
  path();
  ctx.clip();
  leatherFill(ctx, w, h, pal);
  // 中线衣襟
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, 14);
  ctx.lineTo(cx + 8, h - 30);
  ctx.stroke();
  // 对称卷草 + 镂空圆点
  carvedScroll(ctx, cx - 22, 60, 14, pal);
  carvedScroll(ctx, cx + 24, 92, 14, pal);
  carvedScroll(ctx, cx - 18, 130, 12, pal);
  for (const [dx, dy] of [[-12, 34], [14, 58], [-8, 104], [16, 140]] as const) {
    carvedDot(ctx, cx + dx, dy, 3, pal);
  }
  // 腰带
  ctx.fillStyle = pal.accent;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(cx - 48, 146, 96, 10);
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.beginPath();
  path();
  leatherEdge(ctx, pal, 2.4);
  return cvs;
}

function drawHead(pal: PuppetPalette, helmet: boolean): HTMLCanvasElement {
  const w = 76, h = 96;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  const cx = w / 2;
  // 侧脸轮廓(皮影传统为五分脸/侧脸)
  const path = () => {
    ctx.moveTo(cx - 6, 8);
    ctx.quadraticCurveTo(cx + 20, 4, cx + 24, 26);   // 额
    ctx.quadraticCurveTo(cx + 30, 38, cx + 22, 44);  // 鼻
    ctx.quadraticCurveTo(cx + 28, 52, cx + 18, 56);  // 嘴
    ctx.quadraticCurveTo(cx + 22, 74, cx + 2, 84);   // 下巴
    ctx.quadraticCurveTo(cx - 22, 78, cx - 20, 50);
    ctx.quadraticCurveTo(cx - 24, 22, cx - 6, 8);
    ctx.closePath();
  };
  ctx.save();
  ctx.beginPath();
  path();
  ctx.clip();
  leatherFill(ctx, w, h, pal);
  // 眼睛(镂刻)
  ctx.fillStyle = pal.ink;
  ctx.beginPath();
  ctx.ellipse(cx + 8, 34, 4.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  carvedDot(ctx, cx + 6, 50, 1.8, pal);
  ctx.restore();
  ctx.beginPath();
  path();
  leatherEdge(ctx, pal, 2);

  if (helmet) {
    // 武将盔:红色盔缨 + 盔体
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.moveTo(cx - 22, 16);
    ctx.quadraticCurveTo(cx, -14, cx + 22, 16);
    ctx.quadraticCurveTo(cx, 6, cx - 22, 16);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 文人巾
    ctx.fillStyle = pal.leatherDark;
    ctx.beginPath();
    ctx.moveTo(cx - 20, 18);
    ctx.quadraticCurveTo(cx - 6, -8, cx + 16, 10);
    ctx.lineTo(cx + 20, 20);
    ctx.quadraticCurveTo(cx, 12, cx - 20, 18);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  return cvs;
}

function drawHand(pal: PuppetPalette): HTMLCanvasElement {
  const s = 26;
  const cvs = document.createElement('canvas');
  cvs.width = s; cvs.height = s;
  const ctx = cvs.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  leatherFill(ctx, s, s, pal);
  carvedScroll(ctx, s / 2, s / 2, 6, pal, 1.1);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
  leatherEdge(ctx, pal, 1.4);
  return cvs;
}

function drawFoot(pal: PuppetPalette): HTMLCanvasElement {
  const w = 40, h = 22;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  const path = () => {
    ctx.moveTo(2, h / 2);
    ctx.quadraticCurveTo(6, 2, 18, 3);
    ctx.quadraticCurveTo(w - 2, 4, w - 3, h / 2);
    ctx.quadraticCurveTo(w - 4, h - 3, 16, h - 4);
    ctx.quadraticCurveTo(4, h - 2, 2, h / 2);
  };
  ctx.save();
  ctx.beginPath();
  path();
  ctx.clip();
  leatherFill(ctx, w, h, pal, false);
  carvedDot(ctx, 20, h / 2, 2.4, pal);
  ctx.restore();
  ctx.beginPath();
  path();
  leatherEdge(ctx, pal, 1.6);
  return cvs;
}

/* ------------------------------------------------------------------ */
/* 工厂主流程                                                           */
/* ------------------------------------------------------------------ */

export interface PuppetStyle {
  name: string;
  helmet: boolean;
  palette: PuppetPalette;
}

export const PUPPET_STYLES: PuppetStyle[] = [
  {
    name: '武将',
    helmet: true,
    palette: {
      leather: '#c8862f',
      leatherDark: '#8a5417',
      accent: '#b0342a',
      ink: '#2b1608',
    },
  },
  {
    name: '文人',
    helmet: false,
    palette: {
      leather: '#d8a94e',
      leatherDark: '#9c7128',
      accent: '#3f6b4f',
      ink: '#2a1c0a',
    },
  },
];

interface PartLayout {
  key: string;
  canvas: HTMLCanvasElement;
  part?: Omit<PuppetPart, 'uv' | 'size'>;
}

export function createProceduralPuppet(style: PuppetStyle): PuppetDef {
  const specs = skeletonSpecs();
  const bones = buildBones(specs);
  const pal = style.palette;
  const layouts: PartLayout[] = [];
  const PAD = 16; // 肢体两端外伸覆盖量,防关节露缝

  const addLimb = (
    key: string,
    name: string,
    boneId: string,
    len: number,
    thick: number,
    z: number,
    taper = 0.28,
  ) => {
    const bone = bones.find((b) => b.id === boneId)!;
    // 画布两端各外伸 PAD 盖住关节;部件中心沿骨方向前进半个【骨长】,精确跨在两关节间
    const canvas = drawLimb(len + PAD * 2, thick, PAD, pal, { taper, rings: 2 });
    layouts.push({
      key,
      canvas,
      part: {
        id: uid('part'),
        name,
        anchor: { boneId, offset: [bone.length / 2, 0], followRotation: true, rotationOffset: 0 },
        z,
        translucency: 0.28,
        opacity: 0.96,
      },
    });
  };

  // 四肢(部件挂在近端骨,沿骨方向延伸,两端外伸盖住关节)
  addLimb('armL1', '左上臂', 'shoulderL', 48, 26, 20);
  addLimb('armL2', '左前臂', 'elbowL', 56, 22, 21, 0.2);
  addLimb('armR1', '右上臂', 'shoulderR', 48, 26, 20);
  addLimb('armR2', '右前臂', 'elbowR', 56, 22, 21, 0.2);
  addLimb('legL1', '左大腿', 'hipL', 78, 30, 8);
  addLimb('legL2', '左小腿', 'kneeL', 76, 25, 9, 0.18);
  addLimb('legR1', '右大腿', 'hipR', 78, 30, 8);
  addLimb('legR2', '右小腿', 'kneeR', 76, 25, 9, 0.18);

  // 躯干:spine 骨朝上(-90°),躯干画布竖直绘制,加 90° 偏移使其与骨同向直立
  const spineBone = bones.find((b) => b.id === 'spine')!;
  const torso = drawTorso(pal);
  layouts.push({
    key: 'torso',
    canvas: torso,
    part: {
      id: uid('part'),
      name: '蟒袍躯干',
      anchor: { boneId: 'spine', offset: [spineBone.length / 2, 0], followRotation: true, rotationOffset: -Math.PI / 2 },
      z: 10,
      translucency: 0.22,
      opacity: 0.97,
    },
  });

  // 头:竖直画布,沿 head 骨(朝上)前移,让头探出颈顶而不被躯干盖住
  const headBone = bones.find((b) => b.id === 'head')!;
  const headC = drawHead(pal, style.helmet);
  layouts.push({
    key: 'head',
    canvas: headC,
    part: {
      id: uid('part'),
      name: style.helmet ? '武将头盔' : '文人巾首',
      anchor: { boneId: 'head', offset: [headBone.length + headC.height * 0.35, 0], followRotation: true, rotationOffset: -Math.PI / 2 },
      z: 30,
      translucency: 0.24,
      opacity: 0.97,
    },
  });

  // 手 / 足:中心直接落在腕/踝关节点(小幅前移更自然)
  const handL = drawHand(pal), handR = drawHand(pal);
  const footL = drawFoot(pal), footR = drawFoot(pal);
  layouts.push({
    key: 'handL', canvas: handL,
    part: { id: uid('part'), name: '左手', anchor: { boneId: 'wristL', offset: [4, 0], followRotation: true, rotationOffset: 0 }, z: 22, translucency: 0.3, opacity: 0.95 },
  });
  layouts.push({
    key: 'handR', canvas: handR,
    part: { id: uid('part'), name: '右手', anchor: { boneId: 'wristR', offset: [4, 0], followRotation: true, rotationOffset: 0 }, z: 22, translucency: 0.3, opacity: 0.95 },
  });
  layouts.push({
    key: 'footL', canvas: footL,
    part: { id: uid('part'), name: '左足', anchor: { boneId: 'ankleL', offset: [8, 2], followRotation: true, rotationOffset: 0 }, z: 7, translucency: 0.26, opacity: 0.96 },
  });
  layouts.push({
    key: 'footR', canvas: footR,
    part: { id: uid('part'), name: '右足', anchor: { boneId: 'ankleR', offset: [8, 2], followRotation: true, rotationOffset: 0 }, z: 7, translucency: 0.26, opacity: 0.96 },
  });

  // 关节帽:每个有长度的骨节点都盖一片圆皮,覆盖接缝
  const capBones = ['spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];
  const capRadius: Record<string, number> = {
    spine: 20, neck: 12,
    shoulderL: 15, elbowL: 13, shoulderR: 15, elbowR: 13,
    hipL: 16, kneeL: 14, hipR: 16, kneeR: 14,
  };
  const caps: JointCap[] = [];
  for (const bid of capBones) {
    const radius = capRadius[bid];
    const capC = drawJointCap(radius, pal);
    const key = `cap_${bid}`;
    layouts.push({ key, canvas: capC });
    caps.push({
      boneId: bid,
      radius,
      uv: [0, 0, 0, 0],
      z: 40, // 关节帽统一最上层,保证任何角度都盖住缝
    });
  }

  // 打包图集
  const atlas = buildAtlas(layouts.map((l) => ({ key: l.key, canvas: l.canvas })));
  const parts: PuppetPart[] = layouts
    .filter((l) => l.part)
    .map((l) => {
      const pl = atlas.placements[l.key];
      return { ...l.part, uv: pl.uv, size: [pl.pxW, pl.pxH] } as PuppetPart;
    });
  for (const cap of caps) {
    const pl = atlas.placements[`cap_${cap.boneId}`];
    cap.uv = pl.uv;
  }

  return {
    id: uid('puppet'),
    name: style.name,
    kind: 'procedural',
    bones,
    parts,
    caps,
    atlasSize: atlas.size,
    palette: pal,
    createdAt: Date.now(),
    atlasCanvas: atlas.canvas,
  };
}
