import './ui/styles.css';
import { store } from './core/state/store';
import { App } from './ui/App';
import { toast } from './ui/dom';

async function boot() {
  // 先尝试恢复浏览器里的工程(含图集位图)
  try {
    const restored = await store.hydrate();
    if (restored) toast('已从浏览器恢复上次工程');
  } catch (e) {
    console.warn('工程恢复失败,使用默认工程', e);
  }
  new App(store);
}

// 调试/自动化钩子
declare global {
  interface Window {
    __SHADOW_APP__?: unknown;
  }
}

void boot();
