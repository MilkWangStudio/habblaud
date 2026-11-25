import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorkspace } from './client';

const auth = { origin: 'https://multica.invalid', token: 'test-secret' };
const scope = 'test-workspace';
function upstream(change: Record<string, unknown> = {}) {
  const replies: Record<string, unknown> = {
    '/api/me': { id: 'viewer' },
    '/api/workspaces': [{ id: scope, name: 'Office' }],
    '/api/projects?limit=100&offset=0': { projects: [{ id: 'p', title: 'Project' }], total: 1 },
    '/api/issues?limit=100&offset=0': { issues: [{ id: 'i', description: 'private-text' }], total: 2 },
    '/api/issues?limit=100&offset=1': { issues: [{ id: 'j' }], total: 2 },
    '/api/agents': [{ id: 'a' }, { id: 'archived', archived_at: 'yesterday' }],
    '/api/runtimes': [{ id: 'runner', provider: 'claude' }],
    '/api/agent-task-snapshot': [{ id: 'run', runtime_id: 'runner', result: { session_id: 'native', output: 'private-text' } },
      { id: 'active', runtime_id: 'runner', status: 'running' }],
    ...change,
  };
  vi.stubGlobal('fetch', async (url: string, opts: RequestInit) => {
    const path = url.slice(auth.origin.length);
    expect(opts.redirect).toBe('error');
    expect(opts.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
    if (!['/api/me', '/api/workspaces'].includes(path)) expect(opts.headers).toMatchObject({ 'X-Workspace-ID': scope });
    return Response.json(replies[path]);
  });
}
afterEach(() => vi.unstubAllGlobals());
describe('workspace facts', () => {
  it('reads every page and exposes scoped identity only when the provider and result agree', async () => {
    upstream();
    const facts = await readWorkspace(auth, scope, new AbortController().signal);
    expect(facts.issues.map(i => i.id)).toEqual(['i', 'j']);
    expect(facts.agents.map(a => a.id)).toEqual(['a']);
    expect(facts.runs.map(r => r.nativeSession)).toEqual([{ provider: 'claude', id: 'native' }, null]);
    expect(JSON.stringify(facts)).not.toMatch(/private-text|test-secret/);
  });
  it.each([
    [{ '/api/workspaces': [] }, 'access'],
    [{ '/api/runtimes': [{ id: 'runner', workspace_id: 'other' }] }, 'protocol'],
    [{ '/api/issues?limit=100&offset=1': { issues: [{ id: 'i' }], total: 2 } }, 'upstream'],
    [{ '/api/issues?limit=100&offset=0': { issues: [], total: 2, has_more: false } }, 'upstream'],
  ] as const)('rejects incomplete or out-of-scope reads', async (patch, code) => {
    upstream(patch);
    await expect(readWorkspace(auth, scope, new AbortController().signal)).rejects.toMatchObject({ code });
  });
});
