import { cubicBezierEase } from '../core/math/vec2';
import { h } from './dom';

/**
 * 三次贝塞尔缓动曲线编辑器。
 * 编辑选中关键帧到下一帧的 ease 控制点 [x1,y1,x2,y2],两端固定 (0,0)/(1,1)。
 */
export class CurveEditor {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ease: [number, number, number, number] = [0.42, 0, 0.58, 1];
  private drag: 0 | 1 | null = null;
  private onChange: (ease: [number, number, number, number]) => void;
  private padding = 26;

  constructor(onChange: (ease: [number, number, number, number]) => void) {
    this.onChange = onChange;
    this.canvas = h('canvas', {}) as HTMLCanvasElement;
    this.el = h('div', { class: 'curve-editor' }, [this.canvas]);
    this.bind();
    this.draw();
  }

  setEase(ease: [number, number, number, number]) {
    this.ease = [...ease];
    this.draw();
  }

  setEnabled(enabled: boolean) {
    this.el.style.opacity = enabled ? '1' : '0.4';
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  private bind() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = this.toNorm(e);
      const p1: [number, number] = [this.ease[0], this.ease[1]];
      const p2: [number, number] = [this.ease[2], this.ease[3]];
      if (Math.hypot(p[0] - p1[0], p[1] - p1[1]) < 0.08) this.drag = 0;
      else if (Math.hypot(p[0] - p2[0], p[1] - p2[1]) < 0.08) this.drag = 1;
    });
    window.addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      const p = this.toNorm(e);
      const x = Math.max(0, Math.min(1, p[0]));
      const y = Math.max(-0.3, Math.min(1.3, p[1]));
      if (this.drag === 0) this.ease = [x, y, this.ease[2], this.ease[3]];
      else this.ease = [this.ease[0], this.ease[1], x, y];
      this.onChange(this.ease);
      this.draw();
    });
    window.addEventListener('pointerup', () => (this.drag = null));
  }

  private toNorm(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - this.padding) / (r.width - this.padding * 2);
    const y = 1 - (e.clientY - r.top - this.padding) / (r.height - this.padding * 2);
    return [x, y];
  }

  private toPx(nx: number, ny: number): [number, number] {
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    return [this.padding + nx * (w - this.padding * 2), this.padding + (1 - ny) * (hgt - this.padding * 2)];
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(hgt * dpr);
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    // 背景网格 + 对角线(线性参考)
    ctx.strokeStyle = 'rgba(216,169,78,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const [gx] = this.toPx(i / 4, 0);
      ctx.beginPath(); ctx.moveTo(gx, this.padding); ctx.lineTo(gx, hgt - this.padding); ctx.stroke();
      const [, gy] = this.toPx(0, i / 4);
      ctx.beginPath(); ctx.moveTo(this.padding, gy); ctx.lineTo(w - this.padding, gy); ctx.stroke();
    }
    const [ax, ay] = this.toPx(0, 0);
    const [bx, by] = this.toPx(1, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);

    // 贝塞尔曲线
    const [x1, y1] = this.toPx(this.ease[0], this.ease[1]);
    const [x2, y2] = this.toPx(this.ease[2], this.ease[3]);
    ctx.strokeStyle = '#d8a94e';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(x1, y1, x2, y2, bx, by);
    ctx.stroke();

    // 控制手柄线
    ctx.strokeStyle = 'rgba(80,220,255,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(x2, y2); ctx.stroke();

    // 端点与控制点
    const dot = (x: number, y: number, color: string, r: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1a120b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    dot(ax, ay, '#b39a72', 4);
    dot(bx, by, '#b39a72', 4);
    dot(x1, y1, '#50dcff', 6);
    dot(x2, y2, '#ff5d73', 6);

    // 标注
    ctx.fillStyle = '#b39a72';
    ctx.font = '10px sans-serif';
    ctx.fillText('线性', bx - 28, by - 6);
    ctx.fillText(`cubic-bezier(${this.ease.map((n) => n.toFixed(2)).join(', ')})`, this.padding, hgt - 6);
  }

  /** 工具:常用预设 */
  static presets(): { label: string; ease: [number, number, number, number] }[] {
    return [
      { label: '线性', ease: [0, 0, 1, 1] },
      { label: '缓入缓出', ease: [0.42, 0, 0.58, 1] },
      { label: '缓入', ease: [0.55, 0, 1, 0.45] },
      { label: '缓出', ease: [0, 0.55, 0.45, 1] },
      { label: '回弹预备', ease: [0.34, 1.56, 0.64, 1] },
    ];
  }
}

/** 供曲线数值校验/采样复用 */
export function sampleEase(ease: [number, number, number, number], x: number): number {
  return cubicBezierEase(ease[0], ease[1], ease[2], ease[3])(x);
}
