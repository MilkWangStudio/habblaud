import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceStream } from './stream';
import { multicaRoutes } from './http';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
class Reply extends EventEmitter {
  writeHead = vi.fn();
  write = vi.fn((_chunk: string) => true);
  end = vi.fn();
  destroy() { this.emit('close'); }
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('shares upstream sockets across combined and legacy requests and releases the last subscriber', () => {
  vi.useFakeTimers();
  const run = vi.spyOn(WorkspaceStream.prototype, 'run').mockResolvedValue();
  const close = vi.spyOn(WorkspaceStream.prototype, 'close');
  const routes = multicaRoutes();
  const get = (path: string, res = new Reply()) => {
    routes.handle({} as IncomingMessage, res as unknown as ServerResponse, new URL('http://localhost' + path));
    return res;
  };
  try {
    const invalid = get('/api/multica/events?workspace=' + a + '&workspace=oops');
    expect(invalid.writeHead.mock.calls[0][0]).toBe(400);
    expect(run).not.toHaveBeenCalled();
    const tab = new Reply();
    tab.write.mockReturnValueOnce(false);
    get('/api/multica/events?workspace=' + a + '&workspace=' + b + '&workspace=' + a, tab);
    expect(run).toHaveBeenCalledTimes(2);
    expect(tab.write.mock.calls).toHaveLength(1);
    tab.emit('drain');
    const messages = tab.write.mock.calls.map(([data]) => JSON.parse(data.slice(6)));
    expect(messages).toEqual([a, b].map(workspaceId => ({ workspaceId, frame: { state: 'connecting' } })));
    const legacy = get('/api/multica/workspaces/' + b + '/events');
    expect(JSON.parse(legacy.write.mock.calls[0][0].slice(6))).toEqual({ state: 'connecting' });
    tab.destroy();
    const again = get('/api/multica/events?workspace=' + a);
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    again.destroy(); legacy.destroy();
    vi.advanceTimersByTime(3000);
    expect(close).toHaveBeenCalledTimes(2);
  } finally { routes.close(); }
});
