import { uuid, type WorkspaceFacts, type WorkspaceRef, type MulticaFrame } from '../../../shared/multica';
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
  private streams = new Map<string, EventSource>();
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
    const selected = new Set(this.enabled ? this.list.filter(w => this.prefs.workspaces.includes(w.id)).map(w => w.id) : []);
    for (const [id, stream] of this.streams) if (!selected.has(id)) {
      stream.close(); this.streams.delete(id); this.frames.delete(id);
    }
    for (const id of selected) if (!this.streams.has(id)) {
      const es = new EventSource('/api/multica/workspaces/' + id + '/events');
      this.streams.set(id, es); this.frames.set(id, { state: 'connecting' });
      es.onmessage = ev => {
        if (this.streams.get(id) !== es) return;
        const prev = this.frames.get(id);
        let frame: MulticaFrame;
        try {
          frame = JSON.parse(ev.data);
          if (frame.state === 'live' && frame.facts.workspace.id !== id) throw Error();
        } catch { frame = { state: 'stale' }; }
        this.frames.set(id, frame); this.change();
        if (frame.state === 'live') for (const issue of handoffs(prev?.state === 'live' ? prev.facts : undefined, frame.facts)) this.review(frame.facts, issue);
      };
      es.onerror = () => {
        if (this.streams.get(id) !== es) return;
        this.frames.set(id, { state: 'stale' }); this.change();
        if (es.readyState === EventSource.CLOSED) {
          this.streams.delete(id);
          setTimeout(() => { if (this.enabled && this.prefs.workspaces.includes(id)) void this.discover(); }, 3000);
        }
      };
    }
    for (const id of this.frames.keys()) if (!selected.has(id)) this.frames.delete(id);
  }
}
