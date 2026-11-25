import type { MulticaIssue, WorkspaceFacts } from '../../../shared/multica';
import type { AgentInfo, OfficeSnapshot, Provider, RoomInfo } from '../../../shared/types';
import { hash32 } from '../../../shared/hash';
import { tr } from '../../../shared/i18n';

export const activeRun = (status: string) => ['running', 'queued', 'pending', 'in_progress', 'assigned'].includes(status);
const finished = (issue: MulticaIssue) => [issue.category, issue.status].some(s => ['done', 'completed', 'canceled', 'cancelled'].includes(s));
export const needsViewer = (f: WorkspaceFacts, i: MulticaIssue) => !!f.viewerId && f.viewerId === i.assigneeId &&
  ['member', 'user', 'human'].includes(i.assigneeType) && !finished(i);
export const inReview = (i: MulticaIssue) => [i.category, i.status].includes('in_review');
export function handoffs(prev: WorkspaceFacts | undefined, next: WorkspaceFacts) {
  if (!prev || prev.viewerId !== next.viewerId || prev.workspace.id !== next.workspace.id) return [];
  const before = new Map(prev.issues.map(i => [i.id, i]));
  return next.issues.filter(i => {
    const old = before.get(i.id);
    return needsViewer(next, i) && (!old || !needsViewer(prev, old) || (inReview(i) && !inReview(old)));
  });
}
export function issueUrl(f: WorkspaceFacts, i: MulticaIssue) {
  if (!f.webOrigin || !f.workspace.slug) return undefined;
  const url = new URL(f.webOrigin);
  if (!['http:', 'https:'].includes(url.protocol)) return undefined;
  return url.origin + '/' + encodeURIComponent(f.workspace.slug) + '/issues/' + encodeURIComponent(i.id);
}
const prefix = (f: WorkspaceFacts) => 'multica:' + f.workspace.id + ':';
export const agentKey = (f: WorkspaceFacts, id: string) => prefix(f) + 'agent:' + id;
export const roomKey = (f: WorkspaceFacts, id: string) => prefix(f) + 'room:' + id;
export interface ManagedDetail {
  facts: WorkspaceFacts;
  issues: MulticaIssue[];
  runs: WorkspaceFacts['runs'];
  permissions: AgentInfo[];
  name: string;
}
export interface SelectionPrefs { codex: boolean; claude: boolean; workspaces: string[] }
export const defaults: SelectionPrefs = { codex: true, claude: true, workspaces: [] };

export function projectOffice(local: OfficeSnapshot, spaces: WorkspaceFacts[], prefs: SelectionPrefs, prior: OfficeSnapshot | null) {
  const aliases = new Map<string, string>();
  const details = new Map<string, ManagedDetail>();
  const owners = new Map<string, Set<string>>();
  for (const f of spaces) {
    const known = new Set(f.agents.map(a => a.id));
    const bind = (agentId: string, provider: string, id: string) => {
      if (!id || !known.has(agentId)) return;
      const key = provider + ':' + id;
      const candidates = owners.get(key) ?? new Set<string>();
      candidates.add(agentKey(f, agentId));
      owners.set(key, candidates);
    };
    for (const r of f.runs) if (r.nativeSession) bind(r.agentId, r.nativeSession.provider, r.nativeSession.id);
    for (const b of f.bindings ?? []) bind(b.agentId, b.provider, b.id);
  }
  const permissions = new Map<string, AgentInfo[]>();
  const agents = local.agents.filter(a => {
    const provider: Provider = a.provider ?? 'claude';
    const candidates = owners.get(provider + ':' + a.sessionId);
    if (a.kind === 'main' && candidates?.size === 1) {
      const owner = [...candidates][0];
      aliases.set(a.id, owner);
      if (a.permission) permissions.set(owner, [...permissions.get(owner) ?? [], a]);
      return false;
    }
    return prefs[provider] || !!a.permission;
  });
  for (const [index, agent] of agents.entries()) {
    const owner = agent.parentId && aliases.get(agent.parentId);
    if (owner) agents[index] = { ...agent, parentId: owner };
  }
  const occupied = new Set(agents.map(a => a.roomId));
  const rooms = local.rooms.filter(r => occupied.has(r.id) || (prefs.claude && prefs.codex && !local.agents.some(a => a.roomId === r.id)));
  let slot = Math.max(-1, ...rooms.map(r => r.slot)) + 1;
  const previous = new Map(prior?.agents.map(a => [a.id, a]));
  for (const f of spaces) {
    const items = new Map(f.issues.map(i => [i.id, i]));
    const projects = new Set(f.projects.map(p => p.id));
    const projectId = (i?: MulticaIssue) => i && projects.has(i.projectId) ? i.projectId : '';
    for (const p of [...f.projects, { id: '', name: tr('Área comum') }]) {
      const id = roomKey(f, p.id);
      const room: RoomInfo = { id, name: f.workspace.name + ' · ' + p.name, path: f.workspace.name, seed: hash32(id), slot: slot++, createdAt: local.meta.startedAt };
      rooms.push(room);
      const issues = f.issues.filter(i => projectId(i) === p.id);
      const issueIds = new Set(issues.map(i => i.id));
      details.set(id, { facts: f, name: room.name, issues, runs: f.runs.filter(r => issueIds.has(r.issueId)), permissions: [] });
    }
    const responsible = new Map<string, Set<string>>();
    for (const run of f.runs) {
      const owners = responsible.get(run.issueId) ?? new Set<string>();
      owners.add(run.agentId); responsible.set(run.issueId, owners);
    }
    for (const a of f.agents) {
      const id = agentKey(f, a.id);
      const old = previous.get(id);
      const runs = f.runs.filter(r => r.agentId === a.id);
      const linked = new Set(runs.map(r => r.issueId));
      const issues = f.issues.filter(i => linked.has(i.id) || (i.assigneeType === 'agent' && i.assigneeId === a.id && !finished(i)));
      const active = runs.filter(r => activeRun(r.status));
      const waiting = issues.filter(i => needsViewer(f, i) && responsible.get(i.id)?.size === 1);
      const roomsInUse = [...new Set((active.length ? active.map(r => items.get(r.issueId)) : waiting).map(i => roomKey(f, projectId(i))))].sort();
      const roomId = old && roomsInUse.includes(old.roomId) ? old.roomId : roomsInUse[0] ?? roomKey(f, '');
      const pending = permissions.get(id) ?? [];
      const status = pending.length || waiting.length ? 'waiting' : active.length ? 'working' : 'idle';
      const seed = hash32(id);
      agents.push({ id, account: 'Multica', sessionId: '', roomId, name: a.name, role: 'Multica', kind: 'main',
        look: seed % 2 ? 'f' : 'm', seed, status, startedAt: local.meta.startedAt, lastEventAt: old?.status === status ? old.lastEventAt : local.serverTime,
        statusSince: old?.status === status ? old.statusSince : local.serverTime, recent: [], tasks: [],
        permission: pending[0]?.permission, waitingFor: pending[0]?.waitingFor ?? (waiting.length ? tr('Sua revisão') : undefined),
        stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 } });
      details.set(id, { facts: f, name: a.name, issues, runs, permissions: pending });
    }
  }
  return { snapshot: { ...local, rooms, agents }, aliases, details };
}
