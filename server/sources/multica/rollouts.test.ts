import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { tempDir } from '../../test/fixtures';
import { codexBindings } from './rollouts';

it('reads native identity only in the selected managed agent and issue path', async () => {
  const t = tempDir();
  const agentId = '11111111-1111-4111-8111-111111111111';
  const issueId = '22222222-2222-4222-8222-222222222222';
  const native = '33333333-3333-4333-8333-333333333333';
  try {
    for (const kind of ['p_abc', 'sessions']) {
      const dir = join(t.dir, kind, agentId, issueId, '2025','01','01');
      mkdirSync(dir, { recursive:true });
      writeFileSync(join(dir,'rollout-2025-01-01T12-00-00-'+native+'.jsonl'),'');
    }
    expect(await codexBindings(t.dir,[{agentId,issueId}])).toEqual([{agentId,provider:'codex',id:native}]);
    expect(await codexBindings(t.dir,[{agentId,issueId:agentId},{agentId:'../other',issueId}])).toEqual([]);
  } finally { t.cleanup(); }
});
