import { MulticaSources } from './multica';
import { defaults, projectOffice, needsViewer, inReview, issueUrl, type ManagedDetail } from './multica-model';
import { access } from './access';
import type { AgentInfo, OfficeSnapshot, Notice } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { OfficeStore } from './store';

export class LocalOffice extends OfficeStore {
  readonly multica = new MulticaSources(() => this.redrawOffice(), (facts, issue) => {
    const review = { workspace: facts.workspace.id, issue: issue.id };
    this.emit('notice', { id: ['multica', review.workspace, review.issue, issue.updatedAt, issue.status].join(':'),
      level: 'alert', text: inReview(issue) ? tr('Sua revisão: {0}', [issue.title]) : tr('Atribuído a você: {0}', [issue.title]), review, at: Date.now() });
  });
  office: string | null = null;
  private complete: OfficeSnapshot | null = null;
  showOffice(id: string | null) {
    this.office = id;
    this.redrawOffice();
  }
  reveal(id: string) {
    if (this.office && !this.agentOnMap(id) && !this.room(id)) this.showOffice(null);
  }
  private agentOnMap(id: string) { return super.agent(id); }
  override agent(id: string): AgentInfo | undefined {
    return super.agent(id) ?? (!this.replaying && this.office ? this.complete?.agents.find(a => a.id === this.visibleAgent(id)) : undefined);
  }
  private aliases = new Map<string, string>();
  managed = new Map<string, ManagedDetail>();
  override visibleAgent(id: string) { return this.replaying ? id : this.aliases.get(id) ?? id; }
  reviewTarget(review: NonNullable<Notice['review']>) {
    const facts = this.multica.live.find(f => f.workspace.id === review.workspace);
    const issue = facts?.issues.find(i => i.id === review.issue);
    return facts && issue && needsViewer(facts, issue) ? issueUrl(facts, issue) : undefined;
  }
  override disconnect() { this.multica.enable(false); super.disconnect(); }
  protected override redrawOffice() {
    if (!this.local || this.replaying) return;
    this.multica.enable(!this.mock && !this.local.meta.demo && access().local && !access().remote);
    if (!this.multica.live.length && (!this.multica.enabled || (this.multica.prefs.claude && this.multica.prefs.codex))) {
      this.office = null; this.complete = null; this.aliases.clear(); this.managed.clear(); this.setSnapshot(this.local); return;
    }
    const result = projectOffice(this.local, this.multica.live, this.multica.enabled ? this.multica.prefs : defaults, this.complete ?? this.snapshot);
    this.managed = result.details;
    this.aliases = result.aliases;
    this.complete = result.snapshot;
    if (this.office && !this.multica.live.some(f => f.workspace.id === this.office)) this.office = null;
    if (!this.office) return this.setSnapshot(result.snapshot);
    const visible = (id: string) => result.details.get(id)?.facts.workspace.id === this.office;
    this.setSnapshot({ ...result.snapshot, agents: result.snapshot.agents.filter(a => visible(a.roomId)),
      rooms: result.snapshot.rooms.filter(r => visible(r.id)) });
  }

}
