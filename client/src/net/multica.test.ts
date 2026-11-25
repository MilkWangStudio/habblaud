import { afterEach, expect, it, vi } from 'vitest';
import type { MulticaFrame, WorkspaceFacts } from '../../../shared/multica';
import { MulticaSources } from './multica';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class Source {
  static CLOSED = 2;
  static sockets: Source[] = [];
  readyState = 1;
  onmessage?: (evt: { data: string }) => void;
  onerror?: () => void;
  close() { this.readyState = Source.CLOSED; }
  constructor(readonly url: string) { Source.sockets.push(this); }
  send(workspaceId: string, frame: MulticaFrame) {
    this.onmessage?.({ data: JSON.stringify({ workspaceId, frame }) });
  }
}

function facts(id: string, mine: boolean): WorkspaceFacts {
  return { workspace: { id, name: 'Office' }, viewerId: 'me', issues: [{
    id: 'issue', title: 'Review', projectId: '', identifier: '', category: '', label: '', status: 'in_review',
    assigneeId: mine ? 'me' : 'other', assigneeType: 'member',
  }], projects: [], agents: [], runs: [] };
}
function setup() {
  vi.stubGlobal('EventSource', Source);
  const review = vi.fn();
  const office = new MulticaSources(() => {}, review);
  office.enable(true);
  office.list = [A, B].map(id => ({ id, name: 'Office' }));
  const select = (...workspaces: string[]) => office.set({ ...office.prefs, workspaces });
  return { office, review, select };
}
afterEach(() => { Source.sockets = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

it('uses one stream per tab, keeps A during selection changes, and ignores obsolete frames', () => {
  const { office, review, select } = setup();
  select(A);
  const [first] = Source.sockets;
  first.send(A, { state: 'live', facts: facts(A, true) });
  select(A, B);
  const [, both] = Source.sockets;
  expect(first.readyState).toBe(Source.CLOSED);
  expect(new URL(both.url, 'http://localhost').searchParams.getAll('workspace')).toEqual([A, B]);
  expect(office.live.map(f => f.workspace.id)).toEqual([A]);
  select(B, A);
  expect(Source.sockets).toHaveLength(2);
  first.send(A, { state: 'unavailable' });
  both.send(A, { state: 'live', facts: facts(A, true) });
  both.send(B, { state: 'unavailable' });
  expect(office.live.map(f => f.workspace.id)).toEqual([A]);
  select(A);
  const [, , last] = Source.sockets;
  both.send(B, { state: 'live', facts: facts(B, true) });
  expect(office.frames.has(B)).toBe(false);
  last.send(A, { state: 'live', facts: facts(A, true) });
  expect(review).not.toHaveBeenCalled();
  select();
  expect(Source.sockets.every(s => s.readyState === Source.CLOSED)).toBe(true);
});
it('rebuilds per-workspace baselines after disconnect and raises each new handoff once', () => {
  vi.useFakeTimers();
  const { office, select, review } = setup();
  select(A, B);
  const [s] = Source.sockets;
  s.send(A, { state: 'live', facts: facts(A, true) });
  s.send(B, { state: 'live', facts: facts(B, false) });
  s.readyState = 0;
  s.onerror?.();
  expect(office.live).toEqual([]);
  s.send(A, { state: 'live', facts: facts(A, true) });
  s.send(B, { state: 'live', facts: facts(B, false) });
  s.send(B, { state: 'live', facts: facts(B, true) });
  s.send(B, { state: 'live', facts: facts(B, true) });
  expect(review).toHaveBeenCalledTimes(1);
  s.close(); s.onerror?.();
  vi.advanceTimersByTime(3000);
  expect(Source.sockets).toHaveLength(2);
  Source.sockets[1].send(B, { state: 'live', facts: facts(B, true) });
  expect(review).toHaveBeenCalledTimes(1);
  Source.sockets[1].close(); Source.sockets[1].onerror?.();
  office.enable(false);
  vi.advanceTimersByTime(5000);
  expect(Source.sockets).toHaveLength(2);
});
