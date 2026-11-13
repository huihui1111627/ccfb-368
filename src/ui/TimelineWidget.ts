import type { AnimChannel, Keyframe, Timeline } from '../types';
import { h } from './dom';

export interface TimelineSelection {
  channelId: string | null;
  keyframeId: string | null;
}

/**
 * 多轨时间线:刻度尺、关键帧菱形拖拽、播放头。
 * 所有改动通过回调上抛,由页面决定是否入历史。
 */
export class TimelineWidget {
  el: HTMLElement;
  private ruler!: HTMLElement;
  private tracks!: HTMLElement;
  private trackLabelHost!: HTMLElement;
  private playhead!: HTMLElement;
  private timeLabel!: HTMLElement;
  private channels: AnimChannel[] = [];
  private duration = 6;
  private currentTime = 0;
  selection: TimelineSelection = { channelId: null, keyframeId: null };
  private onChange: () => void;
  private onSelect: (sel: TimelineSelection) => void;
  private onScrub: (t: number) => void;

  constructor(opts: {
    onChange: () => void;
    onSelect: (sel: TimelineSelection) => void;
    onScrub: (t: number) => void;
  }) {
    this.onChange = opts.onChange;
    this.onSelect = opts.onSelect;
    this.onScrub = opts.onScrub;
    this.el = h('div', { class: 'timeline-body' }, []);
    this.build();
  }

  private build() {
    const left = h('div', {
      style: { width: '150px', flexShrink: '0', borderRight: '1px solid var(--line)', background: 'var(--bg-panel-2)', display: 'flex', flexDirection: 'column' },
    });
    const leftSpacer = h('div', { style: { height: '26px', borderBottom: '1px solid var(--line)' } });
    this.trackLabelHost = h('div', { style: { flex: '1' } });
    left.append(leftSpacer, this.trackLabelHost);

    const right = h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minWidth: '0' } });
    this.ruler = h('div', { class: 'ruler' });
    this.timeLabel = h('span', { class: 'time' }, ['0.00s']);

    const scrollWrap = h('div', { style: { flex: '1', position: 'relative', overflow: 'auto' } });
    this.tracks = h('div', { class: 'timeline-tracks', style: { position: 'static' } });
    this.playhead = h('div', { class: 'playhead', style: { top: '0' } });
    scrollWrap.append(this.tracks, this.playhead);
    right.append(this.ruler, scrollWrap);

    this.ruler.addEventListener('pointerdown', (e) => {
      const t = this.eventToTime(e);
      this.onScrub(t);
      const move = (ev: PointerEvent) => this.onScrub(this.eventToTime(ev));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    this.el.append(left, right);
  }

  private eventToTime(e: PointerEvent): number {
    const rect = this.ruler.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    return (x / rect.width) * this.duration;
  }

  setData(timeline: Timeline, currentTime: number, labelOf: (ch: AnimChannel) => string) {
    this.channels = timeline.channels;
    this.duration = timeline.duration;
    this.currentTime = currentTime;
    this.renderRuler();
    this.renderTracks(labelOf);
    this.updatePlayhead();
  }

  setTime(t: number) {
    this.currentTime = t;
    this.updatePlayhead();
  }

  private renderRuler() {
    this.ruler.innerHTML = '';
    const step = this.duration <= 8 ? 0.5 : this.duration <= 20 ? 1 : 2;
    for (let t = 0; t <= this.duration + 1e-6; t += step) {
      const pct = (t / this.duration) * 100;
      const tick = h('div', { class: 'tick', style: { left: `${pct}%` } });
      const label = h('div', { class: 'tick-label', style: { left: `${pct}%` } }, [t.toFixed(1)]);
      this.ruler.append(tick, label);
    }
  }

  private renderTracks(labelOf: (ch: AnimChannel) => string) {
    this.tracks.innerHTML = '';
    this.trackLabelHost.innerHTML = '';
    if (this.channels.length === 0) {
      this.tracks.append(h('div', { class: 'empty', style: { padding: '24px' } }, ['还没有动画通道。在舞台上摆好姿势后,点击「记录关键帧」。']));
      return;
    }
    for (const ch of this.channels) {
      const row = h('div', { class: 'track-row' });
      const label = h('div', { class: 'track-label', title: labelOf(ch), style: { position: 'static' } }, [
        h('span', { class: `tag ${ch.type === 'ikTarget' ? 'ik' : 'bone'}` }, [ch.type === 'ikTarget' ? 'IK' : '骨']),
        h('span', { style: { marginLeft: '6px', overflow: 'hidden', textOverflow: 'ellipsis' } }, [labelOf(ch)]),
      ]);
      this.trackLabelHost.append(label);
      const lane = h('div', { class: 'track-lane' });
      for (const kf of [...ch.keyframes].sort((a, b) => a.t - b.t)) {
        const dot = h('div', {
          class: `kf-dot ${this.selection.keyframeId === kf.id ? 'selected' : ''}`,
          style: { left: `${(kf.t / this.duration) * 100}%` },
          title: `t=${kf.t.toFixed(2)}s`,
        });
        dot.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.selection = { channelId: ch.id, keyframeId: kf.id };
          this.onSelect(this.selection);
          const startX = e.clientX;
          const startT = kf.t;
          const move = (ev: PointerEvent) => {
            const rect = this.ruler.getBoundingClientRect();
            const dx = ev.clientX - startX;
            const nt = Math.max(0, Math.min(this.duration, startT + (dx / rect.width) * this.duration));
            kf.t = Math.round(nt * 100) / 100;
            this.onChange();
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        lane.append(dot);
      }
      row.append(label, lane);
      this.tracks.append(row);
    }
  }

  private updatePlayhead() {
    const pct = (this.currentTime / Math.max(1e-6, this.duration)) * 100;
    this.playhead.style.left = `${pct}%`;
    if (this.timeLabel.isConnected) this.timeLabel.textContent = `${this.currentTime.toFixed(2)}s`;
  }

  getTimeLabel() {
    return this.timeLabel;
  }

  /** 供外部选中关键帧后刷新高亮 */
  refreshSelection(sel: TimelineSelection) {
    this.selection = sel;
  }

  findSelected(): { channel: AnimChannel; keyframe: Keyframe } | null {
    if (!this.selection.channelId || !this.selection.keyframeId) return null;
    const channel = this.channels.find((c) => c.id === this.selection.channelId);
    const keyframe = channel?.keyframes.find((k) => k.id === this.selection.keyframeId);
    return channel && keyframe ? { channel, keyframe } : null;
  }
}
