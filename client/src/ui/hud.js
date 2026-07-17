// hud.js — HTML overlay HUD. Reads sim state (never mutates it) and renders
// health / Aether / Sigil charges / statuses / round timer / cast tells.
// Statuses use text + icon, never color alone (accessibility, MASTERPLAN §4).

import { MATCH, AETHER, SIGIL } from '@shared/sim/constants.js';
import { SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';

const STATUS_ICON = {
  Burning: '🔥', Chilled: '❄', Soaked: '💧', Static: '⚡', Sundered: '🪓',
  Weakened: '▽', Marked: '◎', Rooted: '🌿', Frozen: '🧊', Stunned: '★',
};

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = {
      enemyHealth: root.querySelector('#enemy-health'),
      enemyAether: root.querySelector('#enemy-aether'),
      enemyCharges: root.querySelector('#enemy-charges'),
      enemyStatus: root.querySelector('#enemy-status'),
      enemyCast: root.querySelector('#enemy-cast'),
      playerHealth: root.querySelector('#player-health'),
      playerAether: root.querySelector('#player-aether'),
      playerCharges: root.querySelector('#player-charges'),
      playerStatus: root.querySelector('#player-status'),
      timer: root.querySelector('#round-timer'),
      pressure: root.querySelector('#pressure'),
      diag: root.querySelector('#diag'),
    };
    this.showDiag = false;
  }

  _pips(container, charges) {
    const full = Math.floor(charges);
    const half = charges - full >= 0.5;
    let html = '';
    for (let i = 0; i < SIGIL.max; i++) {
      let cls = 'pip';
      if (i < full) cls += ' full';
      else if (i === full && half) cls += ' half';
      html += `<span class="${cls}"></span>`;
    }
    container.innerHTML = html;
  }

  _statuses(container, w) {
    const chips = Object.entries(w.statuses)
      .filter(([, v]) => v.ticks > 0)
      .map(([name, v]) => `<span class="status-chip">${STATUS_ICON[name] || ''} ${name}${v.stacks > 1 ? ' ' + v.stacks : ''}</span>`);
    if (w.braceTicks > 0) chips.push('<span class="status-chip">🛡 Brace</span>');
    if (w.tenacityTicks > 0) chips.push('<span class="status-chip">✊ Tenacity</span>');
    container.innerHTML = chips.join('');
  }

  update(sim) {
    const [p, e] = sim.wizards;
    this.el.playerHealth.style.width = `${Math.max(0, p.health)}%`;
    this.el.enemyHealth.style.width = `${Math.max(0, e.health)}%`;
    this.el.playerAether.style.width = `${(p.aether / AETHER.max) * 100}%`;
    this.el.enemyAether.style.width = `${(e.aether / AETHER.max) * 100}%`;
    this._pips(this.el.playerCharges, p.charges);
    this._pips(this.el.enemyCharges, e.charges);
    this._statuses(this.el.playerStatus, p);
    this._statuses(this.el.enemyStatus, e);

    // Enemy cast tell (school + name).
    if (e.casting) {
      const sp = SPELLS_BY_ID[e.casting.spellId];
      this.el.enemyCast.textContent = sp ? `${sp.school}: ${sp.name}…` : 'casting…';
    } else {
      this.el.enemyCast.textContent = '';
    }

    // Round timer counts down from the round limit.
    const remain = Math.max(0, MATCH.roundLimitS - sim.timeS);
    const mm = Math.floor(remain / 60);
    const ss = Math.floor(remain % 60);
    this.el.timer.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
    this.el.pressure.classList.toggle('hidden', sim.pressureLevel <= 0);
    if (sim.pressureLevel > 0) this.el.pressure.textContent = `Arcane Pressure ${sim.pressureLevel}`;
  }

  setDiag(diag) {
    if (!this.showDiag) { this.el.diag.classList.add('hidden'); return; }
    this.el.diag.classList.remove('hidden');
    if (!diag) { this.el.diag.innerHTML = 'draw a glyph…'; return; }
    if (diag.accepted) {
      this.el.diag.innerHTML =
        `<div class="accepted">✓ ${diag.name} (${diag.best.score.toFixed(2)})</div>` +
        `margin ${diag.margin.toFixed(2)}`;
    } else {
      const best = diag.best ? `${diag.best.gestureKey || diag.best.name} ${diag.best.score.toFixed(2)}` : '—';
      this.el.diag.innerHTML =
        `<div class="rejected">✗ ${diag.reason}</div>best: ${best}<br>margin ${(diag.margin || 0).toFixed(2)}`;
    }
  }
}
