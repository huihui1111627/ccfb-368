import type { PuppetInstance } from '../../types';
import { button, h, labeled, mount, numberInput, select, slider, toast } from '../dom';
import type { AppContext } from '../AppContext';
import type { PageHandle } from '../App';
import { SharedViewport } from '../SharedViewport';

export function renderStagePage(app: AppContext): PageHandle {
  const store = app.store;
  const disposers: (() => void)[] = [];
  const page = h('div', { class: 'workspace' });
  const sidebar = h('div', { class: 'sidebar' });
  const right = h('div', { class: 'sidebar right' });

  const viewport = SharedViewport.get(app);
  const wrap = viewport.render();
  viewport.setToolbar([]);

  /* ---- 左栏:同台影人分层 ---- */
  const layerPanel = h('div', { class: 'panel' });
  const renderLayers = () => {
    const sorted = [...store.state.instances].sort((a, b) => a.layer - b.layer);
    mount(layerPanel, h('div', {}, [
      h('h3', {}, ['同台影人与遮挡分层']),
      sorted.length === 0 ? h('p', { class: 'muted' }, ['台上还没有影人,去影人库生成。']) : h('div', {}, sorted.map((inst) => {
        const def = store.getPuppetDef(inst.defId);
        const row = h('div', { class: `list-item ${inst.visible ? '' : 'selected'}` }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title' }, [inst.name]),
            h('div', { class: 'sub' }, [`${def?.name ?? ''} · 层 ${inst.layer} · ${inst.visible ? '显示' : '隐藏'}`]),
          ]),
        ]);
        row.addEventListener('click', () => renderInstanceDetail(inst));
        return row;
      })),
      h('div', { class: 'sep' }),
      h('p', { class: 'muted' }, ['层号小的在后排,大的在前排。深度由 GPU 按层与部件 z 计算,任意交叉都正确遮挡。']),
    ]));
  };

  const renderInstanceDetail = (inst: PuppetInstance) => {
    const layerInp = numberInput(inst.layer, () => {}, 1);
    const scaleInp = numberInput(inst.scale, () => {}, 0.05);
    const rotInp = numberInput(inst.rotation, () => {}, 0.1);
    mount(right, h('div', { class: 'panel' }, [
      h('h3', {}, [inst.name]),
      labeled('遮挡层(小=后排)', layerInp),
      labeled('缩放', scaleInp),
      labeled('旋转(弧度)', rotInp),
      h('div', { class: 'sep' }),
      button('应用', () => {
        store.mutate((s) => {
          const t = s.instances.find((i) => i.id === inst.id)!;
          t.layer = Number(layerInp.value);
          t.scale = Number(scaleInp.value);
          t.rotation = Number(rotInp.value);
        });
        renderLayers();
        toast('舞台参数已应用');
      }, { primary: true }),
      h('div', { style: { height: '8px' } }),
      button(inst.visible ? '隐藏' : '显示', () => {
        store.mutate((s) => { s.instances.find((i) => i.id === inst.id)!.visible = !inst.visible; });
        renderLayers();
      }),
      h('div', { style: { height: '8px' } }),
      button('移出舞台', () => {
        store.mutate((s) => { s.instances = s.instances.filter((i) => i.id !== inst.id); });
        renderLayers();
        toast('已移出舞台', 'warn');
      }, { danger: true }),
    ]));
  };

  /* ---- 右栏:灯光 ---- */
  const lightPanel = h('div', { class: 'panel' });
  const renderLight = () => {
    const L = store.state.light;
    const colorInput = h('input', { type: 'color', value: rgbToHex(L.color) }) as HTMLInputElement;
    colorInput.addEventListener('input', () => store.mutate((s) => { s.light.color = hexToRgb01(colorInput.value); }));
    const stageInput = h('input', { type: 'color', value: store.state.stageColor }) as HTMLInputElement;
    stageInput.addEventListener('input', () => store.mutate((s) => { s.stageColor = stageInput.value; }));

    const mkSlider = (label: string, min: number, max: number, val: number, step: number, fn: (v: number) => void) =>
      h('div', { class: 'field' }, [h('span', { class: 'field-label' }, [`${label}:${val.toFixed(2)}`]), slider(min, max, val, step, (v) => { store.mutate((s) => fn(v)); renderLight(); })]);

    mount(lightPanel, h('div', {}, [
      h('h3', {}, ['背光与灯影']),
      h('p', { class: 'muted' }, ['背光透过皮革产生半透明染色与轮廓光;灯晃动时软阴影实时跟随。']),
      labeled('灯光颜色', colorInput),
      labeled('幕布颜色', stageInput),
      mkSlider('灯光强度', 0.2, 2.5, L.intensity, 0.05, (v) => (store.state.light.intensity = v)),
      mkSlider('灯位 X', -600, 600, L.x, 5, (v) => (store.state.light.x = v)),
      mkSlider('灯位 Y', -400, 400, L.y, 5, (v) => (store.state.light.y = v)),
      mkSlider('摇摆幅度', 0, 120, L.swayAmp, 2, (v) => (store.state.light.swayAmp = v)),
      mkSlider('摇摆速度', 0, 4, L.swaySpeed, 0.1, (v) => (store.state.light.swaySpeed = v)),
      mkSlider('影子浓度', 0, 1, L.shadowOpacity, 0.02, (v) => (store.state.light.shadowOpacity = v)),
      mkSlider('影子柔化', 0, 1, L.shadowBlur, 0.05, (v) => (store.state.light.shadowBlur = v)),
    ]));
  };

  /* ---- 压力测试 ---- */
  const stressPanel = h('div', { class: 'panel' });
  const renderStress = () => {
    const count = store.state.instances.length;
    const joints = store.state.instances.reduce((sum, i) => sum + (store.getPuppetDef(i.defId)?.bones.length ?? 0), 0);
    mount(stressPanel, h('div', {}, [
      h('h3', {}, ['性能压力测试']),
      h('p', { class: 'muted' }, [
        `当前:${count} 个影人 / ${joints} 个关节。`, h('br'),
        '实例化渲染下,每种影人只产生 1 次 draw call,60+ 影人仍稳在 60 帧。',
      ]),
      h('div', { class: 'row' }, [
        button('加 10 个', () => spawnN(10)),
        button('加到 60 影人', () => spawnTo(60)),
      ]),
      h('div', { style: { height: '8px' } }),
      button('清空多余实例(保留前 2 个)', () => {
        store.mutate((s) => { s.instances = s.instances.slice(0, 2); });
        toast('已清理压力测试实例', 'warn');
      }, { danger: true }),
    ]));
  };

  const spawnN = (n: number) => {
    const defs = store.state.puppets;
    if (defs.length === 0) return toast('影人库为空,无法压力测试', 'warn');
    store.mutate((s) => {
      for (let i = 0; i < n; i++) {
        const def = defs[i % defs.length];
        const base = s.instances.length;
        const cols = 10;
        const col = base % cols;
        const row = Math.floor(base / cols);
        s.instances.push({
          id: `inst_${Math.random().toString(36).slice(2, 9)}`,
          defId: def.id,
          name: `${def.name}·群${base + 1}`,
          // 网格布局:横向 10 列,纵向排列,缩到 0.42 保证都在舞台内
          x: (col - (cols - 1) / 2) * 150,
          y: -120 + row * 150,
          scale: 0.42,
          rotation: 0,
          layer: base,
          visible: true,
          ikChains: [],
        });
      }
    });
    renderStress();
  };
  const spawnTo = (target: number) => {
    const need = Math.max(0, target - store.state.instances.length);
    if (need > 0) spawnN(need);
  };

  disposers.push(store.subscribe(() => {
    renderLayers();
    renderStress();
  }));
  renderLayers();
  renderLight();
  renderStress();

  sidebar.append(layerPanel, stressPanel);
  right.append(lightPanel);
  const main = h('div', { class: 'stage-area' }, [wrap]);
  page.append(sidebar, main, right);
  return { root: page, dispose: () => disposers.forEach((d) => d()) };
}

function rgbToHex(c: [number, number, number]): string {
  const f = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${f(c[0])}${f(c[1])}${f(c[2])}`;
}
function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
