/** 极简 DOM 构建工具,避免引入框架 */
type ElProps<K extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[K]>, 'style' | 'dataset'> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  dataset?: Record<string, string>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {} as ElProps<K>,
  children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(props)) {
    if (k === 'class') el.className = val as string;
    else if (k === 'style') Object.assign(el.style, val);
    else if (k === 'dataset') Object.assign(el.dataset, val);
    else if (k.startsWith('on') && typeof val === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), val as EventListener);
    } else if (val !== undefined && val !== null) {
      (el as unknown as Record<string, unknown>)[k] = val;
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(el: Element, node: Node) {
  clear(el as HTMLElement);
  el.append(node);
}

export function labeled(label: string, control: HTMLElement): HTMLLabelElement {
  return h('label', { class: 'field' }, [h('span', { class: 'field-label' }, [label]), control]);
}

export function slider(min: number, max: number, value: number, step = 1, onInput: (v: number) => void) {
  const s = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  s.addEventListener('input', () => onInput(Number(s.value)));
  return s;
}

export function numberInput(value: number, onInput: (v: number) => void, step = 1) {
  const n = h('input', { type: 'number', value: String(value), step: String(step) });
  n.addEventListener('input', () => onInput(Number(n.value)));
  return n;
}

export function button(text: string, onClick: () => void, opts: { primary?: boolean; danger?: boolean } = {}) {
  return h('button', { class: `btn ${opts.primary ? 'btn-primary' : ''} ${opts.danger ? 'btn-danger' : ''}`, onclick: onClick }, [text]);
}

export function select(options: { value: string; label: string }[], value: string, onChange: (v: string) => void) {
  const s = h('select', {}, options.map((o) => h('option', { value: o.value, selected: o.value === value }, [o.label])));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function toast(msg: string, kind: 'info' | 'warn' | 'error' = 'info') {
  const t = h('div', { class: `toast toast-${kind}` }, [msg]);
  document.getElementById('toast-root')!.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 2600);
}
