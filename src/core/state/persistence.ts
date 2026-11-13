import type { ProjectState } from '../../types';

const DB_NAME = 'shadow-puppet-studio';
const STORE = 'projects';
const LEGACY_KEY = 'shadow-puppet-project-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

/** 图集 canvas 单独存成 dataURL,工程 JSON 里不携带位图 */
export interface PersistedProject {
  state: ProjectState;
  atlases: Record<string, string>; // puppetId -> dataURL
}

export async function saveProject(data: PersistedProject): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(data, 'current'));
  } catch {
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(data));
    } catch {
      // 存储满或被禁用:静默失败,会话内状态仍可用
      console.warn('工程持久化失败:存储空间不可用');
    }
  }
}

export async function loadProject(): Promise<PersistedProject | null> {
  try {
    const data = await tx<PersistedProject | undefined>('readonly', (s) => s.get('current'));
    if (data) return data;
  } catch {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) return JSON.parse(raw) as PersistedProject;
  }
  return null;
}

export async function clearProject(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete('current'));
  } catch {
    localStorage.removeItem(LEGACY_KEY);
  }
}

/** dataURL -> canvas */
export function dataUrlToCanvas(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}
