import type { PuppetDef, PuppetInstance, Vec2 } from '../types';
import type { EvaluatedScene } from '../core/animation/evaluate';
import { solveSkeleton } from '../core/math/skeleton';
import { rotate } from '../core/math/vec2';
import { Store } from '../core/state/store';
import { Renderer } from './Renderer';

export type DragMode = 'none' | 'ik' | 'rotateBone' | 'moveInstance' | 'pan';

interface DragState {
  mode: DragMode;
  instanceId: string;
  boneId?: string;
  chainId?: string;
  startPointer: Vec2;
  startRoot?: { x: number; y: number; rotation: number };
  startAngle?: number;
}

/**
 * 视口控制器:把指针事件翻译成 IK / 关节旋转 / 整体移动,
 * 所有修改走 Store 事务,天然支持撤销重做。
 */
export class ViewportController {
  private renderer: Renderer;
  private store: Store;
  private overlay: HTMLCanvasElement;
  private getScene: () => EvaluatedScene;
  private getDefs: () => Map<string, PuppetDef>;
  private drag: DragState | null = null;
  showSkeleton = true;
  showEffectors = true;
  /** 视图平移与缩放(舞台浏览用) */
  pan: Vec2 = [0, 0];
  zoom = 1;
  private onPickChange?: (info: string) => void;

  constructor(
    renderer: Renderer,
    store: Store,
    overlay: HTMLCanvasElement,
    getScene: () => EvaluatedScene,
    getDefs: () => Map<string, PuppetDef>,
  ) {
    this.renderer = renderer;
    this.store = store;
    this.overlay = overlay;
    this.getScene = getScene;
    this.getDefs = getDefs;
    this.bind();
  }

  setPickListener(fn: (info: string) => void) {
    this.onPickChange = fn;
  }

  private toCanvas(e: PointerEvent): Vec2 {
    const r = this.overlay.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** 屏幕坐标 -> 影人实例本地坐标(抵消视图平移/缩放与实例变换) */
  private toInstanceLocal(inst: PuppetInstance, p: Vec2): Vec2 {
    const cx = this.overlay.width / 2;
    const cy = this.overlay.height / 2;
    const worldX = (p[0] - cx - this.pan[0]) / this.zoom;
    const worldY = (p[1] - cy - this.pan[1]) / this.zoom;
    const rel: Vec2 = [(worldX - inst.x) / inst.scale, (worldY - inst.y) / inst.scale];
    return rotate(rel, -inst.rotation);
  }

  private bind() {
    const el = this.overlay;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => this.onUp());
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    this.zoom = Math.max(0.3, Math.min(3, this.zoom * factor));
  }

  private onDown(e: PointerEvent) {
    const p = this.toCanvas(e);
    const scene = this.getScene();
    const view = { pan: this.pan, zoom: this.zoom };
    const hit = this.renderer.pick(this.getDefs(), this.store.state.instances, scene, p, view);
    if (!hit) {
      // 空白处:框选平移视图
      this.drag = { mode: 'pan', instanceId: '', startPointer: p };
      return;
    }
    const inst = this.store.state.instances.find((i) => i.id === hit.instanceId)!;

    if (hit.kind === 'effector') {
      const chain = inst.ikChains.find((c) => c.endBoneId === hit.boneId)!;
      this.drag = { mode: 'ik', instanceId: inst.id, chainId: chain.id, startPointer: p };
      this.store.beginTransaction();
    } else if (hit.kind === 'joint' && e.button === 0 && !e.shiftKey) {
      this.drag = { mode: 'rotateBone', instanceId: inst.id, boneId: hit.boneId, startPointer: p };
      this.store.beginTransaction();
    } else {
      // 身体 / shift 点击:移动整个实例
      this.drag = {
        mode: 'moveInstance',
        instanceId: inst.id,
        startPointer: p,
        startRoot: { x: inst.x, y: inst.y, rotation: inst.rotation },
      };
      this.store.beginTransaction();
    }
    this.onPickChange?.(`${inst.name} · ${hit.kind === 'effector' ? '末端效应器' : hit.kind === 'joint' ? '关节' : '身体'}`);
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) {
      // 悬停提示
      const p = this.toCanvas(e);
      const hit = this.renderer.pick(this.getDefs(), this.store.state.instances, this.getScene(), p, { pan: this.pan, zoom: this.zoom });
      this.overlay.style.cursor = hit ? (hit.kind === 'effector' ? 'grab' : 'pointer') : 'default';
      return;
    }
    const p = this.toCanvas(e);
    const d = this.drag;
    const inst = this.store.state.instances.find((i) => i.id === d.instanceId);
    if (!inst) return;

    if (d.mode === 'pan') {
      this.pan = [this.pan[0] + (p[0] - d.startPointer[0]), this.pan[1] + (p[1] - d.startPointer[1])];
      d.startPointer = p;
      return;
    }

    if (d.mode === 'moveInstance' && d.startRoot) {
      const dx = p[0] - d.startPointer[0];
      const dy = p[1] - d.startPointer[1];
      this.store.silent((s) => {
        const target = s.instances.find((i) => i.id === inst.id)!;
        target.x = d.startRoot!.x + dx;
        target.y = d.startRoot!.y + dy;
      });
      return;
    }

    const local = this.toInstanceLocal(inst, p);

    if (d.mode === 'ik' && d.chainId) {
      // 实时 IK 目标:写入一个视图层 live map(由页面持有),这里通过回调暴露
      this.ikCallback?.(inst.id, d.chainId, local);
    } else if (d.mode === 'rotateBone' && d.boneId) {
      // 关节旋转:指针相对关节原点的角度 -> 相对静止增量
      const def = this.getDefs().get(inst.defId)!;
      const scene = this.getScene();
      const world = solveSkeleton(def, scene.poses.get(inst.id) ?? new Map());
      const origin = world.get(d.boneId)!.origin;
      const targetAngle = Math.atan2(local[1] - origin[1], local[0] - origin[0]);
      const bone = def.bones.find((b) => b.id === d.boneId)!;
      // 父骨当前世界旋转
      let parentWorld = 0;
      if (bone.parentId) parentWorld = world.get(bone.parentId)!.rotation;
      const delta = targetAngle - parentWorld - bone.restRotation;
      this.rotationCallback?.(inst.id, d.boneId, delta);
    }
  }

  private onUp() {
    if (this.drag && this.drag.mode !== 'pan') {
      this.store.endTransaction();
    }
    this.drag = null;
  }

  /** IK 目标更新回调(页面注入,通常写入 liveIk 并在松手时烘焙关键帧) */
  ikCallback?: (instanceId: string, chainId: string, target: Vec2) => void;
  rotationCallback?: (instanceId: string, boneId: string, delta: number) => void;

  /** 每帧画 2D 叠加层:骨骼、关节、末端效应器手柄 */
  drawOverlay(scene: EvaluatedScene) {
    const ctx = this.overlay.getContext('2d')!;
    const w = this.overlay.width, h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);
    if (!this.showSkeleton && !this.showEffectors) return;
    const cx = w / 2, cy = h / 2;

    for (const inst of this.store.state.instances) {
      if (!inst.visible) continue;
      const def = this.getDefs().get(inst.defId);
      if (!def) continue;
      const pose = scene.poses.get(inst.id) ?? new Map();
      const root = scene.roots.get(inst.id)!;
      const world = solveSkeleton(def, pose);

      const toScreen = (p: Vec2): Vec2 => {
        const rot = rotate([p[0] * root.scale, p[1] * root.scale], root.rotation);
        return [
          cx + this.pan[0] + (root.x + rot[0]) * this.zoom,
          cy + this.pan[1] + (root.y + rot[1]) * this.zoom,
        ];
      };

      if (this.showSkeleton) {
        ctx.strokeStyle = 'rgba(80,220,255,0.75)';
        ctx.lineWidth = 1.5;
        for (const bone of def.bones) {
          if (!bone.parentId) continue;
          const a = toScreen(world.get(bone.id)!.origin);
          const b = toScreen(world.get(bone.id)!.tip);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        for (const bone of def.bones) {
          const a = toScreen(world.get(bone.id)!.origin);
          ctx.fillStyle = 'rgba(255,210,90,0.9)';
          ctx.beginPath();
          ctx.arc(a[0], a[1], 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (this.showEffectors) {
        for (const chain of inst.ikChains) {
          const tip = toScreen(world.get(chain.endBoneId)!.origin);
          ctx.strokeStyle = '#ff5d73';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(tip[0], tip[1], 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(tip[0] - 11, tip[1]); ctx.lineTo(tip[0] + 11, tip[1]);
          ctx.moveTo(tip[0], tip[1] - 11); ctx.lineTo(tip[0], tip[1] + 11);
          ctx.stroke();
        }
      }
    }
  }
}
