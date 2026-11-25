import type { UiContext } from './context';
import { h } from './dom';
import { tr } from '../../../shared/i18n';
import { issueUrl, needsViewer, roomKey } from '../net/multica-model';

/** Reach an office or any outstanding human-owned issue, including one with no associated agent. */
export class OfficeNavigation {
  readonly button = h('button', { class: 'ui-btn', type: 'button' });
  readonly panel = h('div', { class: 'ui-popover ui-settings', attrs: { popover: 'auto', 'aria-label': 'Multica' } });
  private key = '';
  constructor(private ctx: UiContext) {
    this.button.onclick = () => {
      const rect = this.button.getBoundingClientRect();
      this.panel.style.top = (rect.bottom + 8) + 'px';
      this.panel.style.left = Math.max(8, Math.min(rect.left, innerWidth - 320)) + 'px';
      this.panel.togglePopover();
    };
  }
  render() {
    const source = this.ctx.store.multica;
    this.button.hidden = !source.enabled || !source.prefs.workspaces.length || this.ctx.store.replaying;
    if (this.button.hidden && this.panel.matches?.(':popover-open')) this.panel.hidePopover();
    const nodes: HTMLElement[] = [];
    let waiting = 0;
    const rows = source.list.filter(w => source.prefs.workspaces.includes(w.id)).map(w => {
      const frame = source.frames.get(w.id);
      const facts = frame?.state === 'live' ? frame.facts : undefined;
      const issues = facts?.issues.filter(i => needsViewer(facts, i)) ?? [];
      waiting += issues.length;
      return { w, facts, state: frame?.state, issues };
    });
    const stale = rows.some(r => r.state === 'stale' || r.state === 'unavailable') || source.state === 'error';
    const sig = JSON.stringify(rows.map(r => [r.w, r.state, r.issues.map(i => [i.id, i.title]), r.facts?.webOrigin, r.facts?.workspace.slug])) + stale;
    if (sig === this.key) return;
    this.key = sig;
    this.button.textContent = 'Multica' + (waiting ? ' · ' + waiting : '') + (stale ? ' ⚠' : '');
    this.button.title = tr('Espaços e decisões pendentes');
    if (source.prefs.workspaces.length) nodes.push(h('button', { class: 'ui-btn', type: 'button', text: tr('Todos os espaços'), on: { click: () => {
      this.ctx.store.showOffice(null); this.ctx.select(null); this.ctx.camera('overview'); this.panel.hidePopover();
    } } }));
    if (source.state === 'error') nodes.push(h('p', { text: tr('Verifique o login do Multica e tente novamente.') }));
    for (const { w, facts, state, issues } of rows) {
      const btn = h('button', { type: 'button', class: 'ui-btn', text: w.name });
      btn.disabled = !facts;
      btn.onclick = () => {
        if (!facts) return;
        this.panel.hidePopover();
        this.ctx.store.showOffice(w.id);
        this.ctx.select({ type: 'room', id: roomKey(facts, '') }, { focus: true });
      };
      const group = h('section', { class: 'ui-set-group' }, btn);
      if (!facts) group.append(h('p', { text: state === 'connecting' ? tr('Conectando…') : tr('Acesso indisponível') }));
      for (const issue of issues) {
        const url = issueUrl(facts!, issue);
        group.append(url ? h('a', { class: 'ui-set', text: issue.title, attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } }) : h('span', { text: issue.title }));
      }
      nodes.push(group);
    }
    this.panel.replaceChildren(...nodes);
  }
}
