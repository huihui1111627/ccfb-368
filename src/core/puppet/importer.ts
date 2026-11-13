import type { Bone, JointCap, PuppetDef, PuppetPalette, PuppetPart, Vec2 } from '../../types';
import { rad, uid } from '../math/vec2';
import { buildAtlas } from './atlas';
import { drawJointCap } from './draw';

/**
 * 部件 PNG 导入 + 按关节自动对位。
 *
 * 文件名约定(下划线/横线/空格分段,大小写不敏感):
 *   <骨骼名>_<部件名>.png        如 shoulderL_上臂.png、elbowR.png
 *   骨骼名支持中英文:spine躯干 / head头 / shoulderL肩L / elbowL肘L /
 *   wristL腕L / shoulderR / elbowR / wristR / hipL / kneeL / ankleL / hipR / kneeR / ankleR
 * 可选:文件名含 cap 生成关节帽;含 z<数字> 指定层序,如 elbowL_z21.png
 */

const BONE_ALIAS: Record<string, string> = {
  spine: 'spine', 躯干: 'spine', body: 'spine',
  head: 'head', 头: 'head',
  neck: 'neck', 颈: 'neck',
  shoulderl: 'shoulderL', 左肩: 'shoulderL', 肩l: 'shoulderL',
  elbowl: 'elbowL', 左肘: 'elbowL', 肘l: 'elbowL',
  wristl: 'wristL', 左腕: 'wristL', 腕l: 'wristL',
  shoulderr: 'shoulderR', 右肩: 'shoulderR', 肩r: 'shoulderR',
  elbowr: 'elbowR', 右肘: 'elbowR', 肘r: 'elbowR',
  wristr: 'wristR', 右腕: 'wristR', 腕r: 'wristR',
  hipl: 'hipL', 左髋: 'hipL', 髋l: 'hipL',
  kneel: 'kneeL', 左膝: 'kneeL', 膝l: 'kneeL',
  anklel: 'ankleL', 左踝: 'ankleL', 踝l: 'ankleL',
  hipr: 'hipR', 右髋: 'hipR', 髋r: 'hipR',
  kneer: 'kneeR', 右膝: 'kneeR', 膝r: 'kneeR',
  ankler: 'ankleR', 右踝: 'ankleR', 踝r: 'ankleR',
};

/** 与程序化影人一致的标准骨架:绝对世界坐标 + 世界角度,自动换算局部 */
function standardBones(): Bone[] {
  // [id, parent, worldXY, length, worldDeg, limitDeg]
  const rows: [string, string | null, [number, number], number, number, [number, number]][] = [
    ['root', null, [0, 150], 0, 90, [-180, 180]],
    ['spine', 'root', [0, 10], 140, -90, [-25, 25]],
    ['neck', 'spine', [0, -58], 14, -90, [-35, 35]],
    ['head', 'neck', [0, -72], 46, -90, [-40, 40]],
    ['shoulderL', 'spine', [-12, 16], 10, -150, [-60, 60]],
    ['elbowL', 'shoulderL', [-48, 40], 48, -120, [-130, 10]],
    ['wristL', 'elbowL', [-70, 92], 56, -100, [-120, 20]],
    ['shoulderR', 'spine', [12, 16], 10, -30, [-60, 60]],
    ['elbowR', 'shoulderR', [48, 40], 48, -60, [-10, 130]],
    ['wristR', 'elbowR', [70, 92], 56, -80, [-20, 120]],
    ['hipL', 'root', [-12, 150], 12, 100, [-50, 50]],
    ['kneeL', 'hipL', [-22, 226], 78, 95, [-120, 10]],
    ['ankleL', 'kneeL', [-16, 300], 76, 88, [-30, 90]],
    ['hipR', 'root', [12, 150], 12, 80, [-50, 50]],
    ['kneeR', 'hipR', [22, 226], 78, 85, [-10, 120]],
    ['ankleR', 'kneeR', [16, 300], 76, 92, [-90, 30]],
  ];
  const world = new Map(rows.map((r) => [r[0], { xy: r[2], deg: r[4] }]));
  return rows.map(([id, parent, xy, length, deg, lim]) => {
    let restLocal: Vec2 = [...xy];
    let restRotation = rad(deg);
    if (parent) {
      const pw = world.get(parent)!;
      const dx = xy[0] - pw.xy[0];
      const dy = xy[1] - pw.xy[1];
      const pa = rad(-pw.deg);
      const c = Math.cos(pa), s = Math.sin(pa);
      restLocal = [dx * c - dy * s, dx * s + dy * c];
      restRotation = rad(deg - pw.deg);
    }
    return {
      id, name: id, parentId: parent, restLocal, restRotation,
      limits: [rad(lim[0]), rad(lim[1])], length,
    } satisfies Bone;
  });
}

export interface ImportedFile {
  fileName: string;
  canvas: HTMLCanvasElement;
}

export interface ImportResult {
  def: PuppetDef;
  warnings: string[];
}

function parseFileName(fileName: string): { boneId: string | null; z: number | null; isCap: boolean } {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  const segments = base.split(/[\s_\-.]+/).filter(Boolean);
  let boneId: string | null = null;
  let z: number | null = null;
  let isCap = false;
  for (const seg of segments) {
    if (seg === 'cap' || seg === '关节帽' || seg === '帽') isCap = true;
    const zMatch = /^z(-?\d+)$/.exec(seg);
    if (zMatch) z = Number(zMatch[1]);
    if (BONE_ALIAS[seg]) boneId = BONE_ALIAS[seg];
    // 组合名如 shoulderL上臂
    for (const alias of Object.keys(BONE_ALIAS)) {
      if (seg.includes(alias) && alias.length >= 4) {
        boneId = BONE_ALIAS[alias];
      }
    }
  }
  return { boneId, z, isCap };
}

/** 读像素 alpha,找到不透明区域的包围盒与"关节端"(靠近父关节一侧的中心) */
function alphaHull(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  let sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        sumX += x; sumY += y; count++;
      }
    }
  }
  if (count === 0) return null;
  return { minX, minY, maxX, maxY, cx: sumX / count, cy: sumY / count };
}

const DEFAULT_Z: Record<string, number> = {
  spine: 10, head: 30, neck: 29,
  shoulderL: 20, elbowL: 21, wristL: 22,
  shoulderR: 20, elbowR: 21, wristR: 22,
  hipL: 8, kneeL: 9, ankleL: 7,
  hipR: 8, kneeR: 9, ankleR: 7,
};

export async function importPartPngs(files: File[], name: string, palette: PuppetPalette): Promise<ImportResult> {
  const warnings: string[] = [];
  const loaded: ImportedFile[] = [];
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      loaded.push({ fileName: file.name, canvas });
    } catch {
      warnings.push(`无法读取 ${file.name}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const bones = standardBones();
  const restById = new Map<string, [number, number]>();
  {
    // 重新算静止世界坐标(与 standardBones 行内数据保持一致)
    const rows: [string, [number, number]][] = [
      ['root', [0, 150]], ['spine', [0, 10]], ['neck', [0, -58]], ['head', [0, -72]],
      ['shoulderL', [-8, 6]], ['elbowL', [-46, 34]], ['wristL', [-66, 86]],
      ['shoulderR', [8, 6]], ['elbowR', [46, 34]], ['wristR', [66, 86]],
      ['hipL', [-10, 150]], ['kneeL', [-20, 226]], ['ankleL', [-12, 300]],
      ['hipR', [10, 150]], ['kneeR', [20, 226]], ['ankleR', [12, 300]],
    ];
    rows.forEach(([id, p]) => restById.set(id, p));
  }

  const layouts: { key: string; canvas: HTMLCanvasElement; part?: Omit<PuppetPart, 'uv' | 'size'> }[] = [];
  const caps: JointCap[] = [];
  const usedBones = new Set<string>();

  for (const f of loaded) {
    const meta = parseFileName(f.fileName);
    if (!meta.boneId) {
      warnings.push(`文件名无法识别关节,已跳过:${f.fileName}`);
      continue;
    }
    usedBones.add(meta.boneId);
    const hull = alphaHull(f.canvas);
    if (!hull) {
      warnings.push(`图片完全透明,已跳过:${f.fileName}`);
      continue;
    }
    const isLimb = /shoulder|elbow|wrist|hip|knee|ankle/.test(meta.boneId);
    let anchorOffset: [number, number];
    if (isLimb) {
      // 部件画布内,锚点取包围盒"近端中心",让关节自动咬到骨节点上
      anchorOffset = [hull.minX - (hull.maxX - hull.minX) * 0.06, (hull.minY + hull.maxY) / 2];
    } else if (meta.boneId === 'head') {
      anchorOffset = [(hull.minX + hull.maxX) / 2, hull.maxY - 14];
    } else {
      anchorOffset = [(hull.minX + hull.maxX) / 2, (hull.minY + hull.maxY) / 2 + 10];
    }
    const z = meta.z ?? DEFAULT_Z[meta.boneId] ?? 10;
    if (meta.isCap) {
      const radius = Math.max(hull.maxX - hull.minX, hull.maxY - hull.minY) / 2;
      caps.push({ boneId: meta.boneId, radius, uv: [0, 0, 0, 0], z: 40 });
      layouts.push({ key: `cap_${meta.boneId}`, canvas: f.canvas });
    } else {
      layouts.push({
        key: `img_${meta.boneId}_${uid('k')}`,
        canvas: f.canvas,
        part: {
          id: uid('part'),
          name: f.fileName.replace(/\.[^.]+$/, ''),
          anchor: { boneId: meta.boneId, offset: anchorOffset, followRotation: true, rotationOffset: 0 },
          z,
          translucency: 0.26,
          opacity: 0.97,
        },
      });
    }
  }

  // 对没有提供 cap 的关键关节,自动生成程序化关节帽防露缝
  const autoCapBones = ['spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];
  const capRadii: Record<string, number> = {
    spine: 20, neck: 12, shoulderL: 15, elbowL: 13, shoulderR: 15, elbowR: 13,
    hipL: 16, kneeL: 14, hipR: 16, kneeR: 14,
  };
  for (const bid of autoCapBones) {
    if (!usedBones.has(bid) || caps.some((c) => c.boneId === bid)) continue;
    const capC = drawJointCap(capRadii[bid], palette);
    layouts.push({ key: `cap_${bid}`, canvas: capC });
    caps.push({ boneId: bid, radius: capRadii[bid], uv: [0, 0, 0, 0], z: 40 });
  }

  const atlas = buildAtlas(layouts.map((l) => ({ key: l.key, canvas: l.canvas })));
  const parts: PuppetPart[] = layouts
    .filter((l) => l.part)
    .map((l) => {
      const pl = atlas.placements[l.key];
      return { ...l.part!, uv: pl.uv, size: [pl.pxW, pl.pxH] } as PuppetPart;
    });
  for (const cap of caps) {
    cap.uv = atlas.placements[`cap_${cap.boneId}`].uv;
  }

  const def: PuppetDef = {
    id: uid('puppet'),
    name,
    kind: 'imported',
    bones,
    parts,
    caps,
    atlasSize: atlas.size,
    palette,
    createdAt: Date.now(),
    atlasCanvas: atlas.canvas,
  };
  return { def, warnings };
}
