import { tr } from '../../../shared/i18n';
import { issueUrl, needsViewer, type ManagedDetail } from '../net/multica-model';
import type { UiContext } from './context';
import { h } from './dom';
import { PermissionCard } from './permission';

export class SourceSettings {
  readonly el = h('section', { class: 'ui-set-group' });
  private key = '';
  constructor(private ctx: UiContext) {}
  render() {
    const source = this.ctx.store.multica;
    this.el.hidden = !source.enabled;
    if (!source.enabled) return;
    const sig = JSON.stringify([source.state, source.list, source.prefs, [...source.frames].map(([id, f]) => [id, f.state])]);
    if (sig === this.key) return;
    this.key = sig;
    const label = (text: string, checked: boolean, change: (v: boolean) => void) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = checked; box.onchange = () => change(box.checked);
      return h('label', { class: 'ui-set' }, h('span', { class: 'ui-set__label', text }), box);
    };
    const content: HTMLElement[] = [h('h3', { text: tr('Fontes do escritório') })];
    for (const provider of ['codex', 'claude'] as const) content.push(label(provider === 'codex' ? 'Codex' : 'Claude Code', source.prefs[provider],
      v => source.set({ ...source.prefs, [provider]: v })));
    for (const w of source.list) {
      const frame = source.frames.get(w.id);
      const state = frame?.state === 'stale' ? tr('Desconectado') : frame?.state === 'unavailable' ? tr('Acesso indisponível') : frame?.state === 'connecting' ? tr('Conectando…') : '';
      content.push(label('Multica · ' + w.name + (state ? ' · ' + state : ''), source.prefs.workspaces.includes(w.id), v => {
        const ids = source.prefs.workspaces.filter(id => id !== w.id);
        source.set({ ...source.prefs, workspaces: v ? [...ids, w.id] : ids });
      }));
    }
    const refresh = h('button', { type: 'button', class: 'ui-btn', text: tr('Buscar espaços do Multica'), on: { click: () => void source.discover() } });
    refresh.disabled = source.state === 'loading';
    content.push(refresh);
    if (source.state === 'error') content.push(h('p', { class: 'ui-set__hint', text: tr('Verifique o login do Multica e tente novamente.') }));
    this.el.replaceChildren(...content);
  }
}

export class ManagedDrawer {
  readonly el = h('section', { class: 'ui-sec' });
  private summary = h('div');
  private cards = new Map<string, PermissionCard>();
  private key = '';
  constructor(private ctx: UiContext) { this.el.append(this.summary); }
  render(detail: ManagedDetail | undefined) {
    if (!detail) { this.summary.replaceChildren(); this.key = ''; }
    const key = detail && JSON.stringify([detail.name, detail.issues, detail.runs, detail.facts.viewerId, detail.facts.webOrigin, detail.facts.workspace.slug]);
    if (detail && key && key !== this.key) {
      this.key = key;
      const nodes: HTMLElement[] = [h('h2', { text: detail.name })];
      const issues = [...detail.issues].sort((a,b) => Number(needsViewer(detail.facts,b)) - Number(needsViewer(detail.facts,a)));
      if (!issues.length && !detail.runs.length) nodes.push(h('p', { text: tr('Sem tarefas neste espaço.') }));
      for (const issue of issues) {
        const url = issueUrl(detail.facts, issue);
        const title = [issue.identifier, issue.title].filter(Boolean).join(' · ');
        const link = url ? h('a', { text: title, attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } }) : h('span', { text: title });
        const runs = detail.runs.filter(r => r.issueId === issue.id);
        nodes.push(h('section', { class: 'ui-sec' }, link, h('div', { class: 'ui-set__hint',
          text: [needsViewer(detail.facts, issue) ? tr('Atribuído a você') : '', issue.label || issue.status, ...runs.map(r => r.status)].filter(Boolean).join(' · ') })));
      }
      for (const r of detail.runs) if (!issues.some(i => i.id === r.issueId)) nodes.push(h('p', { text: r.status }));
      this.summary.replaceChildren(...nodes);
    }
    const pending = detail?.permissions ?? [];
    for (const [id, card] of this.cards) if (!pending.some(a => a.id === id)) { card.render(undefined); card.dispose(); this.cards.delete(id); }
    for (const agent of pending) {
      let card = this.cards.get(agent.id);
      if (!card) { card = new PermissionCard(this.ctx); this.cards.set(agent.id, card); this.el.prepend(card.el); }
      card.render(agent);
    }
  }
}
