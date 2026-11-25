import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../../http/app';
import { listWorkspaces, MulticaError, readCredentials } from './client';
import { WorkspaceStream } from './stream';

const workspaceId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function multicaRoutes() {
  const streams = new Map<string, WorkspaceStream>();
  const clients = new Set<ServerResponse>();
  const handle = (_req: IncomingMessage, res: ServerResponse, path: string) => {
    clients.add(res);
    res.once('close', () => clients.delete(res));
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
    const stream = streams.get(id) ?? new WorkspaceStream(id);
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
