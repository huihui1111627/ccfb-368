import type { AnimChannel, PuppetInstance } from '../../types';
import { deg } from '../../core/math/vec2';
import { button, h, labeled, mount, numberInput, select, toast } from '../dom';
import type { AppContext } from '../AppContext';
import type { PageHandle } from '../App';
import { SharedViewport } from '../SharedViewport';
import { CurveEditor } from '../CurveEditor';
import { TimelineWidget } from '../TimelineWidget';

export function renderChoreoPage(app: AppContext): PageHandle {
  const store = app.store;
  const disposers: (() => void)[] = [];
  const page = h('div', { class: 'workspace', style: { flexDirection: 'column' } });
  const upper = h('div', { style: { flex: '1, display: flex, minHeight: 0' } });
  upper.style.display = 'flex';
  upper.style.flex = '1';
  upper.style.minHeight = '0';

  const sidebar = h('div', { class: 'sidebar' });
  const right = h('div', { class: 'sidebar right' });

  const instSel = select(
    store.state.instances.map((i) => ({ value: i.id, label: i.name })),
    store.state.instances[0]?.id ?? '',
    () => renderRight(),
  );
  const currentInst = (): PuppetInstance | undefined => store.state.instances.find((i) => i.id === instSel.value);

  const viewport = SharedViewport.get(app);
  const wrap = viewport.render();
  viewport.setToolbar([]);

  /* ---- 左栏 ---- */
  sidebar.append(
    h('div', { class: 'panel' }, [
      h('h3', {}, ['操作对象']),
      instSel,
      h('p', { class: 'muted' }, ['在舞台上直接拖红色手柄用 IK 摆姿势,拖黄色关节转骨头,拖身体移动站位。']),
    ]),
    h('div', { class: 'panel' }, [
      h('h3', {}, ['关键帧']),
      button('● 记录当前姿势为关键帧', () => {
        const inst = currentInst();
        if (!inst) return toast('台上没有影人', 'warn');
        store.beginTransaction();
        app.bakeKeyframe(inst);
        store.endTransaction();
        app.clearLive();
        toast(`已在 ${app.currentTime.toFixed(2)}s 记录关键帧`);
        timeline.setData(store.state.timeline, app.currentTime, channelLabel);
      }, { primary: true }),
      h('div', { style: { height: '8px' } }),
      button('清除本影人全部关键帧', () => {
        const inst = currentInst();
        if (!inst) return;
        store.mutate((s) => {
          s.timeline.channels = s.timeline.channels.filter((c) => c.instanceId !== inst.id);
        });
        app.clearLive();
        toast('已清除关键帧', 'warn');
      }, { danger: true }),
    ]),
    h('div', { class: 'panel' }, [
      h('h3', {}, ['时间线设置']),
      labeled('时长(秒)', (() => {
        const n = numberInput(store.state.timeline.duration, (v) => store.mutate((s) => { s.timeline.duration = Math.max(1, v); }), 0.5);
        return n;
      })()),
      labeled('帧率 FPS', (() => {
        const n = numberInput(store.state.timeline.fps, (v) => store.mutate((s) => { s.timeline.fps = Math.max(1, Math.min(120, v)); }), 1);
        return n;
      })()),
    ]),
  );

  /* ---- 右栏:曲线编辑器 ---- */
  const curveEditor = new CurveEditor((ease) => {
    const sel = timeline.findSelected();
    if (!sel) return;
    sel.keyframe.ease = ease;
  });

  const renderRight = () => {
    const sel = timeline.findSelected();
    mount(right, h('div', {}, [
      h('div', { class: 'panel' }, [
        h('h3', {}, ['缓入缓出曲线']),
        !sel ? h('p', { class: 'muted' }, ['在下方时间线点选一个关键帧(菱形),编辑它到下一帧的贝塞尔缓动。']) : h('div', {}, [
          h('p', { class: 'muted' }, [`通道:${channelLabel(sel.channel)}　时间:${sel.keyframe.t.toFixed(2)}s`]),
          curveEditor.el,
          h('div', { class: 'sep' }),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
            CurveEditor.presets().map((p) => button(p.label, () => {
              sel.keyframe.ease = [...p.ease];
              curveEditor.setEase(sel.keyframe.ease);
            }, { })),
          ),
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('h3', {}, ['通道列表']),
        h('div', { style: { maxHeight: '240px', overflow: 'auto' } },
          store.state.timeline.channels
            .filter((c) => c.instanceId === instSel.value)
            .map((c) => h('div', { class: 'list-item' }, [
              h('div', { class: 'grow' }, [
                h('div', { class: 'title' }, [c.type === 'ikTarget' ? 'IK 目标' : c.targetId === 'root' ? '站位/根' : `骨旋转·${c.targetId}`]),
                h('div', { class: 'sub' }, [`${c.keyframes.length} 个关键帧`]),
              ]),
              button('删', () => {
                store.mutate((s) => { s.timeline.channels = s.timeline.channels.filter((x) => x.id !== c.id); });
                toast('通道已删除', 'warn');
              }, { danger: true }),
            ])),
        ),
      ]),
    ]));
    curveEditor.setEnabled(!!sel);
    if (sel) curveEditor.setEase(sel.keyframe.ease);
  };

  const channelLabel = (ch: AnimChannel): string => {
    const inst = store.state.instances.find((i) => i.id === ch.instanceId);
    const who = inst?.name ?? ch.instanceId.slice(0, 6);
    if (ch.type === 'ikTarget') return `${who} · IK·${ch.targetId.slice(0, 8)}`;
    if (ch.targetId === 'root') return `${who} · 站位`;
    const def = store.getPuppetDef(inst?.defId ?? '');
    const bone = def?.bones.find((b) => b.id === ch.targetId);
    return `${who} · ${bone?.name ?? ch.targetId}`;
  };

  /* ---- 时间线 dock ---- */
  const timeline = new TimelineWidget({
    onChange: () => timeline.setData(store.state.timeline, app.currentTime, channelLabel),
    onSelect: () => renderRight(),
    onScrub: (t) => {
      app.setTime(t);
      timeline.setTime(t);
    },
  });

  const playBtn = button('▶ 播放', () => {
    if (app.playing) {
      app.pause();
      playBtn.textContent = '▶ 播放';
    } else {
      app.play();
      playBtn.textContent = '⏸ 暂停';
    }
  }, { primary: true });
  const stopBtn = button('⏹ 回到开头', () => {
    app.pause();
    app.setTime(0);
    playBtn.textContent = '▶ 播放';
  });

  const transport = h('div', { class: 'transport' }, [
    playBtn, stopBtn,
    timeline.getTimeLabel(),
    h('span', { class: 'muted' }, [`总时长 ${store.state.timeline.duration}s · ${store.state.timeline.fps}fps`]),
  ]);

  const dock = h('div', { class: 'timeline-dock' }, [transport, timeline.el]);

  disposers.push(app.onTime((t) => {
    timeline.setTime(t);
  }));
  disposers.push(store.subscribe(() => {
    timeline.setData(store.state.timeline, app.currentTime, channelLabel);
  }));
  timeline.setData(store.state.timeline, app.currentTime, channelLabel);
  renderRight();

  // 角度提示:选中骨时在右栏显示当前值
  void deg;

  const main = h('div', { class: 'stage-area' }, [wrap]);
  upper.append(sidebar, main, right);
  page.append(upper, dock);
  return { root: page, dispose: () => disposers.forEach((d) => d()) };
}
