import type { IncomingMessage, ServerResponse } from 'node:http';
import { uuid, type SessionBinding } from '../../../shared/multica';
import { readJson, sendJson } from '../../http/app';
import { listWorkspaces, MulticaError, readCredentials } from './client';
import { WorkspaceStream } from './stream';

const workspaceId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function multicaRoutes() {
  const streams = new Map<string, WorkspaceStream>();
  const bindings = new Map<string, { workspace: string; value: SessionBinding }>();
  const clients = new Set<ServerResponse>();
  const handle = (req: IncomingMessage, res: ServerResponse, path: string) => {
    clients.add(res);
    res.once('close', () => clients.delete(res));
    if (path === '/api/multica/session') {
      void readJson(req, 2048).then(raw => {
        const b = raw as (SessionBinding & { workspace: string }) | null;
        if (!b || ![b.workspace, b.agentId, b.id].every(v => typeof v === 'string' && uuid.test(v)) ||
            !['codex', 'claude'].includes(b.provider)) return sendJson(res, 400, { error: 'invalid_binding' });
        const key = [b.workspace, b.agentId, b.provider, b.id].join('/');
        if (!bindings.has(key)) {
          if (bindings.size >= 8192) {
            const oldest = bindings.keys().next().value!;
            const evicted = bindings.get(oldest)!;
            bindings.delete(oldest);
            streams.get(evicted.workspace)?.refreshBindings();
          }
          bindings.set(key, { workspace: b.workspace, value: { agentId: b.agentId, provider: b.provider, id: b.id } });
          streams.get(b.workspace)?.refreshBindings();
        }
        sendJson(res, 200, { ok: true });
      }).catch(() => { if (!res.destroyed) sendJson(res, 400, { error: 'invalid_binding' }); });
      return;
    }
    if (path === '/api/multica/workspaces') {
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      void readCredentials().then(auth => listWorkspaces(auth, controller.signal)).then(
        workspaces => { if (!res.destroyed) sendJson(res, 200, { workspaces }); },
        err => {
          const code = err instanceof MulticaError ? err.code : 'upstream';
          if (!res.destroyed) sendJson(res, ['credentials', 'access'].includes(code) ? 403 : 502, { error: code });
        },
      );
      return;
    }
    const match = /^\/api\/multica\/workspaces\/([^/]+)\/events$/.exec(path);
    if (!match || !workspaceId.test(match[1])) return sendJson(res, 404, { error: 'unknown_workspace_route' });
    const id = match[1];
    const stream = streams.get(id) ?? new WorkspaceStream(id, () => [...bindings.values()].filter(b => b.workspace === id).map(b => b.value));
    const start = !streams.has(id);
    streams.set(id, stream);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Cross-Origin-Resource-Policy': 'same-origin' });
    const unsubscribe = stream.subscribe(frame => {
      if (res.destroyed) return;
      if (res.writableLength > 4 * 1024 * 1024) res.destroy();
      else res.write('data: ' + JSON.stringify(frame) + '\n\n');
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    res.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (stream.empty) { stream.close(); streams.delete(id); }
    });
    if (start) void stream.run();
  };
  return { handle, close() {
    for (const stream of streams.values()) stream.close();
    for (const res of clients) res.destroy();
  } };
}
