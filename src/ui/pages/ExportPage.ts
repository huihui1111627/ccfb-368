import type { ProjectBundle } from '../../core/io/exporter';
import {
  buildProjectBundle,
  downloadBlob,
  downloadJson,
  exportMotionJson,
  importMotionToInstance,
  isValidMotion,
  isValidProject,
  pickMediaFormat,
  readBundle,
  readJsonFile,
  recordCanvas,
} from '../../core/io/exporter';
import { dataUrlToCanvas } from '../../core/state/persistence';
import { button, h, labeled, mount, select, toast } from '../dom';
import type { AppContext } from '../AppContext';
import type { PageHandle } from '../App';
import { SharedViewport } from '../SharedViewport';

export function renderExportPage(app: AppContext): PageHandle {
  const store = app.store;
  const disposers: (() => void)[] = [];
  const page = h('div', { class: 'workspace' });
  const sidebar = h('div', { class: 'sidebar' });
  const right = h('div', { class: 'sidebar right' });
  const viewport = SharedViewport.get(app);
  viewport.setToolbar([]);
  const glCanvas = app.canvas;

  const fmt = pickMediaFormat();

  /* ---- 视频导出 ---- */
  const videoPanel = h('div', { class: 'panel' });
  const renderVideo = () => {
    const recording = videoPanel.dataset.busy === '1';
    mount(videoPanel, h('div', {}, [
      h('h3', {}, ['导出视频']),
      h('p', { class: 'muted' }, [
        `本机编码器:${fmt.label}`, h('br'),
        fmt.ext === 'mp4'
          ? '浏览器支持 MP4(H.264),直接导出 .mp4。'
          : '当前浏览器不支持 MP4 封装,将导出 .webm;用 Chrome/Edge 最新版可获得 MP4。',
        h('br'),
        '录制时按时间线逐帧实时渲染整出戏,包含灯光摇摆与软阴影。',
      ]),
      button(recording ? '录制中…' : `开始录制并导出 ${fmt.ext.toUpperCase()}`, () => {
        if (recording) return;
        void startRecording();
      }, { primary: true }),
      h('div', { id: 'rec-progress', class: 'muted', style: { marginTop: '8px' } }),
    ]));
  };

  const startRecording = async () => {
    const dur = store.state.timeline.duration;
    const fps = store.state.timeline.fps;
    videoPanel.dataset.busy = '1';
    renderVideo();
    const progress = videoPanel.querySelector('#rec-progress')!;
    const handle = recordCanvas(
      glCanvas,
      dur,
      (t) => {
        app.setTime(t);
        progress.textContent = `录制中 ${t.toFixed(1)} / ${dur}s`;
      },
      fps,
    );
    const blob = await handle.done;
    const name = `${store.state.name || '皮影戏'}.${fmt.ext}`;
    downloadBlob(blob, name);
    videoPanel.dataset.busy = '0';
    renderVideo();
    toast(`视频已导出:${name}(${fmt.label})`);
  };

  /* ---- 动作 JSON ---- */
  const motionPanel = h('div', { class: 'panel' });
  const renderMotion = () => {
    const instOpts = store.state.instances.map((i) => ({ value: i.id, label: i.name }));
    const instSel = select(instOpts, instOpts[0]?.value ?? '', () => {});
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json' }) as HTMLInputElement;
    mount(motionPanel, h('div', {}, [
      h('h3', {}, ['动作 JSON(可再导入)']),
      h('p', { class: 'muted' }, ['把单个影人的动作(骨旋转 + IK 目标关键帧)存成 JSON,换一个同类影人即可复用。']),
      labeled('选择影人', instSel),
      button('导出该影人动作 JSON', () => {
        if (!instSel.value) return toast('台上没有影人', 'warn');
        const motion = exportMotionJson(store.state, instSel.value);
        downloadJson(motion, `motion-${motion.defName}-${Date.now()}.json`);
        toast('动作 JSON 已导出');
      }, { primary: true }),
      h('div', { class: 'sep' }),
      labeled('导入动作 JSON 文件', fileInput),
      button('导入并套用到选中影人', async () => {
        if (!fileInput.files?.[0]) return toast('请选择动作 JSON', 'warn');
        try {
          const data = await readJsonFile(fileInput.files[0]);
          if (!isValidMotion(data)) return toast('文件不是合法的动作 JSON', 'error');
          if (!instSel.value) return toast('台上没有可套用的影人', 'warn');
          const imported = importMotionToInstance(data, instSel.value);
          store.mutate((s) => {
            s.timeline.channels = s.timeline.channels.filter((c) => c.instanceId !== instSel.value);
            s.timeline.channels.push(...imported.channels);
            s.timeline.duration = Math.max(s.timeline.duration, imported.duration);
          });
          toast(`已导入 ${imported.channels.length} 条动作通道`);
        } catch (e) {
          toast('动作 JSON 解析失败:' + String(e), 'error');
        }
      }),
    ]));
  };

  /* ---- 工程文件 ---- */
  const projectPanel = h('div', { class: 'panel' });
  const renderProject = () => {
    const bundleInput = h('input', { type: 'file', accept: 'application/json,.json' }) as HTMLInputElement;
    mount(projectPanel, h('div', {}, [
      h('h3', {}, ['工程文件']),
      h('p', { class: 'muted' }, [
        '工程含影人骨架、部件、时间线、灯光与全部实例,图集位图以 dataURL 打包;', h('br'),
        '日常编辑也会自动存到浏览器 IndexedDB,刷新不丢,可撤销重做。',
      ]),
      button('导出整个工程(.json)', () => {
        const bundle = buildProjectBundle(store.state);
        downloadJson(bundle, `project-${store.state.name || 'shadow'}-${Date.now()}.json`);
        toast('工程已导出');
      }, { primary: true }),
      h('div', { class: 'sep' }),
      labeled('导入工程文件', bundleInput),
      button('导入并替换当前工程', async () => {
        if (!bundleInput.files?.[0]) return toast('请选择工程 JSON', 'warn');
        try {
          const bundle = (await readBundle(bundleInput.files[0])) as ProjectBundle;
          if (!isValidProject(bundle.file)) return toast('不是合法的皮影工程文件', 'error');
          const canvases: Record<string, HTMLCanvasElement> = {};
          for (const [pid, url] of Object.entries(bundle.atlases)) canvases[pid] = await dataUrlToCanvas(url);
          store.replaceState(bundle.file.state, canvases);
          toast('工程导入成功');
          renderMotion();
        } catch (e) {
          toast('工程导入失败:' + String(e), 'error');
        }
      }, { danger: true }),
      h('div', { class: 'sep' }),
      button('立即手动存盘到浏览器', async () => {
        await store.flushSave();
        toast('已存入浏览器 IndexedDB');
      }),
    ]));
  };

  /* ---- 右栏:导出清单 ---- */
  const summaryPanel = h('div', { class: 'panel' });
  const renderSummary = () => {
    const s = store.state;
    const kfCount = s.timeline.channels.reduce((n, c) => n + c.keyframes.length, 0);
    mount(summaryPanel, h('div', {}, [
      h('h3', {}, ['工程摘要']),
      h('p', { class: 'muted' }, [
        `工程名:${s.name}`, h('br'),
        `影人种类:${s.puppets.length}`, h('br'),
        `台上实例:${s.instances.length}`, h('br'),
        `动画通道:${s.timeline.channels.length}`, h('br'),
        `关键帧总数:${kfCount}`, h('br'),
        `时间线:${s.timeline.duration}s @ ${s.timeline.fps}fps`,
      ]),
    ]));
  };

  disposers.push(store.subscribe(() => {
    renderMotion();
    renderSummary();
  }));
  renderVideo();
  renderMotion();
  renderProject();
  renderSummary();

  sidebar.append(videoPanel, motionPanel, projectPanel);
  right.append(summaryPanel);
  const main = h('div', { class: 'stage-area' }, [viewport.render()]);
  page.append(sidebar, main, right);
  return { root: page, dispose: () => disposers.forEach((d) => d()) };
}
