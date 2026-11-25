import type { IncomingMessage, ServerResponse } from 'node:http';
import { uuid, type MulticaFrame, type SessionBinding, type WorkspaceEvent } from '../../../shared/multica';
import { readJson, sendJson } from '../../http/app';
import { listWorkspaces, MulticaError, readCredentials } from './client';
import { WorkspaceStream } from './stream';

// Allow EventSource replacement after a workspace selection change to reuse the upstream socket.
const releaseDelay = 2000;

export function multicaRoutes() {
  const streams = new Map<string, WorkspaceStream>();
  const bindings = new Map<string, { workspace: string; value: SessionBinding }>();
  const clients = new Set<ServerResponse>();
  const releases = new Map<string, NodeJS.Timeout>();
  const handle = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const path = url.pathname;
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
    const combined = path === '/api/multica/events';
    if (!combined && !match) return sendJson(res, 404, { error: 'unknown_workspace_route' });
    const ids = [...new Set(combined ? url.searchParams.getAll('workspace') : [match![1]])];
    if (!ids.length || ids.some(id => !uuid.test(id))) {
      return sendJson(res, combined ? 400 : 404, { error: 'invalid_workspace' });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Cross-Origin-Resource-Policy': 'same-origin' });

    // If the browser falls behind, keep only the most recent full frame for each workspace.
    const pending = new Map<string, MulticaFrame>();
    let writable = true;
    const write = (id: string, frame: MulticaFrame) => {
      const payload: WorkspaceEvent | MulticaFrame = combined ? { workspaceId: id, frame } : frame;
      writable = res.write('data: ' + JSON.stringify(payload) + '\n\n');
    };
    res.on('drain', () => {
      writable = true;
      for (const [id, frame] of pending) {
        pending.delete(id);
        write(id, frame);
        if (!writable) break;
      }
    });
    const detach = ids.map(id => {
      clearTimeout(releases.get(id));
      releases.delete(id);
      const current = streams.get(id);
      const stream = current ?? new WorkspaceStream(id, () => [...bindings.values()].filter(b => b.workspace === id).map(b => b.value));
      streams.set(id, stream);
      const unsubscribe = stream.subscribe(frame => {
        if (res.destroyed) return;
        if (writable) write(id, frame);
        else pending.set(id, frame);
      });
      if (!current) void stream.run();
      return () => {
        unsubscribe();
        if (stream.empty && streams.get(id) === stream) {
          releases.set(id, setTimeout(() => {
            releases.delete(id);
            stream.close();
            streams.delete(id);
          }, releaseDelay));
        }
      };
    });
    const heartbeat = setInterval(() => { if (writable) writable = res.write(': ping\n\n'); }, 15_000);
    res.once('close', () => {
      clearInterval(heartbeat);
      for (const unsubscribe of detach) unsubscribe();
    });
  };
  return { handle, close() {
    for (const stream of streams.values()) stream.close();
    streams.clear();
    for (const timer of releases.values()) clearTimeout(timer);
    releases.clear();
    for (const res of clients) res.destroy();
  } };
}
