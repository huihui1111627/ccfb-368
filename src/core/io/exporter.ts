import type { MotionFile, ProjectFile, ProjectState, PuppetDef } from '../../types';
import { canvasToDataUrl } from '../state/persistence';

/** 协商 MediaRecorder 支持的最佳格式,优先 MP4(H.264) */
export function pickMediaFormat(): { mimeType: string; ext: string; label: string } {
  const candidates: { mimeType: string; ext: string; label: string }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'MP4 (H.264)' },
    { mimeType: 'video/mp4', ext: 'mp4', label: 'MP4' },
    { mimeType: 'video/webm;codecs=h264', ext: 'webm', label: 'WebM (H.264)' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM (VP9)' },
    { mimeType: 'video/webm', ext: 'webm', label: 'WebM' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: '', ext: 'webm', label: '浏览器默认' };
}

export interface RecordHandle {
  stop: () => Promise<Blob>;
  format: { mimeType: string; ext: string; label: string };
}

/**
 * 录制画布:在调用方按时间线逐帧 render 的同时采集。
 * 用 requestAnimationFrame 驱动离线播放,录满 duration 自动停止。
 */
export function recordCanvas(
  canvas: HTMLCanvasElement,
  durationSec: number,
  onFrame: (t: number) => void,
  fps: number,
): RecordHandle & { done: Promise<Blob> } {
  const format = pickMediaFormat();
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, format.mimeType ? { mimeType: format.mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: format.mimeType || 'video/webm' }));
  });

  const t0 = performance.now();
  const tick = () => {
    const elapsed = (performance.now() - t0) / 1000;
    const t = Math.min(elapsed, durationSec);
    onFrame(t);
    if (elapsed < durationSec) requestAnimationFrame(tick);
    else recorder.stop();
  };
  recorder.start(100);
  requestAnimationFrame(tick);

  return {
    format,
    done,
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return done;
    },
  };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------------- 动作 JSON ---------------- */

export function exportMotionJson(state: ProjectState, instanceId: string): MotionFile {
  const inst = state.instances.find((i) => i.id === instanceId)!;
  const def = state.puppets.find((p) => p.id === inst.defId)!;
  const channels = state.timeline.channels.filter((c) => c.instanceId === instanceId);
  return {
    format: 'shadow-puppet-motion',
    version: 1,
    defName: def.name,
    duration: state.timeline.duration,
    fps: state.timeline.fps,
    channels: structuredClone(channels),
  };
}

export function isValidMotion(data: unknown): data is MotionFile {
  const m = data as MotionFile;
  return !!m && m.format === 'shadow-puppet-motion' && Array.isArray(m.channels);
}

/**
 * 导入动作:按 defName 匹配同类影人,套用到目标实例;
 * 通道里的 instanceId 重写为当前实例。
 */
export function importMotionToInstance(file: MotionFile, targetInstance: string): MotionFile {
  return {
    ...file,
    channels: file.channels.map((ch) => ({
      ...structuredClone(ch),
      id: `ch_${Math.random().toString(36).slice(2, 10)}`,
      instanceId: targetInstance,
      keyframes: ch.keyframes.map((k) => ({ ...k, id: `kf_${Math.random().toString(36).slice(2, 10)}` })),
    })),
  };
}

/* ---------------- 工程文件 ---------------- */

export function exportProjectFile(state: ProjectState): ProjectFile {
  const clean: ProjectState = structuredClone(state);
  for (const p of clean.puppets) delete p.atlasCanvas;
  return { format: 'shadow-puppet-project', version: 1, state: clean };
}

export function isValidProject(data: unknown): data is ProjectFile {
  const p = data as ProjectFile;
  return !!p && p.format === 'shadow-puppet-project' && !!p.state && Array.isArray(p.state.puppets);
}

/** 工程文件里不携带位图,导出时把图集 dataURL 一并打进一个包 */
export interface ProjectBundle {
  file: ProjectFile;
  atlases: Record<string, string>;
}

export function buildProjectBundle(state: ProjectState): ProjectBundle {
  const atlases: Record<string, string> = {};
  for (const p of state.puppets) if (p.atlasCanvas) atlases[p.id] = canvasToDataUrl(p.atlasCanvas);
  return { file: exportProjectFile(state), atlases };
}

export function downloadJson(obj: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  downloadBlob(blob, fileName);
}

export function readJsonFile(file: File): Promise<unknown> {
  return file.text().then((t) => JSON.parse(t));
}

export function readBundle(file: File): Promise<ProjectBundle> {
  return readJsonFile(file) as Promise<ProjectBundle>;
}

export function puppetDefSummary(def: PuppetDef): string {
  return `${def.name}: ${def.bones.length} 骨 / ${def.parts.length} 部件 / ${def.caps.length} 关节帽`;
}
