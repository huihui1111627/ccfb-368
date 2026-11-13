import type { LightConfig, PuppetDef, PuppetInstance, Vec2 } from '../types';
import type { EvaluatedScene, RootTransform } from '../core/animation/evaluate';
import { anchorTransform, solveSkeleton, type Pose } from '../core/math/skeleton';
import { add, rotate } from '../core/math/vec2';
import { BLUR_FS, BLUR_VS, COMPOSITE_FS, COMPOSITE_VS, PUPPET_FS, PUPPET_VS, SHADOW_FS, SHADOW_VS } from './shaders';

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader 编译失败: ' + log);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program 链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

interface AtlasGPU {
  texture: WebGLTexture;
  defId: string;
}

/** 一个待绘制实例片元(部件或关节帽) */
interface DrawItem {
  uv: [number, number, number, number];
  size: [number, number];
  anchorX: number;
  anchorY: number;
  partRotation: number;
  translucency: number;
  opacity: number;
  isCap: number;
  z: number;
}

const FLOATS_PER_INSTANCE = 4 * 5; // model, anchor, shape, uv, material 共 5 个 vec4
const MAX_ITEMS = 40000;

export class Renderer {
  private gl: WebGL2RenderingContext;
  private puppetProg: WebGLProgram;
  private shadowProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private compositeProg: WebGLProgram;
  private quadVao: WebGLVertexArrayObject;
  private postVao: WebGLVertexArrayObject;
  private instanceVbo: WebGLBuffer;
  private instanceData = new Float32Array(MAX_ITEMS * FLOATS_PER_INSTANCE);
  private itemCount = 0;
  private atlases = new Map<string, AtlasGPU>();
  private sceneFbo!: { fbo: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer };
  private shadowFbo!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private blurFboA!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private blurFboB!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private width = 1;
  private height = 1;
  fps = 60;
  private frameTimes: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // 保证视频录制与像素回读可靠
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.puppetProg = program(gl, PUPPET_VS, PUPPET_FS);
    this.shadowProg = program(gl, SHADOW_VS, SHADOW_FS);
    this.blurProg = program(gl, BLUR_VS, BLUR_FS);
    this.compositeProg = program(gl, COMPOSITE_VS, COMPOSITE_FS);

    // 单位四角
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const quad = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const qbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, qbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 实例缓冲(每个 location 一个 vec4,divisor=1)
    this.instanceVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_INSTANCE * 4;
    for (let loc = 1; loc <= 5; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, (loc - 1) * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    // 后处理专用 VAO:标准裁剪空间全屏四边形(-1..1),无实例属性/divisor 污染
    this.postVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.postVao);
    const postQuad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const pbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
    gl.bufferData(gl.ARRAY_BUFFER, postQuad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.resize(canvas.width, canvas.height);
  }

  resize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const gl = this.gl;
    this.sceneFbo = this.makeFbo(this.width, this.height, true);
    const sw = Math.max(1, Math.floor(this.width / 2));
    const sh = Math.max(1, Math.floor(this.height / 2));
    this.shadowFbo = this.makeFbo(sw, sh, false);
    this.blurFboA = this.makeFbo(sw, sh, false);
    this.blurFboB = this.makeFbo(sw, sh, false);
  }

  private makeFbo(w: number, h: number, withDepth: boolean) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let depth: WebGLRenderbuffer | null = null;
    if (withDepth) {
      depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, depth: depth as WebGLRenderbuffer };
  }

  /** 上传/刷新一个影人的图集 */
  uploadAtlas(def: PuppetDef) {
    const gl = this.gl;
    let entry = this.atlases.get(def.id);
    if (!entry) {
      entry = { texture: gl.createTexture()!, defId: def.id };
      this.atlases.set(def.id, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, def.atlasCanvas!);
    // 用线性过滤、不开 mipmap:图集含大量透明留白,mipmap 会把小部件边缘与透明平均,
    // 导致 alpha test 误丢弃整个部件。
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  disposeAtlas(defId: string) {
    const entry = this.atlases.get(defId);
    if (entry) {
      this.gl.deleteTexture(entry.texture);
      this.atlases.delete(defId);
    }
  }

  /* ---------------- 实例数据装配 ---------------- */

  private pushItem(model: { x: number; y: number; rot: number; scale: number }, item: DrawItem) {
    if (this.itemCount >= MAX_ITEMS) return;
    const o = this.itemCount * FLOATS_PER_INSTANCE;
    const d = this.instanceData;
    d[o] = model.x; d[o + 1] = model.y; d[o + 2] = model.rot; d[o + 3] = model.scale;
    d[o + 4] = item.anchorX; d[o + 5] = item.anchorY; d[o + 6] = item.partRotation; d[o + 7] = item.z;
    d[o + 8] = item.size[0]; d[o + 9] = item.size[1]; d[o + 10] = 0; d[o + 11] = 0;
    d[o + 12] = item.uv[0]; d[o + 13] = item.uv[1]; d[o + 14] = item.uv[2]; d[o + 15] = item.uv[3];
    d[o + 16] = item.translucency; d[o + 17] = item.opacity; d[o + 18] = item.isCap; d[o + 19] = 0;
    this.itemCount++;
  }

  /** 收集一个实例的所有部件片元(CPU 骨骼计算,屏幕世界坐标全在 CPU 算好) */
  private collectInstance(def: PuppetDef, inst: PuppetInstance, pose: Pose, root: RootTransform, view: { pan: Vec2; zoom: number }) {
    const world = solveSkeleton(def, pose);
    // 实例变换在 CPU 完成,输出绝对屏幕像素坐标(含画布中心),VS 直接除半宽高。
    const scale = root.scale * view.zoom;
    const model = { x: 0, y: 0, rot: 0, scale: 1 };
    const cx = this.width / 2;
    const cy = this.height / 2;
    const toScreen = (p: Vec2): Vec2 => {
      const r = rotate([p[0] * scale, p[1] * scale], root.rotation);
      return [
        r[0] + root.x * view.zoom + view.pan[0] + cx,
        r[1] + root.y * view.zoom + view.pan[1] + cy,
      ];
    };
    const items: DrawItem[] = [];

    for (const part of def.parts) {
      const t = anchorTransform(def, world, part.anchor);
      const sp = toScreen(t.pos);
      items.push({
        uv: part.uv,
        size: [part.size[0] * scale, part.size[1] * scale],
        anchorX: sp[0],
        anchorY: sp[1],
        partRotation: t.rotation + root.rotation,
        translucency: part.translucency,
        opacity: part.opacity,
        isCap: 0,
        z: part.z,
      });
    }
    for (const cap of def.caps) {
      const bw = world.get(cap.boneId)!;
      const size = (cap.radius * 2 + 6) * scale;
      const sp = toScreen(bw.origin);
      items.push({
        uv: cap.uv,
        size: [size, size],
        anchorX: sp[0],
        anchorY: sp[1],
        partRotation: root.rotation,
        translucency: 0.18,
        opacity: 0.98,
        isCap: 1,
        z: cap.z,
      });
    }
    // 影人间分层:整体加一个大的层基数,保证后排实例不会插进前排
    const layerBase = inst.layer * 1000;
    items.sort((a, b) => a.z - b.z);
    for (const it of items) {
      it.z += layerBase;
      this.pushItem(model, it);
    }
  }

  private collectScene(
    defs: Map<string, PuppetDef>,
    instances: PuppetInstance[],
    scene: EvaluatedScene,
    view: { pan: Vec2; zoom: number },
  ) {
    this.itemCount = 0;
    this.groups = [];
    const visible = instances.filter((i) => i.visible).sort((a, b) => a.layer - b.layer);

    // 按 defId 聚合,保证同图集的实例在缓冲区内连续 -> 每类影人 1 次 draw call。
    // 影人间遮挡靠每个片元的 layerBase 深度值保证,与装配顺序无关。
    const byDef = new Map<string, PuppetInstance[]>();
    for (const inst of visible) {
      const def = defs.get(inst.defId);
      if (!def || !def.atlasCanvas) continue;
      if (!this.atlases.has(def.id)) this.uploadAtlas(def);
      if (!byDef.has(inst.defId)) byDef.set(inst.defId, []);
      byDef.get(inst.defId)!.push(inst);
    }

    for (const [defId, insts] of byDef) {
      const def = defs.get(defId)!;
      const first = this.itemCount;
      for (const inst of insts) {
        const pose = scene.poses.get(inst.id) ?? new Map();
        const root = scene.roots.get(inst.id) ?? { x: inst.x, y: inst.y, rotation: inst.rotation, scale: inst.scale };
        this.collectInstance(def, inst, pose, root, view);
      }
      this.groups.push({ defId, first, count: this.itemCount - first });
    }
  }

  /* ---------------- 绘制 ---------------- */

  private groups: { defId: string; count: number; first: number }[] = [];

  private drawBatches(prog: WebGLProgram) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, this.itemCount * FLOATS_PER_INSTANCE));

    // 按图集纹理分组:每种影人 1 次 draw call(实例在装配时已按实例连续排列)
    for (const group of this.groups) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlases.get(group.defId)!.texture);
      gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, group.count);
    }
  }

  render(
    defs: Map<string, PuppetDef>,
    instances: PuppetInstance[],
    scene: EvaluatedScene,
    light: LightConfig,
    stageColor: string,
    time: number,
    view: { pan: Vec2; zoom: number } = { pan: [0, 0], zoom: 1 },
  ) {
    const t0 = performance.now();
    const gl = this.gl;
    this.collectScene(defs, instances, scene, view);

    const halfLoc = gl.getUniformLocation(this.puppetProg, 'uHalfSize');
    const lightPos: Vec2 = [light.x * view.zoom + this.width / 2 + view.pan[0], this.height / 2 - light.y * view.zoom + view.pan[1]];

    /* ---- Pass 1:影人(带透光),写深度 ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.puppetProg);
    gl.uniform2f(halfLoc, this.width / 2, this.height / 2);
    gl.uniform2f(gl.getUniformLocation(this.puppetProg, 'uViewCenter'), this.width / 2, this.height / 2);
    gl.uniform3fv(gl.getUniformLocation(this.puppetProg, 'uLightColor'), light.color);
    gl.uniform1f(gl.getUniformLocation(this.puppetProg, 'uLightIntensity'), light.intensity);
    gl.uniform2f(gl.getUniformLocation(this.puppetProg, 'uLightPos'), lightPos[0], lightPos[1]);
    gl.uniform3f(gl.getUniformLocation(this.puppetProg, 'uAmbient'), 0.32, 0.26, 0.2);
    this.drawBatches(this.puppetProg);

    /* ---- Pass 2:剪影(半分辨率) ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo.fbo);
    const sw = this.shadowFbo.tex ? Math.floor(this.width / 2) : 1;
    const sh = Math.floor(this.height / 2);
    gl.viewport(0, 0, Math.max(1, sw), Math.max(1, sh));
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.shadowProg);
    gl.uniform2f(gl.getUniformLocation(this.shadowProg, 'uHalfSize'), this.width / 2, this.height / 2);
    gl.uniform2f(gl.getUniformLocation(this.shadowProg, 'uViewCenter'), this.width / 2, this.height / 2);
    gl.uniform1f(gl.getUniformLocation(this.shadowProg, 'uShadowStrength'), light.shadowOpacity);
    this.drawBatches(this.shadowProg);

    /* ---- Pass 3:两遍高斯模糊 ---- */
    this.gaussianBlur(this.shadowFbo, this.blurFboA, this.blurFboB, light.shadowBlur);

    /* ---- Pass 4:合成到默认帧缓冲 ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.tex);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blurFboB.tex);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uShadow'), 1);
    const stage = hexToRgb(stageColor);
    gl.uniform3fv(gl.getUniformLocation(this.compositeProg, 'uStageColor'), stage);
    gl.uniform3fv(gl.getUniformLocation(this.compositeProg, 'uLightColor'), light.color);
    gl.uniform2f(gl.getUniformLocation(this.compositeProg, 'uLightPos'), lightPos[0], lightPos[1]);
    gl.uniform2f(gl.getUniformLocation(this.compositeProg, 'uResolution'), this.width, this.height);
    gl.uniform1f(gl.getUniformLocation(this.compositeProg, 'uTime'), time);
    gl.uniform1f(gl.getUniformLocation(this.compositeProg, 'uSwayAmp'), light.swayAmp);
    gl.bindVertexArray(this.postVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const dt = performance.now() - t0;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = Math.round(1000 / Math.max(1, avg));
  }

  private gaussianBlur(src: { tex: WebGLTexture }, a: { fbo: WebGLFramebuffer; tex: WebGLTexture }, b: { fbo: WebGLFramebuffer; tex: WebGLTexture }, strength: number) {
    const gl = this.gl;
    const sw = Math.max(1, Math.floor(this.width / 2));
    const sh = Math.max(1, Math.floor(this.height / 2));
    gl.useProgram(this.blurProg);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, 'uTexel'), 1 / sw, 1 / sh);
    const passes = strength > 0.5 ? 2 : 1;

    let input = src.tex;
    for (let i = 0; i < passes; i++) {
      // 水平
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      gl.viewport(0, 0, sw, sh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.uniform1i(gl.getUniformLocation(this.blurProg, 'uTex'), 0);
      gl.uniform2f(gl.getUniformLocation(this.blurProg, 'uDirection'), 1, 0);
      gl.bindVertexArray(this.postVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // 垂直
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform2f(gl.getUniformLocation(this.blurProg, 'uDirection'), 0, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      input = b.tex;
    }
  }

  /** CPU 拾取:返回命中的实例 id 与骨骼/末端信息(供 IK 拖拽) */
  pick(
    defs: Map<string, PuppetDef>,
    instances: PuppetInstance[],
    scene: EvaluatedScene,
    canvasPoint: Vec2,
    view: { pan: Vec2; zoom: number } = { pan: [0, 0], zoom: 1 },
  ): { instanceId: string; boneId: string; kind: 'joint' | 'effector' | 'body'; point: Vec2 } | null {
    const cx = this.width / 2;
    const cy = this.height / 2;
    // 屏幕 -> 世界(抵消视图平移/缩放)
    const worldX = (canvasPoint[0] - cx - view.pan[0]) / view.zoom;
    const worldY = (canvasPoint[1] - cy - view.pan[1]) / view.zoom;
    const sorted = [...instances].filter((i) => i.visible).sort((a, b) => b.layer - a.layer);
    for (const inst of sorted) {
      const def = defs.get(inst.defId);
      if (!def) continue;
      const pose = scene.poses.get(inst.id) ?? new Map();
      const root = scene.roots.get(inst.id)!;
      const world = solveSkeleton(def, pose);
      // 世界 -> 实例本地
      const rel: Vec2 = [(worldX - root.x) / root.scale, (worldY - root.y) / root.scale];
      const unrot = rotate(rel, -root.rotation);

      // 1) 末端效应器优先(IK 链 endBone 的关节原点)
      for (const chain of inst.ikChains) {
        const tip = world.get(chain.endBoneId)!.origin;
        if (Math.hypot(tip[0] - unrot[0], tip[1] - unrot[1]) < 16 / view.zoom) {
          return { instanceId: inst.id, boneId: chain.endBoneId, kind: 'effector', point: unrot };
        }
      }
      // 2) 关节
      for (const bone of def.bones) {
        const bw = world.get(bone.id)!;
        if (Math.hypot(bw.origin[0] - unrot[0], bw.origin[1] - unrot[1]) < 11 / view.zoom) {
          return { instanceId: inst.id, boneId: bone.id, kind: 'joint', point: unrot };
        }
      }
      // 3) 身体包围盒
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const part of def.parts) {
        const t = anchorTransform(def, world, part.anchor);
        const hx = part.size[0] / 2, hy = part.size[1] / 2;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const corner = add(t.pos, rotate([sx * hx, sy * hy], t.rotation));
          minX = Math.min(minX, corner[0]); maxX = Math.max(maxX, corner[0]);
          minY = Math.min(minY, corner[1]); maxY = Math.max(maxY, corner[1]);
        }
      }
      if (unrot[0] >= minX && unrot[0] <= maxX && unrot[1] >= minY && unrot[1] <= maxY) {
        return { instanceId: inst.id, boneId: 'root', kind: 'body', point: unrot };
      }
    }
    return null;
  }

  get renderStats() {
    const avgMs = this.frameTimes.length
      ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
      : 0;
    return { fps: this.fps, drawItems: this.itemCount, drawCalls: this.groups.length * 3 + 2, cpuMs: avgMs };
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.96, 0.89, 0.72];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
