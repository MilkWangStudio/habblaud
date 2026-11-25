import { afterEach, expect, it, vi } from 'vitest';
import * as client from './client';
import { WorkspaceStream, type Frame } from './stream';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: (e: { code: number }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor(readonly url: URL) { Socket.instances.push(this); }
  message(type: string, workspace_id?: string) { this.onmessage?.({ data: JSON.stringify({ type, workspace_id }) }); }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Socket.instances = []; });
it('authenticates, batches changes, clears facts on disconnect, then resnapshots on reconnect', async () => {
  vi.stubGlobal('WebSocket', Socket);
  vi.spyOn(client, 'readCredentials').mockResolvedValue({ origin: 'https://multica.invalid', token: 'secret' });
  const facts = { workspace: { id: 'w', name: 'Office' }, projects: [], agents: [], issues: [], runs: [] };
  const read = vi.spyOn(client, 'readWorkspace').mockResolvedValue(facts);
  const stream = new WorkspaceStream('w');
  const frames: Frame[] = [];
  stream.subscribe(f => frames.push(f));
  const running = stream.run();
  try {
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0];
    expect(socket.url.href).toBe('wss://multica.invalid/ws?workspace_id=w');
    socket.onopen?.();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'auth', payload: { token: 'secret' } });
    expect(read).toHaveBeenCalledTimes(0);
    socket.message('auth_ack');
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({ state: 'live', facts }));
    socket.message('task:message'); socket.message('issue:updated', 'another-workspace');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(read).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) socket.message('issue:updated', 'w');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    socket.onclose?.({ code: 1006 });
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({ state: 'stale', reason: 'upstream' }));
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(2), { timeout: 2500 });
    Socket.instances[1].message('auth_ack');
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({ state: 'live', facts }));
    expect(read).toHaveBeenCalledTimes(3);
    Socket.instances[1].message('error');
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({ state: 'unavailable', reason: 'access' }));
  } finally { stream.close(); await running; }
});
