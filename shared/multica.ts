import type { Provider } from './types';

export interface WorkspaceRef { id: string; name: string; slug?: string }
export interface MulticaIssue {
  id: string; title: string; identifier: string; projectId: string;
  assigneeId: string; assigneeType: string; status: string; category: string; label: string; updatedAt?: string;
}
export interface SessionBinding { agentId: string; provider: Provider; id: string }
export interface WorkspaceFacts {
  workspace: WorkspaceRef;
  viewerId?: string;
  webOrigin?: string;
  projects: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  issues: MulticaIssue[];
  runs: { id: string; agentId: string; issueId: string; status: string; nativeSession: { provider: string; id: string } | null }[];
  bindings?: SessionBinding[];
}
export type MulticaFrame = { state: 'live'; facts: WorkspaceFacts } | { state: 'connecting' | 'stale' | 'unavailable'; reason?: string };
export interface WorkspaceEvent { workspaceId: string; frame: MulticaFrame }
export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
