import type { PuppetPalette } from '../../types';

/**
 * 程序化皮影绘制工具:在离屏 canvas 上画皮革质感部件。
 * 风格约定:暖色调皮革 + 镂刻花纹(深色勾线 + 透光点缀)。
 */

function withRound(ctx: CanvasRenderingContext2D, fn: () => void) {
  ctx.save();
  ctx.beginPath();
  fn();
  ctx.closePath();
  ctx.clip();
}

/** 皮革底纹:噪点 + 暖色渐变 */
export function leatherFill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pal: PuppetPalette,
  vertical = true,
) {
  const g = vertical
    ? ctx.createLinearGradient(0, 0, 0, h)
    : ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, pal.leather);
  g.addColorStop(0.55, pal.leather);
  g.addColorStop(1, pal.leatherDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 皮革颗粒(确定性伪随机,保证每次生成一致)
  let seed = (w * 73856093) ^ (h * 19349663);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.globalAlpha = 0.10;
  for (let i = 0; i < (w * h) / 260; i++) {
    ctx.fillStyle = rnd() > 0.5 ? pal.leatherDark : '#ffe9c4';
    const x = rnd() * w, y = rnd() * h;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;
}

/** 镂刻卷草纹:深色螺旋线 */
export function carvedScroll(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  pal: PuppetPalette,
  turns = 1.6,
) {
  ctx.save();
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.85);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** 镂空小圆点(透光点缀) */
export function carvedDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pal: PuppetPalette) {
  ctx.save();
  ctx.fillStyle = pal.accent;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
}

/** 皮质包边 */
export function leatherEdge(ctx: CanvasRenderingContext2D, pal: PuppetPalette, w = 2) {
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,230,180,0.35)';
  ctx.lineWidth = Math.max(0.6, w * 0.4);
  ctx.stroke();
}

/**
 * 画一个水平放置的肢体部件(沿 +x 方向),关节原点在 (pad, h/2)。
 * 两端各向外延伸 overlap 像素,保证关节旋转不露缝。
 */
export function drawLimb(
  w: number,
  h: number,
  pad: number,
  pal: PuppetPalette,
  opts: { rings?: number; taper?: number; dots?: boolean } = {},
): HTMLCanvasElement {
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  const half = h / 2;
  const taper = opts.taper ?? 0.28;

  const path = () => {
    ctx.moveTo(-2, half);
    ctx.quadraticCurveTo(pad * 0.6, 2, pad, half * (1 - taper) - 2);
    ctx.lineTo(w - pad, half * (1 - taper * 0.6) - 1);
    ctx.quadraticCurveTo(w + 2, half, w - pad, half * (1 + taper * 0.6) + 1);
    ctx.lineTo(pad, half * (1 + taper) + 2);
    ctx.quadraticCurveTo(pad * 0.6, h - 2, -2, half);
  };

  withRound(ctx, path);
  leatherFill(ctx, w, h, pal, false);

  // 中线卷草
  carvedScroll(ctx, w * 0.5, half, half * 0.55, pal, 1.4);
  // 关节束环(靠近两端)
  const ringCount = opts.rings ?? 2;
  for (let i = 1; i <= ringCount; i++) {
    const x0 = pad + (i * (w - pad * 2)) / (ringCount + 1);
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, half * 0.25);
    ctx.lineTo(x0, half * 1.75);
    ctx.stroke();
  }
  if (opts.dots !== false) {
    carvedDot(ctx, w * 0.3, half * 0.55, 2.2, pal);
    carvedDot(ctx, w * 0.72, half * 1.4, 2.2, pal);
  }
  ctx.beginPath();
  path();
  leatherEdge(ctx, pal, 2);
  return cvs;
}

/** 关节帽:圆形皮革片,覆盖旋转接缝 */
export function drawJointCap(radius: number, pal: PuppetPalette): HTMLCanvasElement {
  const size = radius * 2 + 6;
  const cvs = document.createElement('canvas');
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d')!;
  const c = size / 2;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(c - radius * 0.3, c - radius * 0.3, radius * 0.2, c, c, radius);
  g.addColorStop(0, pal.leather);
  g.addColorStop(1, pal.leatherDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  carvedScroll(ctx, c, c, radius * 0.55, pal, 1.2);
  carvedDot(ctx, c, c, radius * 0.16, pal);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(c, c, radius - 1, 0, Math.PI * 2);
  leatherEdge(ctx, pal, 1.6);
  return cvs;
}
