import type { PuppetDef } from '../../types';
import { importPartPngs } from '../../core/puppet/importer';
import { createProceduralPuppet, PUPPET_STYLES } from '../../core/puppet/procedural';
import { restWorld } from '../../core/math/skeleton';
import { Store } from '../../core/state/store';
import { button, h, mount, select, toast } from '../dom';
import type { AppContext } from '../AppContext';
import type { PageHandle } from '../App';

/** 把影人影人渲染成缩略图(用 2D canvas 静态画一帧静止姿态) */
function renderThumbnail(def: PuppetDef): string {
  const size = 160;
  const cvs = document.createElement('canvas');
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#f4e2b8';
  ctx.fillRect(0, 0, size, size);
  const world = restWorld(def);
  const scale = 0.32;
  const cx = size / 2, cy = size / 2 - 6;

  // 按 anchor 世界变换贴图,部件与关节帽统一按 z 排序
  type Placed = { uv: [number, number, number, number]; size: [number, number]; t: { x: number; y: number; rot: number; z: number }; z: number };
  const all: Placed[] = [
    ...def.parts.map((p): Placed => {
      const bw = world.get(p.anchor.boneId)!;
      const cos = Math.cos(bw.rotation), sin = Math.sin(bw.rotation);
      const ox = p.anchor.offset[0] * cos - p.anchor.offset[1] * sin;
      const oy = p.anchor.offset[0] * sin + p.anchor.offset[1] * cos;
      return {
        uv: p.uv,
        size: p.size,
        t: { x: bw.origin[0] + ox, y: bw.origin[1] + oy, rot: p.anchor.followRotation ? bw.rotation + p.anchor.rotationOffset : p.anchor.rotationOffset, z: p.z },
        z: p.z,
      };
    }),
    ...def.caps.map((c): Placed => {
      const o = world.get(c.boneId)!.origin;
      return { uv: c.uv, size: [c.radius * 2 + 6, c.radius * 2 + 6], t: { x: o[0], y: o[1], rot: 0, z: c.z }, z: c.z };
    }),
  ].sort((a, b) => a.z - b.z);

  for (const item of all) {
    if (!def.atlasCanvas) continue;
    const sx = item.uv[0] * def.atlasSize;
    const sy = item.uv[1] * def.atlasSize;
    const sw = (item.uv[2] - item.uv[0]) * def.atlasSize;
    const sh = (item.uv[3] - item.uv[1]) * def.atlasSize;
    ctx.save();
    ctx.translate(cx + item.t.x * scale, cy + item.t.y * scale);
    ctx.rotate(item.t.rot);
    const dw = item.size[0] * scale, dh = item.size[1] * scale;
    ctx.drawImage(def.atlasCanvas, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  return cvs.toDataURL();
}

export function renderLibraryPage(app: AppContext): PageHandle {
  const store: Store = app.store;
  const disposers: (() => void)[] = [];
  const page = h('div', { class: 'workspace' });

  const sidebar = h('div', { class: 'sidebar' });
  const detail = h('div', { class: 'sidebar right' });
  const main = h('div', { class: 'stage-area' }, [
    h('div', { style: { flex: '1', overflow: 'auto', padding: '22px' } }, [
      h('div', { id: 'library-grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' } }),
    ]),
  ]);

  /* ---- 左栏:生成与导入 ---- */
  const styleSel = select(PUPPET_STYLES.map((s, i) => ({ value: String(i), label: s.name })), '0', () => {});
  const genBtn = button('生成程序化影人', () => {
    const style = PUPPET_STYLES[Number(styleSel.value)];
    store.mutate((s) => {
      const def = createProceduralPuppet(style);
      s.puppets.push(def);
      // 自动放一个到台上
      s.instances.push({
        id: `inst_${Math.random().toString(36).slice(2, 9)}`,
        defId: def.id,
        name: `${def.name}·${s.instances.length + 1}`,
        x: (s.instances.length % 5 - 2) * 120,
        y: 40,
        scale: 1,
        rotation: 0,
        layer: s.instances.length,
        visible: true,
        ikChains: defaultIkChains(),
      });
    });
    toast(`已生成 ${style.name} 并摆上舞台`);
  }, { primary: true });

  const fileInput = h('input', { type: 'file', accept: 'image/png', multiple: true }) as HTMLInputElement;
  const nameInput = h('input', { type: 'text', placeholder: '导入影人的名字,如:花旦', value: '导入影人' }) as HTMLInputElement;
  const importBtn = button('导入 PNG 部件并自动对位', async () => {
    if (!fileInput.files || fileInput.files.length === 0) {
      toast('请先选择 PNG 文件', 'warn');
      return;
    }
    const result = await importPartPngs(Array.from(fileInput.files), nameInput.value || '导入影人', PUPPET_STYLES[0].palette);
    store.mutate((s) => {
      s.puppets.push(result.def);
      s.instances.push({
        id: `inst_${Math.random().toString(36).slice(2, 9)}`,
        defId: result.def.id,
        name: result.def.name,
        x: 0, y: 40, scale: 1, rotation: 0,
        layer: s.instances.length, visible: true,
        ikChains: defaultIkChains(),
      });
    });
    if (result.warnings.length) toast(`导入完成,有 ${result.warnings.length} 个警告:${result.warnings[0]}`, 'warn');
    else toast('PNG 部件导入并对位完成');
    fileInput.value = '';
  });

  sidebar.append(
    h('div', { class: 'panel' }, [
      h('h3', {}, ['程序化生成']),
      h('p', { class: 'muted' }, ['无需外部图片,内置武将/文人两套皮革镂刻风格,16 骨标准人形。']),
      h('div', { class: 'field' }, [h('span', { class: 'field-label' }, ['风格']), styleSel]),
      genBtn,
    ]),
    h('div', { class: 'panel' }, [
      h('h3', {}, ['PNG 部件导入']),
      h('p', { class: 'muted' }, [
        '文件名按关节命名,如 shoulderL_上臂.png、elbowL.png、head_头.png;',
        '含 cap 字样生成关节帽,含 z21 指定层序。系统按 alpha 轮廓自动咬合并补关节帽。',
      ]),
      h('div', { class: 'field' }, [h('span', { class: 'field-label' }, ['影人名称']), nameInput]),
      h('div', { class: 'field' }, [h('span', { class: 'field-label' }, ['PNG 文件(可多选)']), fileInput]),
      importBtn,
    ]),
  );

  /* ---- 右栏:详情 ---- */
  const renderDetail = (def: PuppetDef | null) => {
    mount(detail, h('div', {}, [
      h('div', { class: 'panel' }, [
        h('h3', {}, ['影人详情']),
        def ? h('div', {}, [
          h('div', { style: { textAlign: 'center', marginBottom: '10px' } }, [
            h('img', { class: 'thumb', style: { width: '130px', height: '130px' }, src: renderThumbnail(def) }),
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'field-label' }, ['名称']),
            (() => { const inp = h('input', { type: 'text', value: def.name }); inp.addEventListener('change', () => store.mutate((s) => { s.puppets.find((p) => p.id === def.id)!.name = inp.value; })); return inp; })(),
          ]),
          h('p', { class: 'muted' }, [
            `类型:${def.kind === 'procedural' ? '程序化' : 'PNG 导入'}`, h('br'),
            `骨骼:${def.bones.length} 根`, h('br'),
            `部件:${def.parts.length} 个`, h('br'),
            `关节帽:${def.caps.length} 个(防露缝)`, h('br'),
            `图集:${def.atlasSize}×${def.atlasSize}`,
          ]),
          h('div', { class: 'sep' }),
          h('div', { class: 'field' }, [
            h('span', { class: 'field-label' }, ['皮革透光率']),
            (() => {
              const s2 = h('input', { type: 'range', min: '0', max: '1', step: '0.02', value: String(def.parts[0]?.translucency ?? 0.25) }) as HTMLInputElement;
              s2.addEventListener('input', () => store.mutate((st) => { st.puppets.find((p) => p.id === def.id)!.parts.forEach((pt) => (pt.translucency = Number(s2.value))); }));
              return s2;
            })(),
          ]),
          button('删除影人(连同台上实例)', () => {
            store.mutate((s) => {
              s.puppets = s.puppets.filter((p) => p.id !== def.id);
              s.instances = s.instances.filter((i) => i.defId !== def.id);
              s.timeline.channels = s.timeline.channels.filter((c) => !s.instances.some((i) => i.id === c.instanceId) || s.instances.some((i) => i.id === c.instanceId));
            });
            app.renderer.disposeAtlas(def.id);
            toast('已删除影人', 'warn');
          }, { danger: true }),
        ]) : h('p', { class: 'muted' }, ['从中间网格选择一个影人查看详情。']),
      ]),
    ]));
  };

  /* ---- 中间网格 ---- */
  const renderGrid = () => {
    const grid = main.querySelector('#library-grid')!;
    mount(grid, h('div', { style: { display: 'contents' } }, store.state.puppets.map((def) => {
      const card = h('div', { class: 'list-item', style: { flexDirection: 'column', alignItems: 'stretch', padding: '12px' } }, [
        h('div', { style: { textAlign: 'center' } }, [h('img', { class: 'thumb', style: { width: '100%', height: '110px' }, src: renderThumbnail(def) })]),
        h('div', { class: 'grow', style: { marginTop: '8px' } }, [
          h('div', { class: 'title' }, [def.name]),
          h('div', { class: 'sub' }, [`${def.bones.length} 骨 · ${def.parts.length} 部件 · ${def.kind === 'procedural' ? '程序化' : '导入'}`]),
        ]),
        h('div', { class: 'row', style: { marginTop: '8px' } }, [
          button('编辑绑定', () => renderDetail(def), { primary: true }),
        ]),
      ]);
      card.addEventListener('click', () => renderDetail(def));
      return card;
    })));
    if (store.state.puppets.length === 0) {
      mount(grid, h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, [
        h('div', { class: 'big' }, ['🏮']),
        h('div', {}, ['影人库是空的。在左侧生成一个程序化影人开始吧。']),
      ]));
    }
  };

  disposers.push(store.subscribe(renderGrid));
  renderGrid();
  renderDetail(null);
  page.append(sidebar, main, detail);
  return { root: page, dispose: () => disposers.forEach((d) => d()) };
}

function defaultIkChains() {
  const mk = (name: string, rootBoneId: string, midBoneId: string, endBoneId: string, pole: 1 | -1) => ({
    id: `ik_${Math.random().toString(36).slice(2, 9)}`, name, rootBoneId, midBoneId, endBoneId, pole,
  });
  return [
    mk('左臂', 'shoulderL', 'elbowL', 'wristL', 1),
    mk('右臂', 'shoulderR', 'elbowR', 'wristR', -1),
    mk('左腿', 'hipL', 'kneeL', 'ankleL', 1),
    mk('右腿', 'hipR', 'kneeR', 'ankleR', -1),
  ];
}
