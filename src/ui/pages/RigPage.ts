import type { IkChain, PuppetDef } from '../../types';
import { deg, rad } from '../../core/math/vec2';
import { button, h, labeled, mount, numberInput, select, slider, toast } from '../dom';
import type { AppContext } from '../AppContext';
import type { PageHandle } from '../App';
import { SharedViewport } from '../SharedViewport';

export function renderRigPage(app: AppContext): PageHandle {
  const store = app.store;
  const disposers: (() => void)[] = [];
  const page = h('div', { class: 'workspace' });
  const sidebar = h('div', { class: 'sidebar' });
  const right = h('div', { class: 'sidebar right' });

  const puppetSel = select(
    store.state.puppets.map((p) => ({ value: p.id, label: p.name })),
    store.state.puppets[0]?.id ?? '',
    () => refresh(),
  );

  const currentDef = (): PuppetDef | undefined => store.state.puppets.find((p) => p.id === puppetSel.value);

  /* ---- 视口 ---- */
  const viewport = SharedViewport.get(app);
  const wrap = viewport.render();
  viewport.setToolbar([
    (() => {
      const b = button('骨架:开', () => {
        app.controller.showSkeleton = !app.controller.showSkeleton;
        b.textContent = `骨架:${app.controller.showSkeleton ? '开' : '关'}`;
      });
      return b;
    })(),
    (() => {
      const b = button('手柄:开', () => {
        app.controller.showEffectors = !app.controller.showEffectors;
        b.textContent = `手柄:${app.controller.showEffectors ? '开' : '关'}`;
      });
      return b;
    })(),
  ]);

  /* ---- 左栏:骨骼树与关节限位 ---- */
  const bonePanel = h('div', { class: 'panel' });
  const renderBones = () => {
    const def = currentDef();
    mount(bonePanel, h('div', {}, [
      h('h3', {}, ['骨骼与关节限位']),
      !def ? h('p', { class: 'muted' }, ['请先生成或导入影人']) : h('div', {}, def.bones.map((bone) => {
        const row = h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title' }, [bone.name, h('span', { class: 'tag bone', style: { marginLeft: '6px' } }, [bone.id])]),
            h('div', { class: 'sub' }, [
              bone.limits
                ? `限位 ${deg(bone.limits[0]).toFixed(0)}° ~ ${deg(bone.limits[1]).toFixed(0)}°`
                : '自由旋转',
            ]),
          ]),
        ]);
        row.addEventListener('click', () => renderBoneDetail(def, bone.id));
        return row;
      })),
    ]));
  };

  const renderBoneDetail = (def: PuppetDef, boneId: string) => {
    const bone = def.bones.find((b) => b.id === boneId)!;
    const minDeg = bone.limits ? deg(bone.limits[0]) : -180;
    const maxDeg = bone.limits ? deg(bone.limits[1]) : 180;
    const minInp = numberInput(minDeg, () => {}, 1);
    const maxInp = numberInput(maxDeg, () => {}, 1);
    const apply = () => {
      const lo = rad(Number(minInp.value));
      const hi = rad(Number(maxInp.value));
      store.mutate((s) => {
        const b = s.puppets.find((p) => p.id === def.id)!.bones.find((x) => x.id === boneId)!;
        b.limits = lo <= hi ? [lo, hi] : [hi, lo];
      });
      toast(`${bone.name} 限位已更新`);
    };
    mount(right, h('div', { class: 'panel' }, [
      h('h3', {}, [`关节:${bone.name}`]),
      h('p', { class: 'muted' }, [
        `父节点:${bone.parentId ?? '无(根)'}`, h('br'),
        `静止旋转:${deg(bone.restRotation).toFixed(1)}°`, h('br'),
        `骨长:${bone.length.toFixed(1)} px`, h('br'),
        '限位是相对静止姿态的转动范围,IK 求解时会自动松弛遵守。',
      ]),
      labeled('最小角度(度)', minInp),
      labeled('最大角度(度)', maxInp),
      button('应用限位', apply, { primary: true }),
      h('div', { class: 'sep' }),
      button('恢复全周自由', () => {
        store.mutate((s) => { s.puppets.find((p) => p.id === def.id)!.bones.find((x) => x.id === boneId)!.limits = null; });
        renderBoneDetail(store.state.puppets.find((p) => p.id === def.id)!, boneId);
      }),
      h('div', { class: 'sep' }),
      h('h3', {}, ['试转(实时)']),
      (() => {
        const s2 = slider(-180, 180, 0, 1, (v) => {
          const inst = store.state.instances.find((i) => i.defId === def.id);
          if (!inst) return;
          if (!app.livePose.has(inst.id)) app.livePose.set(inst.id, new Map());
          let delta = rad(v);
          if (bone.limits) delta = Math.max(bone.limits[0], Math.min(bone.limits[1], delta));
          app.livePose.get(inst.id)!.set(boneId, delta);
        });
        return s2;
      })(),
      h('p', { class: 'muted' }, ['拖动滑块观察关节在限位内转动,关节帽保证不露缝。']),
    ]));
  };

  /* ---- 左栏下半:IK 链 ---- */
  const ikPanel = h('div', { class: 'panel' });
  const renderIk = () => {
    const def = currentDef();
    const inst = store.state.instances.find((i) => i.defId === def?.id);
    mount(ikPanel, h('div', {}, [
      h('h3', {}, ['IK 链(拖末端带动整肢)']),
      !inst ? h('p', { class: 'muted' }, ['该影人还没有上台实例']) : h('div', {}, inst.ikChains.map((chain) => {
        const row = h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title' }, [chain.name, h('span', { class: 'tag ik', style: { marginLeft: '6px' } }, ['IK'])]),
            h('div', { class: 'sub' }, [`${chain.rootBoneId} → ${chain.midBoneId} → ${chain.endBoneId}`]),
          ]),
        ]);
        row.addEventListener('click', () => renderIkDetail(inst, chain));
        return row;
      })),
      inst ? h('div', { style: { marginTop: '8px' } }, [
        button('新增 IK 链', () => addIkChain(def!, inst)),
      ]) : null,
    ]));
  };

  const renderIkDetail = (inst: { id: string; defId: string; ikChains: IkChain[] }, chain: IkChain) => {
    const poleSel = select([{ value: '1', label: '正向(+1)' }, { value: '-1', label: '反向(-1)' }], String(chain.pole), () => {});
    mount(right, h('div', { class: 'panel' }, [
      h('h3', {}, [`IK 链:${chain.name}`]),
      h('p', { class: 'muted' }, ['两骨解析 IK + 关节限位松弛。弯曲方向决定肘/膝朝向。']),
      labeled('弯曲方向', poleSel),
      button('保存', () => {
        store.mutate((s) => {
          const target = s.instances.find((i) => i.id === inst.id)!.ikChains.find((c) => c.id === chain.id)!;
          target.pole = Number(poleSel.value) as 1 | -1;
        });
        toast('IK 链已更新');
      }, { primary: true }),
      h('div', { class: 'sep' }),
      button('删除该 IK 链', () => {
        store.mutate((s) => {
          const target = s.instances.find((i) => i.id === inst.id)!;
          target.ikChains = target.ikChains.filter((c) => c.id !== chain.id);
        });
        renderIk();
      }, { danger: true }),
    ]));
  };

  const addIkChain = (def: PuppetDef, inst: { id: string }) => {
    const bones = def.bones.filter((b) => b.parentId).map((b) => ({ value: b.id, label: `${b.name} (${b.id})` }));
    const rootSel = select(bones, bones[0]?.value ?? '', () => {});
    const midSel = select(bones, bones[1]?.value ?? '', () => {});
    const endSel = select(bones, bones[2]?.value ?? '', () => {});
    mount(right, h('div', { class: 'panel' }, [
      h('h3', {}, ['新增 IK 链']),
      labeled('根骨(肩/髋)', rootSel),
      labeled('中骨(肘/膝)', midSel),
      labeled('末端骨(腕/踝)', endSel),
      button('创建', () => {
        store.mutate((s) => {
          s.instances.find((i) => i.id === inst.id)!.ikChains.push({
            id: `ik_${Math.random().toString(36).slice(2, 9)}`,
            name: `${rootSel.value}链`,
            rootBoneId: rootSel.value,
            midBoneId: midSel.value,
            endBoneId: endSel.value,
            pole: 1,
          });
        });
        renderIk();
        toast('IK 链已创建');
      }, { primary: true }),
    ]));
  };

  /* ---- 左栏底部:部件锚点 ---- */
  const partPanel = h('div', { class: 'panel' });
  const renderParts = () => {
    const def = currentDef();
    mount(partPanel, h('div', {}, [
      h('h3', {}, ['部件锚点与层序']),
      !def ? h('p', { class: 'muted' }, ['无影人']) : h('div', { style: { maxHeight: '260px', overflow: 'auto' } }, def.parts.map((p) => {
        const row = h('div', { class: 'list-item' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'title' }, [p.name]),
            h('div', { class: 'sub' }, [`挂 ${p.anchor.boneId} · z=${p.z}`]),
          ]),
        ]);
        row.addEventListener('click', () => renderPartDetail(def, p.id));
        return row;
      })),
    ]));
  };

  const renderPartDetail = (def: PuppetDef, partId: string) => {
    const part = def.parts.find((p) => p.id === partId)!;
    const offX = numberInput(part.anchor.offset[0], () => {}, 1);
    const offY = numberInput(part.anchor.offset[1], () => {}, 1);
    const zInp = numberInput(part.z, () => {}, 1);
    const follow = h('input', { type: 'checkbox', checked: part.anchor.followRotation }) as HTMLInputElement;
    mount(right, h('div', { class: 'panel' }, [
      h('h3', {}, [`部件:${part.name}`]),
      h('p', { class: 'muted' }, ['锚点是部件原点相对骨骼原点的局部偏移。PNG 导入时已按 alpha 轮廓自动对位。']),
      labeled('锚点 X', offX),
      labeled('锚点 Y', offY),
      labeled('层序 z(小=靠后)', zInp),
      h('label', { class: 'checkbox' }, [follow, ' 跟随骨骼旋转']),
      h('div', { class: 'sep' }),
      button('保存调整', () => {
        store.mutate((s) => {
          const pt = s.puppets.find((p) => p.id === def.id)!.parts.find((x) => x.id === partId)!;
          pt.anchor.offset = [Number(offX.value), Number(offY.value)];
          pt.z = Number(zInp.value);
          pt.anchor.followRotation = follow.checked;
        });
        toast('部件锚点已保存');
      }, { primary: true }),
    ]));
  };

  const refresh = () => {
    renderBones();
    renderIk();
    renderParts();
  };

  disposers.push(store.subscribe(() => {
    const cur = puppetSel.value;
    const opts = store.state.puppets.map((p) => ({ value: p.id, label: p.name }));
    if (puppetSel.options.length !== opts.length || [...puppetSel.options].some((o, i) => o.value !== opts[i]?.value)) {
      puppetSel.innerHTML = '';
      for (const o of opts) puppetSel.append(h('option', { value: o.value }, [o.label]));
      puppetSel.value = cur && opts.some((o) => o.value === cur) ? cur : opts[0]?.value ?? '';
    }
    refresh();
  }));

  sidebar.append(
    h('div', { class: 'panel' }, [h('h3', {}, ['选择影人']), puppetSel]),
    bonePanel,
    ikPanel,
    partPanel,
  );

  const main = h('div', { class: 'stage-area' }, [wrap]);
  refresh();
  page.append(sidebar, main, right);
  return { root: page, dispose: () => disposers.forEach((d) => d()) };
}
