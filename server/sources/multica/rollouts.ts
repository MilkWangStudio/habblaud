// Multica's Codex runner can use app-server without loading user hooks.
// Read names only inside the managed agent/issue directory for a currently active run.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { uuid, type SessionBinding } from '../../../shared/multica';

export async function codexBindings(root: string, runs: { agentId: string; issueId: string }[]): Promise<SessionBinding[]> {
  if (!runs.length) return [];
  const result: SessionBinding[] = [];
  const dirs = async (path: string) => (await readdir(path, { withFileTypes: true }).catch(() => []));
  for (const profile of await dirs(root)) {
    if (!profile.isDirectory() || !/^p_[a-f0-9]+$/.test(profile.name)) continue;
    for (const r of runs) {
      if (!uuid.test(r.agentId) || !uuid.test(r.issueId)) continue;
      const base = join(root, profile.name, r.agentId, r.issueId);
      const visit = async (dir: string, depth: number) => {
        for (const e of await dirs(dir)) {
          if (depth < 3 && e.isDirectory() && (depth === 0 ? /^\d{4}$/ : /^\d{2}$/).test(e.name)) {
            await visit(join(dir, e.name), depth + 1);
          } else if (depth === 3 && e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
            const id = e.name.slice(-42, -6);
            if (uuid.test(id)) result.push({ agentId: r.agentId, provider: 'codex', id });
          }
        }
      };
      await visit(base, 0);
    }
  }
  return result;
}
