// hud.js — HTML overlay HUD. Reads sim state (never mutates it) and renders
// health / Aether / Sigil charges / statuses / zones / round timer / cast tells
// / best-of-three series score. Statuses use text + icon, never color alone
// (accessibility, MASTERPLAN §4).

import { MATCH, AETHER, SIGIL, TICK_HZ } from '@shared/sim/constants.js';
import { SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';

const STATUS_ICON = {
  Burning: 'Bu', Chilled: 'Ch', Soaked: 'So', Static: 'St', Sundered: 'Sd',
  Weakened: 'Wk', Marked: 'Mk', Rooted: 'Rt', Frozen: 'Fz', Stunned: 'Sn',
  Sloth: 'Sl', Blinded: 'Bl', Veiled: 'Vl',
  Haste: 'Ha', Grounded: 'Gr', AetherSurge: 'AS', Attunement: 'At', Phoenix: 'Px',
};

const ZONE_ICON = {
  Oil: 'Oil', Wet: 'Wet', Fog: 'Fog', Frozen: 'Ice', Snare: 'Snare',
  Cover: 'Cover', Hourglass: 'Time', Fire: 'Fire', Gust: 'Gust', Grounded: 'Grd',
};

const BUFFS = new Set(['Haste', 'Grounded', 'AetherSurge', 'Attunement', 'Phoenix']);

function cooldownText(ticks) {
  const seconds = Math.max(0, ticks) / TICK_HZ;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.ceil(seconds)}s`;
}

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
      environment: root.querySelector('#environment'),
      series: root.querySelector('#series-score'),
      spellbar: root.querySelector('#spellbar'),
    };
    this.showDiag = false;
    this.spellButtons = new Map(); // spellId -> button element
    this.lastTouchPress = { at: -Infinity, key: '' };
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
      .map(([name, v]) => {
        const cls = BUFFS.has(name) ? 'status-chip buff' : 'status-chip';
        return `<span class="${cls}" title="${name}">${STATUS_ICON[name] || name.slice(0, 2)} ${name}${v.stacks > 1 ? ' ' + v.stacks : ''}</span>`;
      });
    if (w.braceTicks > 0) chips.push('<span class="status-chip">Brace</span>');
    if (w.tenacityTicks > 0) chips.push('<span class="status-chip">Tenacity</span>');
    if (w.reflectTicks > 0) chips.push('<span class="status-chip buff">Reflect</span>');
    if (w.mirrorTicks > 0) chips.push('<span class="status-chip buff">Decoy</span>');
    if (w.channel) chips.push('<span class="status-chip">Channel</span>');
    container.innerHTML = chips.join('');
  }

  // Build the eight selected guide shortcuts. In normal play buttons select a
  // dotted guide; all roster spells remain drawable whether listed here or not.
  buildSpellbar(loadout, onCast, opts = {}) {
    if (!this.el.spellbar) return;
    this.el.spellbar.innerHTML = '';
    this.spellButtons.clear();
    if (typeof opts.onBlank === 'function') {
      const blank = document.createElement('button');
      blank.className = 'spell-btn spell-blank' + (opts.blankSelected ? ' selected' : '');
      blank.type = 'button';
      blank.innerHTML = '<span class="sb-key">○</span><span class="sb-name">Blank</span>' +
        '<span class="sb-cost">Any spell</span>';
      blank.title = 'Clear the guide and draw any public spell from memory';
      blank.setAttribute('aria-pressed', opts.blankSelected ? 'true' : 'false');
      bindPress(blank, opts.onBlank, this);
      this.el.spellbar.appendChild(blank);
    }
    if (typeof opts.onCooldownToggle === 'function') {
      const cooldown = document.createElement('button');
      cooldown.className = 'spell-btn spell-cooldown-toggle' + (opts.cooldownsEnabled ? ' selected' : '');
      cooldown.type = 'button';
      cooldown.innerHTML = `<span class="sb-key">CD</span><span class="sb-name">Cooldowns</span>` +
        `<span class="sb-cost">${opts.cooldownsEnabled ? 'On' : 'Off'}</span>`;
      cooldown.title = 'Toggle live-game spell cooldowns in Glyph Laboratory';
      cooldown.setAttribute('aria-pressed', opts.cooldownsEnabled ? 'true' : 'false');
      bindPress(cooldown, opts.onCooldownToggle, this);
      this.el.spellbar.appendChild(cooldown);
    }
    if (typeof opts.onEnemyControl === 'function') {
      const enemy = document.createElement('button');
      enemy.className = 'spell-btn spell-enemy-toggle' + (opts.enemyEnabled ? ' selected' : '');
      enemy.type = 'button';
      enemy.innerHTML = '<span class="sb-key">EN</span><span class="sb-name">Enemy</span>' +
        `<span class="sb-cost">${opts.enemyLabel || 'Off'}</span>`;
      enemy.title = 'Choose a spell and schedule for the Glyph Laboratory enemy';
      enemy.setAttribute('aria-pressed', opts.enemyEnabled ? 'true' : 'false');
      bindPress(enemy, opts.onEnemyControl, this);
      this.el.spellbar.appendChild(enemy);
    }
    loadout.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'spell-btn';
      btn.dataset.spell = s.id;
      if (opts.guideMode) btn.dataset.guideOnly = 'true';
      btn.innerHTML = `<span class="sb-key">${opts.guideMode ? 'Guide' : i + 1}</span><span class="sb-name">${s.name}</span>` +
        `<span class="sb-cost">${s.aether}${s.charges ? ' ' + '#'.repeat(s.charges) : ''}</span>`;
      btn.title = `${s.school} - ${s.category}\n${s.effect}`;
      if (s.id === opts.selectedId) {
        btn.classList.add('selected');
        btn.setAttribute('aria-pressed', 'true');
      }
      bindPress(btn, () => onCast(s.id), this);
      this.el.spellbar.appendChild(btn);
      this.spellButtons.set(s.id, btn);
    });
    if (typeof opts.onNext === 'function') {
      const next = document.createElement('button');
      next.className = 'spell-btn spell-next';
      next.type = 'button';
      next.innerHTML = `<span class="sb-key">→</span><span class="sb-name">Next</span>` +
        `<span class="sb-cost">${opts.pageLabel || ''}</span>`;
      next.title = 'Show more public spells';
      bindPress(next, opts.onNext, this);
      this.el.spellbar.appendChild(next);
    }

    function bindPress(button, action, owner) {
      let touch = null;
      const key = button.dataset.spell
        ? `spell:${button.dataset.spell}`
        : [...button.classList].filter((name) => name.startsWith('spell-')).sort().join(':');
      button.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        touch = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      });
      button.addEventListener('pointermove', (event) => {
        if (!touch || event.pointerId !== touch.id) return;
        if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) touch.moved = true;
      });
      button.addEventListener('pointerup', (event) => {
        if (!touch || event.pointerId !== touch.id) return;
        const activate = !touch.moved;
        touch = null;
        if (!activate) return;
        event.preventDefault();
        owner.lastTouchPress = { at: performance.now(), key };
        action();
      });
      button.addEventListener('pointercancel', () => { touch = null; });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (owner.lastTouchPress.key === key && performance.now() - owner.lastTouchPress.at < 700) return;
        action();
      });
    }
  }

  _updateSpellbar(w) {
    for (const [id, btn] of this.spellButtons) {
      const sp = SPELLS_BY_ID[id];
      if (btn.dataset.guideOnly === 'true') {
        const ticks = Math.max(0, w.cooldowns[id] || 0);
        const cd = ticks > 0;
        btn.classList.toggle('cooldown', cd);
        btn.classList.toggle('disabled', cd);
        const cost = btn.querySelector('.sb-cost');
        if (cost) cost.textContent = cd
          ? cooldownText(ticks)
          : `${sp.aether}${sp.charges ? ' ' + '#'.repeat(sp.charges) : ''}`;
        btn.title = cd
          ? `${sp.name} cooldown: ${cooldownText(ticks)} remaining\n${sp.effect}`
          : `${sp.school} - ${sp.category}\n${sp.effect}`;
        continue;
      }
      const cd = (w.cooldowns[id] || 0) > 0;
      const poor = w.aether < sp.aether;
      const noCharge = (sp.charges || 0) > w.charges;
      btn.classList.toggle('cooldown', cd);
      btn.classList.toggle('disabled', cd || poor || noCharge);
      const cdEl = btn.querySelector('.sb-cost');
      if (cd && cdEl) cdEl.textContent = cooldownText(w.cooldowns[id]);
      else if (cdEl) cdEl.textContent = `${sp.aether}${sp.charges ? ' ' + '#'.repeat(sp.charges) : ''}`;
    }
  }

  _environment(sim) {
    if (!this.el.environment) return;
    const chips = sim.zones.map((z) => {
      const owner = z.owner === 0 ? 'you' : 'foe';
      const secs = Math.ceil(z.ticks / 60);
      return `<span class="zone-chip zone-${z.kind.toLowerCase()}">${ZONE_ICON[z.kind] || z.kind} ${secs}s <em>${owner}</em></span>`;
    });
    this.el.environment.innerHTML = chips.join('');
  }

  setSeries(score, roundIndex) {
    if (!this.el.series) return;
    if (!score) { this.el.series.classList.add('hidden'); return; }
    this.el.series.classList.remove('hidden');
    this.el.series.innerHTML = `<span class="you">You ${score[0]}</span> - <span class="foe">${score[1]} Foe</span>` +
      `<span class="rd">Round ${Math.min(roundIndex + 1, 3)}/3</span>`;
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
    this._environment(sim);
    this._updateSpellbar(p);

    // Enemy cast tell (school + name).
    if (e.casting) {
      const sp = SPELLS_BY_ID[e.casting.spellId];
      this.el.enemyCast.textContent = sp ? `${sp.school}: ${sp.name}...` : 'casting...';
    } else if (e.channel) {
      const sp = SPELLS_BY_ID[e.channel.spellId];
      this.el.enemyCast.textContent = sp ? `${sp.school}: ${sp.name} (channel)` : 'channel...';
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
    if (!diag) { this.el.diag.innerHTML = 'draw a glyph...'; return; }
    if (diag.accepted) {
      this.el.diag.innerHTML =
        `<div class="accepted">OK ${diag.name} (${diag.best.score.toFixed(2)})</div>` +
        `margin ${diag.margin.toFixed(2)}`;
    } else {
      const best = diag.best ? `${diag.best.gestureKey || diag.best.name} ${diag.best.score.toFixed(2)}` : '-';
      this.el.diag.innerHTML =
        `<div class="rejected">x ${diag.reason}</div>best: ${best}<br>margin ${(diag.margin || 0).toFixed(2)}`;
    }
  }
}
