import { describe, expect, it } from 'vitest';
import type { WorkspaceFacts } from '../../../shared/multica';
import type { AgentInfo, OfficeSnapshot, Provider } from '../../../shared/types';
import { agentKey, defaults, handoffs, issueUrl, projectOffice, roomKey } from './multica-model';

const f: WorkspaceFacts = { workspace: { id: 'w', name: 'Example', slug: 'example' }, viewerId: 'viewer',
  webOrigin: 'https://example.invalid', projects: [{ id: 'p', name: 'Demo' }], agents: [{ id: 'a', name: 'Worker' }],
  issues: [{ id: 'i', identifier: 'DEMO-1', title: 'Example', projectId: 'p', assigneeId: 'a', assigneeType: 'agent', category: '', label: '', status: 'in_progress' }],
  runs: [{ id: 'run', agentId: 'a', issueId: 'i', status: 'running', nativeSession: null }] };
const localAgent = (id: string, provider: Provider): AgentInfo => ({ id, provider, sessionId: id, account: provider, kind: 'main', roomId: 'worktree',
  role: 'Agent', name: id, status: 'working', recent: [], tasks: [], startedAt: 1, lastEventAt: 1, statusSince: 1,
  stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, look: 'm', seed: 1 });
const base: OfficeSnapshot = { rev: 1, serverTime: 1, accounts: [], agents: [],
  meta: { version: 'test', sources: [], startedAt: 1, demo: false }, rooms: [{ id: 'worktree', path: 'worktree', name: 'Local', createdAt: 1, slot: 0, seed: 0 }] };
describe('mixed office', () => {
  it.each(['codex','claude'] as const)('merges a verified %s session and leaves its manual neighbor visible', provider => {
    const local = { ...base, agents: [localAgent('managed',provider), localAgent('manual',provider)] };
    const facts = { ...f, bindings: [{ provider, agentId:'a',id:'managed' }] };
    const v = projectOffice(local,[facts],defaults,null);
    expect(v.snapshot.agents.map(a=>a.id)).toEqual(['manual',agentKey(f,'a')]);
    expect(v.aliases.get('managed')).toBe(agentKey(f,'a'));
    expect(projectOffice(local,[],defaults,v.snapshot).snapshot.agents).toEqual(local.agents);
    const other = {...facts, workspace:{...f.workspace,id:'another'}};
    expect(projectOffice(local,[facts,other],defaults,null).aliases.size).toBe(0);
    expect(projectOffice(local,[{...facts,bindings:[],runs:[{...f.runs[0],nativeSession:{provider,id:'managed'}}]}],defaults,null).aliases.get('managed')).toBe(agentKey(f,'a'));
  });
  it('keeps each original permission request reachable when both local sources are hidden', () => {
    const agent = localAgent('managed','codex');
    const permission = { id:'original',provider:'codex' } as AgentInfo['permission'];
    agent.permission = permission;
    const manual = {...localAgent('manual','claude'),permission:{...permission!,id:'other'}};
    const v = projectOffice({...base,agents:[agent,manual]},[{...f,bindings:[{provider:'codex',agentId:'a',id:'managed'}]}],{...defaults,codex:false,claude:false},null);
    expect(v.details.get(agentKey(f,'a'))?.permissions).toEqual([agent]);
    expect(v.snapshot.agents.find(a=>a.id===agentKey(f,'a'))?.permission).toBe(permission);
    expect(v.snapshot.agents.find(a=>a.id==='manual')).toBe(manual);
  });
  it('keeps one NPC for concurrent runs and a stable identity when idle', () => {
    const live = projectOffice(base,[{...f,runs:[...f.runs,{...f.runs[0],id:'other'}]}],defaults,null);
    const idle = projectOffice(base,[{...f,runs:[]}],defaults,live.snapshot);
    expect(live.snapshot.agents).toHaveLength(1);
    expect(live.snapshot.agents[0].roomId).toBe(roomKey(f,'p'));
    expect(live.details.get(agentKey(f,'a'))?.runs).toHaveLength(2);
    expect(idle.snapshot.agents[0]).toMatchObject({id:live.snapshot.agents[0].id,seed:live.snapshot.agents[0].seed,roomId:roomKey(f,''),status:'idle'});
  });
});
it('alerts once on human handoff, silences baseline, reconnect, routine completions and other people', () => {
  const assigned={...f,issues:[{...f.issues[0],assigneeId:'viewer',assigneeType:'member',status:'in_review'}]};
  expect(handoffs(f,assigned)).toEqual(assigned.issues);
  expect(handoffs(undefined,assigned)).toEqual([]);
  expect(handoffs(assigned,assigned)).toEqual([]);
  expect(handoffs(f,{...assigned,viewerId:'someone'})).toEqual([]);
  expect(handoffs(f,{...assigned,issues:[{...assigned.issues[0],status:'done'}]})).toEqual([]);
  expect(issueUrl(assigned,assigned.issues[0])).toBe('https://example.invalid/example/issues/i');
});
