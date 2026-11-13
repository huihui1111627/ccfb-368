import type { ProjectState, PuppetDef } from '../../types';
import { defaultProject } from './defaults';
import { canvasToDataUrl, dataUrlToCanvas, loadProject, saveProject } from './persistence';

type Listener = () => void;

const HISTORY_LIMIT = 80;

/** 可结构化克隆的工程快照(剥离 canvas) */
interface Snapshot {
  state: ProjectState;
}

function stripCanvases(state: ProjectState): ProjectState {
  return {
    ...state,
    puppets: state.puppets.map((p) => {
      const { atlasCanvas, ...rest } = p;
      void atlasCanvas;
      return rest;
    }),
  };
}

/**
 * 中央仓库:快照式撤销重做。
 * - mutate(fn):单次修改,立即入历史
 * - beginTransaction/updateTransaction/endTransaction:把一次拖拽的多次改动合并为一条历史
 */
export class Store {
  state: ProjectState;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private listeners = new Set<Listener>();
  private txDepth = 0;
  private txSnapshot: Snapshot | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSaveAt = 0;

  constructor(state?: ProjectState) {
    this.state = state ?? defaultProject();
  }

  /* ---------------- 订阅 ---------------- */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /* ---------------- 历史 ---------------- */
  private snapshot(): Snapshot {
    return { state: structuredClone(stripCanvases(this.state)) };
  }

  private pushHistory() {
    this.past.push(this.snapshot());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.snapshot());
    this.restoreSnapshot(prev);
    this.emit();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.restoreSnapshot(next);
    this.emit();
  }

  private restoreSnapshot(snap: Snapshot) {
    // 恢复时保留内存里已有的 atlasCanvas(位图不进快照)
    const canvasById = new Map(this.state.puppets.map((p) => [p.id, p.atlasCanvas]));
    this.state = structuredClone(snap.state);
    for (const p of this.state.puppets) {
      const c = canvasById.get(p.id);
      if (c) p.atlasCanvas = c;
    }
  }

  /* ---------------- 修改入口 ---------------- */
  mutate(fn: (s: ProjectState) => void) {
    if (this.txDepth > 0) {
      fn(this.state); // 事务内不单独入历史
    } else {
      this.pushHistory();
      fn(this.state);
      this.afterChange();
    }
  }

  beginTransaction() {
    if (this.txDepth === 0) this.txSnapshot = this.snapshot();
    this.txDepth++;
  }

  endTransaction() {
    this.txDepth = Math.max(0, this.txDepth - 1);
    if (this.txDepth === 0) {
      if (this.txSnapshot) {
        this.past.push(this.txSnapshot);
        if (this.past.length > HISTORY_LIMIT) this.past.shift();
        this.future = [];
        this.txSnapshot = null;
        this.afterChange();
      }
    }
  }

  /** 不进历史的静默更新(播放时间等临时状态由视图层自管,这里仅给纯数据场景用) */
  silent(fn: (s: ProjectState) => void) {
    fn(this.state);
    this.emit();
  }

  private afterChange() {
    this.state.savedAt = Date.now();
    this.emit();
    this.scheduleSave();
  }

  /* ---------------- 持久化 ---------------- */
  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), 900);
  }

  async flushSave() {
    const atlases: Record<string, string> = {};
    for (const p of this.state.puppets) {
      if (p.atlasCanvas) atlases[p.id] = canvasToDataUrl(p.atlasCanvas);
    }
    await saveProject({ state: stripCanvases(this.state), atlases });
    this.lastSaveAt = Date.now();
  }

  async hydrate(): Promise<boolean> {
    const data = await loadProject();
    if (!data) return false;
    this.state = data.state;
    await Promise.all(
      Object.entries(data.atlases).map(async ([pid, url]) => {
        const puppet = this.state.puppets.find((p) => p.id === pid);
        if (puppet) puppet.atlasCanvas = await dataUrlToCanvas(url);
      }),
    );
    this.past = [];
    this.future = [];
    this.emit();
    return true;
  }

  /** 全量替换(导入工程文件) */
  replaceState(state: ProjectState, canvases: Record<string, HTMLCanvasElement>) {
    this.pushHistory();
    this.state = structuredClone(stripCanvases(state));
    for (const [pid, c] of Object.entries(canvases)) {
      const p = this.state.puppets.find((x) => x.id === pid);
      if (p) p.atlasCanvas = c;
    }
    this.afterChange();
  }

  getPuppetDef(id: string): PuppetDef | undefined {
    return this.state.puppets.find((p) => p.id === id);
  }
}

export const store = new Store();
