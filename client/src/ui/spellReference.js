import { SPELL_CATALOG } from '@shared/balance/spellData.generated.js';
import { GESTURE_KEYS } from '@shared/balance/loadouts.js';
import { GESTURE_TEMPLATES } from '@shared/gesture/templates.js';

const DETAILS = {
  1: ['8 direct; Burning can add 18 damage per stack over 9 sec (max 2 stacks).', 'Reflectable fast projectile. Burning is removed by water and ignites Oil.', 'Fast pressure, finishing low-health targets, and setting up Oil reactions.'],
  2: ['10 direct damage.', 'Chilled for 9 sec: 18% movement/recovery slow. Primes Frost Bind and Frozen Ground.', 'Reliable Tide poke and the main setup for freeze combos.'],
  3: ['6 direct damage.', 'Static for 45 sec (max 3). One stack interrupts the next channel; 2 stacks prime Storm stuns.', 'Fast poke, channel disruption, and Thunderclap/Chain Lightning setup.'],
  4: ['14 direct piercing damage; 18 against a target protected by cover.', 'Half of its damage bypasses Ward absorption. Its cover bonus damages the protected wizard, not the cover itself.', 'Punish Ward and Stone Wall users while applying efficient direct damage.'],
  5: ['12 direct damage.', 'Reflectable, mildly homing missile. Consumes Mark for amplified damage.', 'Consistent Arcane payoff after Amplify and pressure against moving targets.'],
  6: ['16 cone damage plus Burning.', 'Broad non-reflectable flame wall. Ignites Oil and clears or backlights Fog.', 'Area pressure, environmental conversion, and punishing narrow defensive timing.'],
  7: ['18 direct damage; Soaked targets take 25% bonus Storm damage.', 'Soaked or Static-2 targets are stunned for 0.8 sec. While any Wet zone exists, Conductive Arc leaves the target Soaked after the hit for later lightning.', 'Storm payoff after Rain or two Spark Darts.'],
  8: ['30 area damage plus Burning.', 'Large non-reflectable projectile; destroys cover and ignites Oil.', 'Major telegraphed finisher, cover removal, and Flash Fire combos.'],
  9: ['26 area damage plus Chilled.', 'Large non-reflectable ice comet. Converts Wet ground to Frozen Ground.', 'Heavy Tide finisher, area denial, and freeze setup.'],
  10: ['30-point shield for 12.6 sec.', 'Currently absorbs incoming damage from any angle. Piercing attacks partly bypass it.', 'Efficient answer to direct projectiles when timed after reading the enemy cast.'],
  11: ['60-point all-direction barrier for 9 sec.', 'Blocks damage, hostile statuses, Aether Leech, traps, and Wet/Soaked weather exposure. Its caster cannot start offensive spells.', 'Survive heavy bursts, status setups, weather combos, and uncertain attack angles.'],
  12: ['Reflects the first reflectable projectile during a 3.6 sec window.', 'A successful reflect sends the projectile back and grants 0.5 Sigil Charge.', 'High-skill counter to light and medium projectiles; weak against area attacks.'],
  13: ['No damage.', 'Removes up to 2 harmful statuses. If none exist, removes one enemy zone edge.', 'Break setup chains, cleanse control/debuffs, or clear environmental pressure.'],
  14: ['No direct damage; short 0.5-arc relocation.', 'Invisible for 3 sec with a 1.05 sec evade window; removes Root. Homing stops tracking, and Practice AI aims projectiles randomly.', 'Escape Root, break homing, disappear from view, and evade heavy tells or targeted projectiles.'],
  15: ['26-HP cover for up to 24 sec.', 'Intercepts non-piercing, non-area projectiles before they reach the wizard; each collision lowers wall HP. Quake and Fireball destroy it.', 'Create safe Focus windows, fully block direct projectile pressure, and control sightlines.'],
  16: ['No damage.', 'Haste for 18 sec: +30% movement speed, 1.5/sec idle Stamina regeneration, and 25% lower Stamina costs; removes Chilled.', 'Rushdown tempo, mobility, stamina efficiency, and countering Tide slows.'],
  17: ['No damage.', 'After an interruptible channel, grants +5 Aether/sec for 18 sec.', 'Long-term economy advantage when a safe channel window is available.'],
  18: ['No immediate damage.', 'Marks the target for up to 15 sec; the next direct hit gains +35% damage.', 'Core Arcane setup for missiles, heavy attacks, or a forced defensive response.'],
  19: ['No damage.', 'Ember Attunement for 18 sec: Ember spells cost 15% less Aether.', 'Commit to sustained fire pressure and environmental Ember chains.'],
  20: ['No damage.', 'Grounded for 15 sec: 15% damage reduction and Static/Wet-lightning protection, with 15% movement slow.', 'Dedicated anti-Storm defense and durable counter-punch setup.'],
  21: ['No direct damage.', 'Weakened for 12 sec: target deals 22% less outgoing damage.', 'Win expected trades and blunt an enemy burst window.'],
  22: ['No direct damage.', 'Sundered for 12 sec: target takes 20% more direct damage.', 'Universal burst setup before a committed projectile or channel.'],
  23: ['No direct damage.', 'Sloth for 12 sec: 30% movement and Stamina-recovery slow.', 'Keep targets inside zones and make telegraphed attacks harder to escape.'],
  24: ['Drains up to 18 Aether; caster gains half.', 'Can drain the target all the way to 0 Aether.', 'Resource warfare, interrupting expensive plans, and sustaining attrition.'],
  25: ['No direct damage.', 'Veiled for 6 sec: distorts visible trace ink and hides confidence without changing input.', 'Disrupt execution and visual certainty before a pressure sequence.'],
  26: ['No direct damage.', 'Roots the target for 3 sec. Rooted targets cannot move but may cast.', 'Hold targets inside zones and force stationary defensive choices.'],
  27: ['No direct damage.', 'Freezes a Chilled target for 3 sec; they cannot move or cast. Consumes Chilled and grants Tenacity afterward.', 'Powerful earned hard-control payoff for Tide combos.'],
  28: ['6 direct damage.', 'Non-reflectable air shockwave with knockback and interruption. Knocks the target down for 2 sec, preventing movement and Dodge unless Grounded.', 'Fast interruption, spacing control, and denying economy channels.'],
  29: ['No direct damage.', 'Blinded for 4 sec: whites out the opponent area while controls, guides, HUD, and spell effects remain usable. Practice AI loses opponent awareness, and the blinded caster receives no homing assistance.', 'Create a four-second action window for movement, setup, or pressure.'],
  30: ['8 direct damage.', 'Stuns for 2 sec only if the target is Soaked or has 2 Static. The target cannot move or cast. It consumes Static stacks but leaves Soaked active.', 'Storm control payoff with a shorter release than heavy lightning.'],
  31: ['No direct damage; shared Oil zone for 21 sec.', 'Ember causes Flash Fire; Rain washes it away; Gust moves it.', 'Prepare explosive terrain and force movement or counter-weather decisions.'],
  32: ['No direct damage; shared Rain lasts 21 sec.', 'Both duelists become Wet immediately and upgrade to Soaked after 5 continuous seconds. Douses Burning and Fire and globally enables weather reactions.', 'Control the elemental state of the arena and set up Tide/Storm combos for either side.'],
  33: ['No direct damage; Gust lasts 1.8 sec with a 1.2 sec deflect window.', 'Deflects light projectiles, clears Fog, moves Oil, spreads Fire, and knocks the foe down for 2 sec unless Grounded.', 'Reactive projectile defense, movement denial, and environmental repositioning.'],
  34: ['10 area damage.', 'Non-reflectable ground shock; interrupts, destroys cover, and knocks the target down for 2 sec unless Grounded.', 'Punish channels, break Stone Wall, and deny movement or Dodge.'],
  35: ['No direct damage; shared Fog zone for 18 sec.', 'Visually obscures both sides and disables all spell homing while active. Gust and Flame Wave clear or backlight it.', 'Hide setup timing, break homing assistance, and create symmetric uncertainty.'],
  36: ['No direct damage; visible trap lasts up to 24 sec.', 'Placed just ahead of the enemy’s current lane. It roots a non-owner for 2 sec after they step into it, then is consumed.', 'Reliable movement punishment and setup for area attacks.'],
};

const COUNTERS = {
  1: ['Ward or Barrier', 'Gust Wall', 'Reflect', 'Dodge or Blink', 'Rain removes Burning'],
  2: ['Ward or Barrier', 'Gust Wall', 'Reflect', 'Dodge or Blink', 'Dispel or Haste clears Chilled'],
  3: ['Grounding Mantle', 'Ward or Barrier', 'Gust Wall', 'Reflect', 'Dodge or Blink'],
  4: ['Dodge or Blink', 'Barrier Dome', 'Brace', 'Interrupt its windup'],
  5: ['Ward or Barrier', 'Reflect', 'Gust Wall', 'Blink', 'Force the Mark onto a weak hit'],
  6: ['Barrier Dome', 'Move or Dodge outside its broad hit radius', 'Rain removes Burning', 'Interrupt its windup'],
  7: ['Grounding Mantle', 'Dispel Soaked/Static setup', 'Barrier Dome', 'Dodge or Blink', 'Interrupt its windup'],
  8: ['Dodge or Blink', 'Barrier Dome', 'Interrupt its windup', 'Avoid Oil'],
  9: ['Dodge or Blink', 'Barrier Dome', 'Interrupt its windup', 'Dispel Chilled afterward'],
  10: ['Stone Shard partially pierces it', 'Sunder', 'Sustained attacks', 'Wait for the shield to expire'],
  11: ['Wait while its caster cannot attack', 'Aether Leech', 'Sunder', 'Sustained damage'],
  12: ['Area or non-reflectable spells', 'Feint', 'Delay the projectile until the window expires'],
  13: ['Direct damage', 'Bait it with a minor debuff', 'Reapply setup after its use'],
  14: ['Area attacks and zones', 'Delay attacks until invisibility ends', 'Track the landing position'],
  15: ['Quake', 'Fireball', 'Stone Shard gains bonus damage against its owner', 'Sunder'],
  16: ['Sloth Hex', 'Aether Leech', 'Burst during the setup investment'],
  17: ['Concussive Blast', 'Spark Dart', 'Quake', 'Pressure the channel'],
  18: ['Dispel removes Mark', 'Force a weak hit to consume Mark', 'Barrier or evade the payoff'],
  19: ['Rain and Tide pressure', 'Aether Leech', 'Wait out the Ember commitment'],
  20: ['Sunder', 'Aether Leech', 'Non-Storm pressure', 'Environmental zones'],
  21: ['Dispel', 'Wait it out', 'Use utility spells while weakened'],
  22: ['Dispel', 'Barrier the follow-up', 'Dodge or Blink the payoff'],
  23: ['Dispel', 'Blink for sudden movement', 'Wait it out'],
  24: ['Spend Aether before it lands', 'Aether Surge recovery', 'Punish its resource investment'],
  25: ['Dispel', 'Use a simple memorized glyph', 'Pressure or interrupt its windup'],
  26: ['Blink removes Root', 'Dispel', 'Barrier while rooted'],
  27: ['Dispel Chilled before Frost Bind', 'Avoid Chilled setup', 'Tenacity blocks repeated hard control'],
  28: ['Dodge or Blink', 'Move before impact', 'Cast after the interrupt has been spent'],
  29: ['Dispel', 'Wait out the 4-second whiteout', 'Use guides, HUD, and visible spell effects'],
  30: ['Grounding Mantle', 'Dispel Soaked/Static setup', 'Dodge or Blink', 'Barrier Dome'],
  31: ['Rain washes Oil away', 'Gust moves Oil', 'Avoid the slick'],
  32: ['Dispel the enemy Wet zone', 'Wait for the Wet zone to expire', 'Grounding Mantle mitigates Storm damage and blocks new Static'],
  33: ['Stone Shard and other heavy projectiles', 'Wait out the short deflect window', 'Reposition'],
  34: ['Dodge or Blink', 'Barrier Dome', 'Interrupt its windup', 'Do not rely on Stone Wall'],
  35: ['Gust Wall', 'Flame Wave', 'Leave the Fog', 'Use its symmetric concealment'],
  36: ['Dispel', 'Avoid the visible trap', 'Blink after the Root triggers'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function text(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  return el;
}

function detail(label, value) {
  const row = document.createElement('p');
  row.className = 'spell-ref-detail';
  row.dataset.field = label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  row.append(text('strong', '', `${label}: `), document.createTextNode(value));
  return row;
}

function glyph(spell) {
  const key = GESTURE_KEYS[spell.id];
  const points = GESTURE_TEMPLATES[key]?.[0] || [];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spell-ref-glyph');
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = points.length ? Math.min(...xs) : 0;
  const maxX = points.length ? Math.max(...xs) : 100;
  const minY = points.length ? Math.min(...ys) : 0;
  const maxY = points.length ? Math.max(...ys) : 100;
  const pad = Math.max(6, Math.max(maxX - minX, maxY - minY) * 0.08);
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${Math.max(1, maxX - minX) + pad * 2} ${Math.max(1, maxY - minY) + pad * 2}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${spell.name} glyph: ${spell.gesture}`);

  const markerId = `spell-arrow-${spell.id}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', markerId);
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('refX', '5');
  marker.setAttribute('refY', '3.5');
  marker.setAttribute('orient', 'auto');
  const arrow = document.createElementNS(SVG_NS, 'path');
  arrow.setAttribute('d', 'M0,0 L7,3.5 L0,7 Z');
  arrow.setAttribute('class', 'spell-ref-arrow');
  marker.appendChild(arrow); defs.appendChild(marker); svg.appendChild(defs);

  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
  line.setAttribute('class', 'spell-ref-line');
  line.setAttribute('marker-end', `url(#${markerId})`);
  svg.appendChild(line);
  if (points.length) {
    const start = document.createElementNS(SVG_NS, 'circle');
    start.setAttribute('cx', points[0].x);
    start.setAttribute('cy', points[0].y);
    start.setAttribute('r', '3.5');
    start.setAttribute('class', 'spell-ref-start');
    svg.appendChild(start);
  }
  return svg;
}

function card(spell) {
  const cardEl = document.createElement('article');
  cardEl.className = `spell-ref-card school-${spell.school.toLowerCase()}`;
  cardEl.dataset.spellId = String(spell.id);
  const header = document.createElement('div');
  header.className = 'spell-ref-header';
  const title = document.createElement('div');
  title.append(text('h3', '', `${spell.id}. ${spell.name}`));
  title.append(text('p', 'spell-ref-type', `${spell.school} · ${spell.category}`));
  header.append(title, glyph(spell));
  cardEl.appendChild(header);

  const charges = spell.charges ? ` · ${spell.charges} Sigil Charge${spell.charges === 1 ? '' : 's'}` : '';
  cardEl.append(
    detail('Pattern', spell.gesture),
    detail('Cost', `${spell.aether} Aether${charges}`),
    detail('Timing', `${spell.min_cast_s.toFixed(2)} sec cast · ${spell.cooldown_s} sec cooldown`),
  );
  const info = DETAILS[spell.id] || [spell.effect, '', ''];
  cardEl.append(
    detail('Damage / protection', info[0]),
    detail('What it does', info[1] || spell.effect),
    detail('Best used for', info[2] || spell.setup_or_payoff),
    detail('Setup / synergy', spell.setup_or_payoff),
    detail('Counters', (COUNTERS[spell.id] || []).join(', ')),
  );
  return cardEl;
}

export function renderSpellReference(container) {
  if (!container) return;
  container.replaceChildren();
  const publicSpells = SPELL_CATALOG.filter((spell) => !spell.secret);
  for (const spell of publicSpells) container.appendChild(card(spell));
}
