import { h } from './dom';
import type { AppContext } from './AppContext';

/**
 * 共享舞台视口:canvas/overlay 由 AppContext 持有且全局唯一。
 * 页面切换时复用同一个单例(DOM append 自动移动节点),HUD 只构建一次,
 * 避免重复订阅与重复 HUD。
 */
export class SharedViewport {
  wrap: HTMLElement;
  private toolbar: HTMLElement;
  private static instance: SharedViewport | null = null;

  static get(app: AppContext): SharedViewport {
    if (!SharedViewport.instance) SharedViewport.instance = new SharedViewport(app);
    return SharedViewport.instance;
  }

  private constructor(private app: AppContext) {
    this.wrap = h('div', { class: 'canvas-wrap' });
    this.wrap.append(app.canvas, app.overlay);

    const hud = h('div', { class: 'hud' }, [
      h('div', { class: 'chip' }, ['影人 ', h('b', { id: 'hud-instances' }, ['0'])]),
      h('div', { class: 'chip' }, ['关节 ', h('b', { id: 'hud-joints' }, ['0'])]),
      h('div', { class: 'chip' }, ['帧率 ', h('b', { id: 'hud-fps' }, ['60']), ' FPS']),
      h('div', { class: 'chip' }, ['绘制 ', h('b', { id: 'hud-calls' }, ['0']), ' call']),
    ]);
    this.toolbar = h('div', { class: 'canvas-toolbar' });
    this.wrap.append(hud, this.toolbar);

    const updateHud = () => {
      const instances = app.store.state.instances.filter((i) => i.visible);
      const joints = instances.reduce((sum, inst) => sum + (app.store.getPuppetDef(inst.defId)?.bones.length ?? 0), 0);
      const set = (id: string, txt: string) => {
        const n = this.wrap.querySelector(`#${id}`);
        if (n) n.textContent = txt;
      };
      set('hud-instances', String(instances.length));
      set('hud-joints', String(joints));
      set('hud-fps', String(app.displayFps));
      set('hud-calls', String(app.renderer.renderStats.drawCalls));
    };
    app.onFrame(updateHud);
    app.store.subscribe(updateHud);
  }

  /** 设置当前页面的工具按钮(切换页面时替换) */
  setToolbar(buttons: HTMLElement[]) {
    this.toolbar.innerHTML = '';
    this.toolbar.append(...buttons);
  }

  render(): HTMLElement {
    return this.wrap;
  }
}
