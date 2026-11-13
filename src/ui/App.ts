import { Store } from '../core/state/store';
import { AppContext } from './AppContext';
import { button, h, mount, toast } from './dom';
import { renderChoreoPage } from './pages/ChoreoPage';
import { renderExportPage } from './pages/ExportPage';
import { renderLibraryPage } from './pages/LibraryPage';
import { renderRigPage } from './pages/RigPage';
import { renderStagePage } from './pages/StagePage';

type PageId = 'library' | 'rig' | 'choreo' | 'stage' | 'export';

export interface PageHandle {
  root: HTMLElement;
  dispose?: () => void;
}

const PAGES: { id: PageId; label: string; icon: string }[] = [
  { id: 'library', label: '影人库', icon: '🎭' },
  { id: 'rig', label: '骨骼绑定', icon: '🦴' },
  { id: 'choreo', label: '动作编排', icon: '🎞️' },
  { id: 'stage', label: '舞台预览', icon: '🏮' },
  { id: 'export', label: '导出', icon: '📦' },
];

export class App {
  private app: AppContext;
  private pageHost: HTMLElement;
  private current: PageId = 'library';
  private navButtons = new Map<PageId, HTMLButtonElement>();
  private currentDispose: (() => void) | null = null;

  constructor(store: Store) {
    const root = document.getElementById('app')!;
    const glCanvas = h('canvas', { id: 'gl-canvas' }) as HTMLCanvasElement;
    const overlay = h('canvas', { id: 'overlay-canvas' }) as HTMLCanvasElement;
    this.app = new AppContext(store, glCanvas, overlay);

    const nameInput = h('input', { class: 'project-name', type: 'text', value: store.state.name }) as HTMLInputElement;
    nameInput.addEventListener('change', () => store.mutate((s) => { s.name = nameInput.value; }));
    store.subscribe(() => { if (nameInput.value !== store.state.name) nameInput.value = store.state.name; });

    const nav = h('nav', { class: 'nav' }, PAGES.map((p) => {
      const b = h('button', { onclick: () => this.go(p.id) }, [`${p.icon} ${p.label}`]);
      this.navButtons.set(p.id, b);
      return b;
    }));

    const undoBtn = button('↶ 撤销', () => store.undo());
    const redoBtn = button('↷ 重做', () => store.redo());
    store.subscribe(() => {
      undoBtn.disabled = !store.canUndo;
      redoBtn.disabled = !store.canRedo;
    });

    const topbar = h('div', { class: 'topbar' }, [
      h('div', { class: 'brand' }, [h('span', { class: 'lantern' }, ['🏮']), '皮影坊 · Shadow Puppet Studio']),
      nav,
      h('div', { class: 'spacer' }),
      nameInput,
      undoBtn,
      redoBtn,
    ]);

    this.pageHost = h('div', { style: { flex: '1', display: 'flex', minHeight: '0' } });
    root.append(topbar, this.pageHost, h('div', { id: 'toast-root' }));

    // 快捷键
    window.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo(); else store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (this.app.playing) this.app.pause(); else this.app.play();
      }
    });

    this.go('library');
  }

  go(id: PageId) {
    this.current = id;
    for (const [pid, btn] of this.navButtons) btn.classList.toggle('active', pid === id);
    const renderers: Record<PageId, () => PageHandle> = {
      library: () => renderLibraryPage(this.app),
      rig: () => renderRigPage(this.app),
      choreo: () => renderChoreoPage(this.app),
      stage: () => renderStagePage(this.app),
      export: () => renderExportPage(this.app),
    };
    try {
      this.currentDispose?.();
      const handle = renderers[id]();
      this.currentDispose = handle.dispose ?? null;
      mount(this.pageHost, handle.root);
    } catch (e) {
      console.error(e);
      toast('页面渲染失败:' + String(e), 'error');
    }
  }
}
