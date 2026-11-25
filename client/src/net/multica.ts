import { uuid, type WorkspaceFacts, type WorkspaceRef, type MulticaFrame, type WorkspaceEvent } from '../../../shared/multica';
import { defaults, handoffs, type SelectionPrefs } from './multica-model';

const prefKey = 'habblaud:multica:sources';
function readPrefs(): SelectionPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(prefKey) ?? '{}');
    return { codex: v.codex !== false, claude: v.claude !== false,
      workspaces: Array.isArray(v.workspaces) ? [...new Set<string>(v.workspaces.filter((s: string) => uuid.test(s)))] : [] };
  } catch { return { ...defaults }; }
}

export class MulticaSources {
  prefs = readPrefs();
  list: WorkspaceRef[] = [];
  state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  frames = new Map<string, MulticaFrame>();
  private stream?: EventSource;
  private selection = '';
  private retry?: ReturnType<typeof setTimeout>;
  private generation = 0;
  enabled = false;
  constructor(private change: () => void, private review: (facts: WorkspaceFacts, issue: WorkspaceFacts['issues'][number]) => void) {}
  get live() { return [...this.frames.values()].flatMap(f => f.state === 'live' ? [f.facts] : []); }
  enable(on: boolean) {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on && this.prefs.workspaces.length) void this.discover();
    if (!on) {
      this.generation++;
      this.list = []; this.state = 'idle'; this.sync();
    }
  }
  async discover() {
    if (!this.enabled || this.state === 'loading') return;
    const gen = ++this.generation;
    this.state = 'loading'; this.change();
    try {
      const res = await fetch('/api/multica/workspaces', { cache: 'no-store', signal: AbortSignal.timeout(22000) });
      if (!res.ok) throw Error();
      const data = await res.json();
      if (gen !== this.generation) return;
      this.list = data.workspaces.filter((w: WorkspaceRef) => uuid.test(w.id));
      this.state = 'ready';
    } catch {
      if (gen !== this.generation) return;
      this.list = []; this.state = 'error';
    }
    this.sync(); this.change();
  }
  set(prefs: SelectionPrefs) {
    this.prefs = prefs;
    try { localStorage.setItem(prefKey, JSON.stringify(prefs)); } catch { /* tabs may disable storage */ }
    this.sync(); this.change();
  }
  private sync() {
    const ids = this.enabled ? this.list.map(w => w.id).filter(id => this.prefs.workspaces.includes(id)).sort() : [];
    const selection = ids.join(',');
    if (selection === this.selection && (this.stream || !ids.length)) return;
    this.selection = selection;
    clearTimeout(this.retry);
    this.stream?.close();
    this.stream = undefined;
    const selected = new Set(ids);
    for (const id of this.frames.keys()) if (!selected.has(id)) this.frames.delete(id);
    if (!ids.length) return;
    const params = new URLSearchParams();
    for (const id of selected) {
      params.append('workspace', id);
      if (!this.frames.has(id)) this.frames.set(id, { state: 'connecting' });
    }
    const es = new EventSource('/api/multica/events?' + params);
    this.stream = es;
    es.onmessage = ev => {
      if (this.stream !== es) return;
      let event: WorkspaceEvent;
      try { event = JSON.parse(ev.data); } catch { return; }
      if (!event || !selected.has(event.workspaceId)) return;
      const { workspaceId, frame } = event;
      const previous = this.frames.get(workspaceId);
      if (!frame || !['connecting', 'live', 'stale', 'unavailable'].includes(frame.state) ||
          (frame.state === 'live' && frame.facts?.workspace?.id !== workspaceId)) {
        this.frames.set(workspaceId, { state: 'stale' });
        this.change();
        return;
      }
      this.frames.set(workspaceId, frame);
      this.change();
      if (frame.state === 'live') {
        for (const issue of handoffs(previous?.state === 'live' ? previous.facts : undefined, frame.facts)) this.review(frame.facts, issue);
      }
    };
    es.onerror = () => {
      if (this.stream !== es) return;
      for (const id of selected) this.frames.set(id, { state: 'stale' });
      if (es.readyState === EventSource.CLOSED) {
        this.stream = undefined;
        this.retry = setTimeout(() => { if (this.enabled && this.selection === selection) this.sync(); }, 3000);
      }
      this.change();
    };
  }
}
