// Only facts needed by the office cross the local API boundary.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isLoopbackBind } from '../../config';

export interface Credentials { origin: string; token: string }
export class MulticaError extends Error {
  constructor(readonly code: 'credentials' | 'access' | 'upstream' | 'protocol') { super(code); }
}

export async function readCredentials(file = process.env.MULTICA_CONFIG || join(homedir(), '.multica', 'config.json')): Promise<Credentials> {
  try {
    const { server_url, token } = JSON.parse(await readFile(file, 'utf8'));
    const url = new URL(server_url);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackBind(url.hostname))) ||
        typeof token !== 'string' || !token.trim()) throw new Error();
    return { origin: url.origin, token };
  } catch { throw new MulticaError('credentials'); }
}

type Row = Record<string, unknown>;
function object(v: unknown): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new MulticaError('protocol');
  return v as Row;
}
function rows(data: unknown, field: string): Row[] {
  const list = Array.isArray(data) ? data : object(data)[field];
  if (!Array.isArray(list)) throw new MulticaError('protocol');
  return list.map(object);
}
const string = (v: unknown) => typeof v === 'string' ? v : '';
function id(row: Row) {
  if (!string(row.id)) throw new MulticaError('protocol');
  return string(row.id);
}

async function get(auth: Credentials, path: string, signal: AbortSignal, workspace?: string): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + auth.token };
  if (workspace) headers['X-Workspace-ID'] = workspace;
  const res = await fetch(auth.origin + path, {
    headers, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (res.status === 401 || res.status === 403) throw new MulticaError('access');
  if (!res.ok) throw new MulticaError('upstream');
  return res.json();
}

export async function listWorkspaces(auth: Credentials, signal: AbortSignal) {
  return rows(await get(auth, '/api/workspaces', signal), 'workspaces').map(w => ({ id: id(w), name: string(w.name) }));
}

async function pages(auth: Credentials, workspace: string, resource: 'issues' | 'projects', signal: AbortSignal) {
  const seen = new Map<string, Row>();
  let total: number | undefined;
  for (let page = 0; page < 1000; page++) {
    const data = object(await get(auth, '/api/' + resource + '?limit=100&offset=' + seen.size, signal, workspace));
    const batch = rows(data, resource);
    if (typeof data.total === 'number' && Number.isSafeInteger(data.total) && data.total >= 0) {
      if (total !== undefined && data.total !== total) throw new MulticaError('upstream');
      total = data.total;
    } else if (typeof data.has_more !== 'boolean') throw new MulticaError('protocol');
    for (const row of batch) {
      const key = id(row);
      if (seen.has(key)) throw new MulticaError('upstream'); // Changed while paging. Retry the whole read.
      seen.set(key, row);
    }
    const more = typeof data.has_more === 'boolean' ? data.has_more : seen.size < total!;
    if (!more) {
      if (total !== undefined && seen.size !== total) break;
      return [...seen.values()];
    }
    if (!batch.length || (total !== undefined && seen.size > total)) break;
  }
  throw new MulticaError('upstream');
}

export async function readWorkspace(auth: Credentials, workspaceId: string, signal: AbortSignal) {
  const workspace = (await listWorkspaces(auth, signal)).find(w => w.id === workspaceId);
  if (!workspace) throw new MulticaError('access');
  const list = async (path: string, field: string) => rows(await get(auth, path, signal, workspaceId), field);
  const [projects, issues, agents, runs, runtimes] = await Promise.all([
    pages(auth, workspaceId, 'projects', signal), pages(auth, workspaceId, 'issues', signal),
    list('/api/agents', 'agents'), list('/api/agent-task-snapshot', 'tasks'), list('/api/runtimes', 'runtimes'),
  ]);
  for (const group of [projects, issues, agents, runs, runtimes]) {
    if (group.some(r => r.workspace_id && r.workspace_id !== workspaceId)) throw new MulticaError('protocol');
  }
  const providers = new Map(runtimes.map(r => [id(r), string(r.provider)]));
  return {
    workspace,
    projects: projects.map(p => ({ id: id(p), name: string(p.title) })),
    agents: agents.filter(a => !a.archived_at).map(a => ({ id: id(a), name: string(a.name) })),
    issues: issues.map(i => ({
      id: id(i), title: string(i.title), identifier: string(i.identifier), projectId: string(i.project_id),
      assigneeId: string(i.assignee_id), assigneeType: string(i.assignee_type),
      status: string(i.status), category: string(i.status_category), label: string(i.status_name),
    })),
    runs: runs.map(r => {
      const provider = providers.get(string(r.runtime_id));
      const nativeId = r.result && typeof r.result === 'object' ? string((r.result as Row).session_id) : '';
      return { id: id(r), agentId: string(r.agent_id), issueId: string(r.issue_id), status: string(r.status),
        nativeSession: nativeId && (provider === 'codex' || provider === 'claude') ? { provider, id: nativeId } : null };
    }),
  };
}
export type WorkspaceFacts = Awaited<ReturnType<typeof readWorkspace>>;
