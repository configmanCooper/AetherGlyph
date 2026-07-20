// spellVfx.js — data-driven Three.js visual effects for all 40 spells.
//
// The sim/renderer split is unchanged: this module NEVER touches combat state.
// It only turns "spell N happened at position P" into distinct, disposable
// Three.js objects. Every spell's look is driven by its profile in
// spellVfxProfiles.js (kind/family/colors/budget); this file implements one
// builder per family and parameterises it from the profile.
//
// Lifetime contract (owned by arena.js):
//   * Every factory returns a handle { object3D, kind, family, billboard?,
//     update(ctx), dispose() }.
//   * Arena adds object3D to the scene, drives update(ctx) each frame, and calls
//     dispose() + scene.remove when the source (projectile/zone/effect) ends.
//   * Transient handles (impacts, instant releases, cast cues) return `false`
//     from update() when finished so arena can retire them; arena also caps the
//     total number of live transient handles.
//
// Performance: simple primitive geometries are shared through a module cache and
// never disposed; only per-instance materials and bespoke buffer geometries are
// owned + disposed by a handle. Glows use unlit additive materials so low-end
// GPUs pay no lighting cost. Reduced-motion collapses every effect to a static,
// readable silhouette (no trails, particles, pulsing, flicker or flashes).

import * as THREE from 'three';
import {
  getSpellVfx, VFX_SCHOOL_PALETTE, VFX_FAMILIES,
  getReactionVfx, REACTION_VFX_BUILDERS,
} from './spellVfxProfiles.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

// ---- shared geometry cache (created once, never disposed) -----------------
const _geo = {};
function geo(key, make) { return _geo[key] || (_geo[key] = make()); }
const G = {
  ball: () => geo('ball', () => new THREE.SphereGeometry(1, 12, 10)),
  ballHi: () => geo('ballHi', () => new THREE.SphereGeometry(1, 16, 14)),
  ico: () => geo('ico', () => new THREE.IcosahedronGeometry(1, 0)),
  octa: () => geo('octa', () => new THREE.OctahedronGeometry(1, 0)),
  tetra: () => geo('tetra', () => new THREE.TetrahedronGeometry(1, 0)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cone: () => geo('cone', () => new THREE.ConeGeometry(1, 1, 8)),
  cone4: () => geo('cone4', () => new THREE.ConeGeometry(1, 1, 4)),
  cyl: () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 10, 1, true)),
  ring: () => geo('ring', () => new THREE.RingGeometry(0.72, 1, 32)),
  disc: () => geo('disc', () => new THREE.CircleGeometry(1, 32)),
  plane: () => geo('plane', () => new THREE.PlaneGeometry(1, 1)),
  torus: () => geo('torus', () => new THREE.TorusGeometry(1, 0.08, 8, 32)),
};

// ---- material helpers (always per-instance so dispose() is leak-free) ------
function matBasic(color, opacity = 1, additive = true) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}
function matSolid(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.5, metalness: opts.metalness ?? 0.1,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1, flatShading: !!opts.flat,
  });
}
function lineMat(color, opacity = 0.9) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
}

function mesh(geometry, material) { return new THREE.Mesh(geometry, material); }
function glow(radius, color, opacity = 0.7) {
  const m = mesh(G.ball(), matBasic(color, opacity, true)); m.scale.setScalar(radius); return m;
}

function ownBuffer(g) { g.userData.own = true; return g; }

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry && o.geometry.userData && o.geometry.userData.own) o.geometry.dispose();
    const m = o.material;
    if (m) { if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose()); else if (m.dispose) m.dispose(); }
  });
}

// School -> impact element so a projectile's burst matches its element.
const ELEMENT_BY_SCHOOL = {
  Ember: 'fire', Tide: 'ice', Storm: 'electric', Stone: 'rock',
  Gale: 'air', Arcane: 'arcane', Umbra: 'umbra', Prismatic: 'prismatic',
};

function orient(obj, dir) {
  _dir.copy(dir); if (_dir.lengthSq() < 1e-6) return; _dir.normalize();
  obj.quaternion.setFromUnitVectors(FORWARD, _dir);
}

// ---- lightweight world-space trail ----------------------------------------
// Lives as a child of the (un-rotated, top-level) projectile group; local
// vertex positions are (worldHistory - groupWorldPos), so the tail lags behind.
function makeTrail(maxPoints, color, reduced) {
  if (reduced || maxPoints <= 1) return null;
  const positions = new Float32Array(maxPoints * 3);
  const g = ownBuffer(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(g, lineMat(color, 0.6));
  line.frustumCulled = false;
  const hist = [];
  return {
    line,
    reset() { hist.length = 0; },
    update(groupPos) {
      hist.push(groupPos.clone());
      if (hist.length > maxPoints) hist.shift();
      for (let i = 0; i < maxPoints; i++) {
        const h = hist[Math.min(i, hist.length - 1)] || groupPos;
        positions[i * 3] = h.x - groupPos.x;
        positions[i * 3 + 1] = h.y - groupPos.y;
        positions[i * 3 + 2] = h.z - groupPos.z;
      }
      g.attributes.position.needsUpdate = true;
      g.setDrawRange(0, Math.max(2, hist.length));
    },
  };
}

// Small reusable particle cloud (additive points as tiny billboards).
function makePoints(count, color, size, reduced) {
  if (reduced) count = Math.min(count, 0);
  const n = Math.max(0, count);
  const positions = new Float32Array(Math.max(1, n) * 3);
  const g = ownBuffer(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { pts, positions, geometry: g, count: n };
}

// A jagged poly-line between two local points (used by lightning + arcs).
function fillJagged(array, offset, from, to, segments, jitter, rand) {
  let px = from.x, py = from.y, pz = from.z;
  for (let s = 1; s <= segments; s++) {
    const t = s / segments;
    let nx = from.x + (to.x - from.x) * t;
    let ny = from.y + (to.y - from.y) * t;
    let nz = from.z + (to.z - from.z) * t;
    if (s < segments) {
      const j = jitter * (1 - Math.abs(t - 0.5) * 1.4);
      nx += (rand() - 0.5) * j; ny += (rand() - 0.5) * j; nz += (rand() - 0.5) * j * 0.6;
    }
    array[offset++] = px; array[offset++] = py; array[offset++] = pz;
    array[offset++] = nx; array[offset++] = ny; array[offset++] = nz;
    px = nx; py = ny; pz = nz;
  }
  return offset;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==========================================================================
//  PROJECTILES (family builders keyed by profile.family)
// ==========================================================================

function proj(profile, reduced, trailPts) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const trail = makeTrail(trailPts ?? profile.budget.trail, profile.colors.trail, reduced);
  if (trail) group.add(trail.line);
  return { group, body, trail };
}
function finishProj(profile, group, body, trail, animate) {
  let t = 0;
  return {
    object3D: group, kind: profile.kind, family: profile.family,
    update(ctx) {
      t += (ctx.dtMs || 16) * 0.001;
      orient(body, ctx.dir);
      if (trail) trail.update(group.position);
      if (!ctx.reduced && animate) animate(t, ctx);
    },
    dispose() { disposeTree(group); },
  };
}

const PROJECTILE_BUILDERS = {
  orb(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const core = glow(0.15, profile.colors.core, 0.95); body.add(core);
    const flame = glow(0.26, profile.colors.glow, 0.6); body.add(flame);
    return finishProj(profile, group, body, trail, (t) => {
      const f = 1 + Math.sin(t * 22) * 0.18;
      flame.scale.setScalar(0.26 * f);
      core.scale.setScalar(0.15 * (1 + Math.sin(t * 30) * 0.1));
    });
  },
  spear(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const shaft = mesh(G.octa(), matSolid(profile.colors.core, { emissive: profile.colors.glow, emissiveIntensity: 0.7, flat: true, roughness: 0.25 }));
    shaft.scale.set(0.08, 0.08, 0.5); body.add(shaft);
    const inner = mesh(G.octa(), matBasic(profile.colors.glow, 0.5)); inner.scale.set(0.12, 0.12, 0.62); body.add(inner);
    const tip = glow(0.1, profile.colors.core, 0.8); tip.position.z = 0.5; body.add(tip);
    return finishProj(profile, group, body, trail, (t) => {
      shaft.rotation.z = t * 6; inner.scale.setScalar(1); inner.scale.set(0.12, 0.12, 0.62 * (1 + Math.sin(t * 18) * 0.06));
    });
  },
  dart(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const diamond = mesh(G.octa(), matBasic(profile.colors.core, 0.95)); diamond.scale.set(0.09, 0.09, 0.22); body.add(diamond);
    // short forked arc ahead of the dart
    const seg = reduced ? 4 : 6;
    const arr = new Float32Array(seg * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const arc = new THREE.LineSegments(bg, lineMat(profile.colors.glow, 0.9)); arc.frustumCulled = false; body.add(arc);
    const rnd = mulberry(7);
    const rebuild = () => { fillJagged(arr, 0, _v.set(0, 0, 0.1), _v.clone().set(0, 0, 0.4), seg, 0.14, rnd); bg.attributes.position.needsUpdate = true; };
    rebuild();
    let acc = 0;
    return finishProj(profile, group, body, trail, (t, ctx) => {
      acc += ctx.dtMs || 16; if (acc > 45) { acc = 0; rebuild(); }
      diamond.rotation.z = t * 10;
    });
  },
  spike(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const spin = new THREE.Group(); body.add(spin); // spins around the travel axis without fighting orient()
    const rock = mesh(G.cone4(), matSolid(profile.colors.glow, { emissive: 0x120c06, roughness: 1, flat: true }));
    rock.scale.set(0.16, 0.16, 0.5); rock.rotation.x = Math.PI / 2; spin.add(rock);
    const rock2 = mesh(G.tetra(), matSolid(profile.colors.trail, { roughness: 1, flat: true })); rock2.scale.setScalar(0.12); rock2.position.z = -0.12; spin.add(rock2);
    return finishProj(profile, group, body, trail, (t) => { spin.rotation.z = t * 9; });
  },
  missile(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const nose = mesh(G.cone(), matSolid(profile.colors.core, { emissive: profile.colors.glow, emissiveIntensity: 0.8, flat: true }));
    nose.scale.set(0.12, 0.28, 0.12); nose.rotation.x = Math.PI / 2; nose.position.z = 0.2; body.add(nose);
    const hull = mesh(G.cyl(), matSolid(profile.colors.glow, { emissive: profile.colors.trail, emissiveIntensity: 0.5 }));
    hull.scale.set(0.1, 0.28, 0.1); hull.rotation.x = Math.PI / 2; hull.position.z = -0.02; body.add(hull);
    const halo = glow(0.16, profile.colors.core, 0.5); halo.position.z = -0.18; body.add(halo);
    // three arcane rings the missile threads through (hole aligned to travel)
    const rings = [];
    if (!reduced) for (let i = 0; i < 3; i++) {
      const r = mesh(G.torus(), matBasic(profile.colors.core, 0.7)); r.scale.setScalar(0.14); body.add(r); rings.push(r);
    }
    return finishProj(profile, group, body, trail, (t) => {
      for (let i = 0; i < rings.length; i++) {
        const ph = (t * 2.2 + i / rings.length) % 1;
        rings[i].position.z = -0.1 - ph * 0.5;
        rings[i].scale.setScalar(0.12 + ph * 0.12);
        rings[i].material.opacity = 0.7 * (1 - ph);
      }
    });
  },
  wave(profile, reduced) {
    const group = new THREE.Group();
    const body = new THREE.Group(); group.add(body);
    // low translucent flame sheet + a curved row of flame tongues (a wall, not a ball)
    const sheet = mesh(G.plane(), matBasic(profile.colors.trail, 0.32)); sheet.scale.set(1.9, 1.1, 1); sheet.position.y = 0.1; body.add(sheet);
    const tongues = [];
    const n = reduced ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * 1.8;
      const t = mesh(G.cone(), matBasic(i % 2 ? profile.colors.glow : profile.colors.core, 0.8));
      t.scale.set(0.16, 0.7, 0.16); t.position.set(x, 0.35, -0.18 * (1 - (2 * x / 1.8) * (2 * x / 1.8)) - 0.05);
      body.add(t); tongues.push(t);
    }
    return {
      object3D: group, kind: profile.kind, family: profile.family,
      update(ctx) {
        // stay upright; yaw the wall to face travel
        _dir.copy(ctx.dir); body.rotation.y = Math.atan2(_dir.x, _dir.z);
        if (!ctx.reduced) {
          const s = (this._t = (this._t || 0) + (ctx.dtMs || 16) * 0.001);
          for (let i = 0; i < tongues.length; i++) tongues[i].scale.y = 0.7 * (0.8 + Math.abs(Math.sin(s * 12 + i)) * 0.5);
        }
      },
      dispose() { disposeTree(group); },
    };
  },
  lightning(profile, reduced) {
    const group = new THREE.Group();
    const head = glow(0.14, profile.colors.core, 0.9); group.add(head);
    const segs = reduced ? 6 : 9, branchSegs = reduced ? 0 : 4;
    const total = segs + branchSegs;
    const arr = new Float32Array(total * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const bolt = new THREE.LineSegments(bg, lineMat(profile.colors.glow, 0.95)); bolt.frustumCulled = false; group.add(bolt);
    const rnd = mulberry(13);
    const rebuild = (dir) => {
      _dir.copy(dir).normalize();
      const back = _v.copy(_dir).multiplyScalar(-1.1);
      const fwd = new THREE.Vector3().copy(_dir).multiplyScalar(0.5);
      let o = fillJagged(arr, 0, back, fwd, segs, 0.28, rnd);
      if (branchSegs) {
        const mid = new THREE.Vector3().copy(_dir).multiplyScalar(-0.3);
        fillJagged(arr, o, mid, new THREE.Vector3(mid.x + (rnd() - 0.5) * 0.8, mid.y + 0.4, mid.z), branchSegs, 0.3, rnd);
      }
      bg.attributes.position.needsUpdate = true;
    };
    let acc = 999;
    return {
      object3D: group, kind: profile.kind, family: profile.family,
      update(ctx) {
        acc += ctx.dtMs || 16;
        if (ctx.reduced) { if (acc > 1e6) return; acc = -1e9; rebuild(ctx.dir); return; }
        if (acc > 40) { acc = 0; rebuild(ctx.dir); }
      },
      dispose() { disposeTree(group); },
    };
  },
  fireball(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const core = mesh(G.ico(), matBasic(profile.colors.core, 0.95)); core.scale.setScalar(0.24); body.add(core);
    const shell = glow(0.42, profile.colors.glow, 0.4); body.add(shell);
    const smoke = makePoints(reduced ? 0 : 12, profile.colors.trail, 0.5, reduced);
    if (smoke.count) group.add(smoke.pts);
    return finishProj(profile, group, body, trail, (t) => {
      core.rotation.x = t * 2; core.rotation.y = t * 2.6;
      core.scale.setScalar(0.24 * (1 + Math.sin(t * 16) * 0.12));
      shell.scale.setScalar(0.42 * (1 + Math.sin(t * 9) * 0.1));
      for (let i = 0; i < smoke.count; i++) {
        const a = i / smoke.count, ph = (t * 0.9 + a) % 1;
        smoke.positions[i * 3] = Math.sin(a * 25) * 0.14;
        smoke.positions[i * 3 + 1] = Math.cos(a * 25) * 0.14 + ph * 0.1;
        smoke.positions[i * 3 + 2] = -ph * 0.7;
      }
      smoke.geometry.attributes.position.needsUpdate = true;
    });
  },
  comet(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const iceMat = matSolid(profile.colors.core, { emissive: profile.colors.glow, emissiveIntensity: 0.5, flat: true, roughness: 0.2, metalness: 0.1 });
    const body1 = mesh(G.ico(), iceMat); body1.scale.setScalar(0.3); body.add(body1);
    const halo = glow(0.38, profile.colors.glow, 0.4); body.add(halo);
    const frost = makePoints(reduced ? 0 : 10, profile.colors.core, 0.5, reduced);
    if (frost.count) group.add(frost.pts);
    return finishProj(profile, group, body, trail, (t) => {
      body1.rotation.y = t * 1.4; body1.rotation.x = t * 0.9;
      for (let i = 0; i < frost.count; i++) {
        const a = i / frost.count, ph = (t * 1.1 + a) % 1;
        frost.positions[i * 3] = Math.sin(a * 30) * 0.12;
        frost.positions[i * 3 + 1] = Math.cos(a * 30) * 0.12;
        frost.positions[i * 3 + 2] = -ph * 0.8;
      }
      frost.geometry.attributes.position.needsUpdate = true;
    });
  },
  airpulse(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const ring = mesh(G.torus(), matBasic(profile.colors.glow, 0.7)); ring.scale.setScalar(0.24); body.add(ring);
    const core = glow(0.12, profile.colors.core, 0.6); body.add(core);
    return finishProj(profile, group, body, trail, (t) => {
      ring.scale.setScalar(0.24 * (1 + Math.sin(t * 12) * 0.16));
    });
  },
  thunderring(profile, reduced) {
    const { group, body, trail } = proj(profile, reduced);
    const ring = mesh(G.torus(), matBasic(profile.colors.core, 0.85)); ring.scale.setScalar(0.28); body.add(ring);
    const ring2 = mesh(G.torus(), matBasic(profile.colors.glow, 0.5)); ring2.scale.setScalar(0.36); body.add(ring2);
    const core = glow(0.16, profile.colors.core, 0.85); body.add(core);
    return finishProj(profile, group, body, trail, (t) => {
      ring.rotation.z = t * 8; ring2.rotation.z = -t * 6;
      core.scale.setScalar(0.16 * (1 + Math.sin(t * 40) * 0.2));
    });
  },
  quakewave(profile, reduced) {
    const group = new THREE.Group();
    group.userData.groundHug = true; // arena pins this near the floor
    const body = new THREE.Group(); group.add(body);
    // jagged ground fracture + a small rock burst
    const segs = reduced ? 5 : 8;
    const arr = new Float32Array(segs * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const crack = new THREE.LineSegments(bg, lineMat(profile.colors.core, 0.9)); crack.frustumCulled = false; body.add(crack);
    const rnd = mulberry(29);
    fillJagged(arr, 0, _v.set(-0.9, 0.02, 0), new THREE.Vector3(0.9, 0.02, 0), segs, 0.35, rnd);
    bg.attributes.position.needsUpdate = true;
    const rocks = [];
    const nr = reduced ? 0 : 5;
    for (let i = 0; i < nr; i++) { const r = mesh(G.tetra(), matSolid(profile.colors.glow, { roughness: 1, flat: true })); r.scale.setScalar(0.1 + rnd() * 0.06); body.add(r); rocks.push(r); }
    return {
      object3D: group, kind: profile.kind, family: profile.family,
      update(ctx) {
        _dir.copy(ctx.dir); body.rotation.y = Math.atan2(_dir.x, _dir.z);
        if (ctx.reduced) return;
        const s = (this._t = (this._t || 0) + (ctx.dtMs || 16) * 0.001);
        for (let i = 0; i < rocks.length; i++) {
          const a = i / Math.max(1, rocks.length), ph = (s * 1.6 + a) % 1;
          rocks[i].position.set((a - 0.5) * 1.4, Math.sin(ph * Math.PI) * 0.5, 0);
          rocks[i].rotation.set(s * 3 + i, s * 2, 0);
        }
      },
      dispose() { disposeTree(group); },
    };
  },
};

export function makeProjectileVfx(spellId, reduced) {
  const profile = getSpellVfx(spellId);
  const build = profile && PROJECTILE_BUILDERS[profile.family];
  if (!build) return makeProjectileVfx.fallback(profile, reduced);
  return build(profile, reduced);
}
makeProjectileVfx.fallback = (profile, reduced) => {
  const p = profile || { kind: 'unknown', family: 'orb', colors: { core: 0xffffff, glow: 0xffffff, trail: 0xffffff }, budget: { trail: 8 } };
  return PROJECTILE_BUILDERS.orb(p, reduced);
};

// ==========================================================================
//  SHARED PRIMITIVES for transient effects (impacts + instant releases)
// ==========================================================================

// Self-timed transient handle. update(ctx) returns false once expired.
function transient(kind, family, object3D, lifeMs, onUpdate, opts = {}) {
  let age = 0;
  return {
    object3D, kind, family, billboard: !!opts.billboard,
    update(ctx) {
      age += (ctx && ctx.dtMs) || 16;
      const t = Math.min(1, age / lifeMs);
      if (onUpdate) onUpdate(t, age, ctx || {});
      return age < lifeMs;
    },
    dispose() { disposeTree(object3D); },
  };
}

function ringMesh(color, opacity) { return mesh(G.ring(), matBasic(color, opacity, true)); }
function discMesh(color, opacity, additive = false) { const m = mesh(G.disc(), matBasic(color, opacity, additive)); return m; }

// Parametric poly-line (figure-eights, spirals, ribbons, roots, streaks).
function paramLine(count, fn, color, opacity, closed) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { const p = fn(i / (closed ? count : count - 1), i); positions[i * 3] = p[0]; positions[i * 3 + 1] = p[1]; positions[i * 3 + 2] = p[2]; }
  const g = ownBuffer(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new (closed ? THREE.LineLoop : THREE.Line)(g, lineMat(color, opacity));
  line.frustumCulled = false;
  return { line, geometry: g, positions };
}

// Compact translucent wizard silhouette (blink afterimage, mirror decoy).
function decoyFigure(color, opacity) {
  const g = new THREE.Group();
  const robe = mesh(G.cone(), matBasic(color, opacity, false)); robe.scale.set(0.55, 1.9, 0.55); robe.position.y = 0.95; g.add(robe);
  const head = mesh(G.ball(), matBasic(color, opacity * 1.1, false)); head.scale.setScalar(0.3); head.position.y = 2.05; g.add(head);
  const hat = mesh(G.cone(), matBasic(color, opacity, false)); hat.scale.set(0.4, 0.85, 0.4); hat.position.y = 2.5; g.add(hat);
  return g;
}

// ==========================================================================
//  IMPACTS — element-matched bursts spawned when a projectile resolves.
// ==========================================================================

export function makeImpactVfx(spellId, reduced, opts = {}) {
  const profile = getSpellVfx(spellId) || { kind: 'hit', school: 'Arcane', colors: { core: 0xffffff, glow: 0xff5d73, trail: 0x882233 } };
  const element = ELEMENT_BY_SCHOOL[profile.school] || 'arcane';
  const c = profile.colors;
  const scale = opts.scale || 1;
  const root = new THREE.Group();

  const core = glow(0.2 * scale, c.core, 0.95); root.add(core);
  const ring = ringMesh(c.glow, 0.85); ring.scale.setScalar(0.2 * scale); root.add(ring);
  let ring2 = null;
  if (!reduced && (element === 'arcane' || element === 'air' || element === 'prismatic' || element === 'electric' || element === 'umbra')) {
    ring2 = ringMesh(c.core, 0.55); ring2.scale.setScalar(0.2 * scale); root.add(ring2);
  }

  // element debris / shards
  const shards = [];
  const defaultShards = { fire: 6, ice: 8, rock: 8, electric: 0, air: 0, arcane: 5, umbra: 4, prismatic: 8 };
  const shardCount = reduced ? 0 : (opts.shards ?? (defaultShards[element] || 5));
  const shardGeo = element === 'ice' ? G.octa() : element === 'rock' ? G.box() : G.tetra();
  for (let i = 0; i < shardCount; i++) {
    const m = element === 'rock'
      ? mesh(shardGeo, matSolid(c.trail, { roughness: 1, flat: true }))
      : mesh(shardGeo, matBasic(i % 2 ? c.core : c.glow, 0.95));
    m.scale.setScalar((0.05 + Math.random() * 0.06) * scale);
    const th = Math.random() * Math.PI * 2, ph = (Math.random() - 0.4) * Math.PI;
    m.userData.vel = new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.sin(ph) + 0.5, Math.sin(th) * Math.cos(ph)).multiplyScalar((0.9 + Math.random()) * scale);
    root.add(m); shards.push(m);
  }

  // electric arcs (radial star)
  let arcs = null;
  if (!reduced && element === 'electric') {
    const spokes = 5, seg = 3;
    const arr = new Float32Array(spokes * seg * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const rnd = mulberry(spellId * 17 + 3);
    let o = 0;
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      o = fillJagged(arr, o, _v.set(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.7 * scale, Math.sin(a) * 0.7 * scale, 0), seg, 0.16, rnd);
    }
    bg.attributes.position.needsUpdate = true;
    arcs = new THREE.LineSegments(bg, lineMat(c.core, 0.9)); arcs.frustumCulled = false; root.add(arcs);
  }

  const lifeMs = opts.lifeMs || (reduced ? 220 : 430);
  return transient(profile.kind + ':impact', 'impact', root, lifeMs, (t, age, ctx) => {
    const ease = 1 - (1 - t) * (1 - t);
    ring.scale.setScalar((0.2 + ease * 1.1) * scale); ring.material.opacity = 0.85 * (1 - t);
    if (ring2) { ring2.scale.setScalar((0.2 + ease * 1.7) * scale); ring2.material.opacity = 0.55 * (1 - t); }
    core.scale.setScalar((0.2 + t * 0.25) * scale); core.material.opacity = 0.95 * (1 - t * t);
    const dt = ((ctx.dtMs || 16) * 0.001);
    for (const s of shards) {
      s.position.addScaledVector(s.userData.vel, dt);
      s.userData.vel.y -= 2.4 * dt;
      s.rotation.x += dt * 6; s.rotation.y += dt * 5;
      if (s.material.opacity !== undefined) s.material.opacity = 0.95 * (1 - t);
    }
    if (arcs) arcs.material.opacity = 0.9 * (1 - t) * (Math.floor(age / 60) % 2 ? 1 : 0.45);
  }, { billboard: true });
}

// ==========================================================================
//  ZONES — distinct ground visuals per kind (not generic rings).
// ==========================================================================

function zoneHandle(kind, group, onUpdate) {
  return {
    object3D: group, kind: 'zone:' + kind, family: 'zone',
    update(ctx) { if (onUpdate) onUpdate(ctx); },
    dispose() { disposeTree(group); },
  };
}

const ZONE_BUILDERS = {
  // Glossy black slick with a moving iridescent sheen and a travelling glint.
  Oil(reduced, r, c) {
    const g = new THREE.Group();
    const pool = mesh(G.disc(), matBasic(0x0a0906, 0.86, false)); pool.rotation.x = -Math.PI / 2; pool.scale.setScalar(r); pool.position.y = 0.02; g.add(pool);
    const sheen = mesh(G.ring(), matBasic(0x6a7fb0, 0.4, true)); sheen.rotation.x = -Math.PI / 2; sheen.scale.setScalar(r); sheen.position.y = 0.035; g.add(sheen);
    const glint = mesh(G.disc(), matBasic(0xffffff, 0.22, true)); glint.rotation.x = -Math.PI / 2; glint.scale.setScalar(r * 0.42); glint.position.set(r * 0.3, 0.045, 0); g.add(glint);
    return zoneHandle('Oil', g, (ctx) => {
      pool.material.opacity = (0.62 + ctx.fade * 0.28);
      if (ctx.reduced) { sheen.material.opacity = 0.25; glint.material.opacity = 0.12; return; }
      const s = ctx.time || 0;
      sheen.rotation.z = s * 0.3; sheen.material.color.setHSL((s * 0.05) % 1, 0.6, 0.6); sheen.material.opacity = 0.3 + ctx.fade * 0.15;
      glint.position.set(Math.cos(s * 0.5) * r * 0.42, 0.045, Math.sin(s * 0.5) * r * 0.42);
      glint.material.opacity = 0.12 + Math.abs(Math.sin(s * 0.8)) * 0.2;
    });
  },
  // Rain: obvious vertical falling streaks over a wet slick, with splash ripples.
  Wet(reduced, r, c) {
    const g = new THREE.Group();
    const pool = mesh(G.disc(), matBasic(c.trail, 0.42, false)); pool.rotation.x = -Math.PI / 2; pool.scale.setScalar(r); pool.position.y = 0.02; g.add(pool);
    // Falling rain drawn as one LineSegments — every pair is a short vertical drop.
    const drops = reduced ? 0 : 28;
    const arr = new Float32Array(Math.max(1, drops) * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const rain = new THREE.LineSegments(bg, lineMat(c.core, 0.6)); rain.frustumCulled = false; g.add(rain);
    const rnd = mulberry(101);
    const dx = [], dz = [], dp = [];
    for (let i = 0; i < drops; i++) { dx.push((rnd() * 2 - 1) * r); dz.push((rnd() * 2 - 1) * r); dp.push(rnd()); }
    // Splash ripple rings that pop at scattered ground points where drops land.
    const ripples = [];
    const nR = reduced ? 2 : 5;
    for (let i = 0; i < nR; i++) {
      const rp = mesh(G.ring(), matBasic(c.glow, 0.55)); rp.rotation.x = -Math.PI / 2; rp.position.y = 0.05;
      rp.userData = { bx: (rnd() * 2 - 1) * r * 0.85, bz: (rnd() * 2 - 1) * r * 0.85, ph: i / nR };
      rp.position.x = rp.userData.bx; rp.position.z = rp.userData.bz; g.add(rp); ripples.push(rp);
    }
    const FALL = 2.6, STREAK = 0.55;
    return zoneHandle('Wet', g, (ctx) => {
      pool.material.opacity = 0.24 + ctx.fade * 0.22;
      if (ctx.reduced) { for (const rp of ripples) { rp.scale.setScalar(r * 0.4); rp.material.opacity = 0.35; } return; }
      const s = ctx.time || 0;
      for (let i = 0; i < drops; i++) {
        const ph = (dp[i] + s * 0.95) % 1;         // 0 = high, 1 = ground
        const yb = FALL * (1 - ph), o = i * 6;
        arr[o] = dx[i]; arr[o + 1] = yb + STREAK; arr[o + 2] = dz[i];
        arr[o + 3] = dx[i]; arr[o + 4] = yb; arr[o + 5] = dz[i];
      }
      bg.attributes.position.needsUpdate = true;
      for (let i = 0; i < ripples.length; i++) {
        const ph = (s * 0.9 + ripples[i].userData.ph) % 1;
        ripples[i].scale.setScalar(r * (0.12 + ph * 0.5));
        ripples[i].material.opacity = 0.55 * (1 - ph) * (0.4 + ctx.fade * 0.6);
      }
    });
  },
  // Fog: a dense, drifting grey bank of overlapping puffs — capped so the enemy
  // silhouette and threat outlines always stay legible through it.
  Fog(reduced, r, c) {
    const g = new THREE.Group();
    const grey = 0x9aa3b2, greyHi = 0xc4ccd8;
    const ground = mesh(G.disc(), matBasic(grey, 0.16, false)); ground.rotation.x = -Math.PI / 2; ground.scale.setScalar(r); ground.position.y = 0.05; g.add(ground);
    const layers = [];
    const n = reduced ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const puff = mesh(G.ballHi(), matBasic(i % 2 ? greyHi : grey, 0.16, false));
      const sx = r * (0.72 + (i % 3) * 0.16);
      puff.scale.set(sx, 0.46 + (i % 2) * 0.18, sx);
      const bx = (i / Math.max(1, n - 1) - 0.5) * 1.7 * r;
      const bz = (((i * 37) % 100) / 100 - 0.5) * 0.9 * r;
      puff.position.set(bx, 0.5 + (i % 3) * 0.22, bz);
      puff.userData = { bx, bz, ph: i };
      g.add(puff); layers.push(puff);
    }
    return zoneHandle('Fog', g, (ctx) => {
      const dense = 0.12 + ctx.fade * 0.08;   // hard cap keeps the duel readable
      ground.material.opacity = dense * 0.85;
      const s = ctx.time || 0;
      for (let i = 0; i < layers.length; i++) {
        layers[i].material.opacity = dense;
        if (!ctx.reduced) {
          layers[i].position.x = layers[i].userData.bx + Math.sin(s * 0.25 + layers[i].userData.ph) * 0.3 * r;
          layers[i].position.z = layers[i].userData.bz + Math.cos(s * 0.2 + layers[i].userData.ph) * 0.2 * r;
        }
      }
    });
  },
  // Frozen ground: a frosty blue-white sheet with a slow sheen and ice crystals.
  Frozen(reduced, r, c) {
    const g = new THREE.Group();
    const sheet = mesh(G.disc(), matBasic(0xcfe9ff, 0.5, false)); sheet.rotation.x = -Math.PI / 2; sheet.scale.setScalar(r); sheet.position.y = 0.03; g.add(sheet);
    const sheen = mesh(G.ring(), matBasic(0xffffff, 0.4, true)); sheen.rotation.x = -Math.PI / 2; sheen.scale.setScalar(r); sheen.position.y = 0.045; g.add(sheen);
    const rnd = mulberry(53);
    for (let i = 0; i < (reduced ? 4 : 8); i++) {
      const sc = 0.1 + rnd() * 0.08;
      const x = mesh(G.octa(), matSolid(0xdff2ff, { emissive: 0x6fb7e8, emissiveIntensity: 0.4, flat: true, roughness: 0.2 }));
      x.scale.setScalar(sc); x.position.set((rnd() * 2 - 1) * r * 0.85, sc * 0.6, (rnd() * 2 - 1) * r * 0.85); x.rotation.y = rnd() * Math.PI; g.add(x);
    }
    return zoneHandle('Frozen', g, (ctx) => {
      sheet.material.opacity = 0.35 + ctx.fade * 0.25;
      sheen.material.opacity = 0.22 + ctx.fade * 0.18;
      if (!ctx.reduced) sheen.rotation.z = (ctx.time || 0) * 0.2;
    });
  },
  Snare(reduced, r, c) {
    const g = new THREE.Group();
    const rr = Math.min(r, 1.3);
    const tri = paramLine(3, (u) => { const a = u * Math.PI * 2 + Math.PI / 2; return [Math.cos(a) * rr, 0.05, Math.sin(a) * rr]; }, c.glow, 0.9, true);
    g.add(tri.line);
    const inner = mesh(G.ring(), matBasic(c.core, 0.7)); inner.rotation.x = -Math.PI / 2; inner.scale.setScalar(rr * 0.5); inner.position.y = 0.05; g.add(inner);
    return zoneHandle('Snare', g, (ctx) => {
      const p = 0.6 + (ctx.reduced ? 0.3 : Math.abs(Math.sin((ctx.time || 0) * 3)) * 0.4);
      tri.line.material.opacity = p; inner.material.opacity = p * 0.8;
      if (!ctx.reduced) inner.rotation.z = (inner.rotation.z || 0) + (ctx.dtMs || 16) * 0.001;
    });
  },
  Cover(reduced, r, c) {
    const g = new THREE.Group();
    const cols = [-0.55, 0, 0.55];
    for (let i = 0; i < cols.length; i++) {
      const h = 1.0 + (i === 1 ? 0.25 : 0);
      const col = mesh(G.box(), matSolid(c.glow, { roughness: 1, flat: true }));
      col.scale.set(0.5, h, 0.5); col.position.set(cols[i], h / 2, (i - 1) * 0.08); col.rotation.y = (i - 1) * 0.2; g.add(col);
      const cap = mesh(G.tetra(), matSolid(c.core, { roughness: 1, flat: true })); cap.scale.set(0.3, 0.3, 0.3); cap.position.set(cols[i], h + 0.05, 0); cap.rotation.y = i; g.add(cap);
    }
    return zoneHandle('Cover', g, () => {});
  },
  Hourglass(reduced, r, c) {
    const g = new THREE.Group();
    const glass = new THREE.Group();
    const top = mesh(G.cone(), matBasic(c.glow, 0.4, false)); top.scale.set(0.55, 0.6, 0.55); top.position.y = 1.2; top.rotation.x = Math.PI; glass.add(top);
    const bot = mesh(G.cone(), matBasic(c.glow, 0.4, false)); bot.scale.set(0.55, 0.6, 0.55); bot.position.y = 0.6; glass.add(bot);
    const frame = paramLine(2, (u) => [0, 0.3 + u * 1.2, 0], c.core, 0.6, false); glass.add(frame.line);
    g.add(glass);
    const rings = [];
    for (let i = 0; i < 3; i++) { const rg = mesh(G.torus(), matBasic(c.core, 0.6)); rg.rotation.x = -Math.PI / 2; rg.scale.setScalar(r * (0.55 + i * 0.28)); rg.position.y = 0.05; g.add(rg); rings.push(rg); }
    // Sand motes that drift SLOWLY down through the neck — the time-warp read.
    const motes = makePoints(reduced ? 0 : 16, c.core, 0.32, reduced); if (motes.count) g.add(motes.pts);
    return zoneHandle('Hourglass', g, (ctx) => {
      const s = ctx.time || 0;
      // Rings breathe in/out to signal warped, dilated time.
      for (let i = 0; i < rings.length; i++) {
        const warp = ctx.reduced ? 1 : (1 + Math.sin(s * 0.6 + i) * 0.12);
        rings[i].scale.setScalar(r * (0.55 + i * 0.28) * warp);
        rings[i].material.opacity = 0.4 + ctx.fade * 0.3;
        if (!ctx.reduced) rings[i].rotation.z = s * (0.25 - i * 0.12);
      }
      if (!ctx.reduced) glass.rotation.y = s * 0.35;
      for (let i = 0; i < motes.count; i++) {
        const a = i / motes.count;
        const fall = ((a + s * 0.06) % 1);              // deliberately slow descent
        const pinch = 1 - Math.abs(fall - 0.5) * 1.2;   // narrow at the neck
        motes.positions[i * 3] = Math.cos(a * 8 + s * 0.3) * r * 0.7 * pinch;
        motes.positions[i * 3 + 1] = 0.3 + (1 - fall) * 1.5;
        motes.positions[i * 3 + 2] = Math.sin(a * 8 + s * 0.3) * r * 0.7 * pinch;
      }
      if (motes.count) motes.geometry.attributes.position.needsUpdate = true;
    });
  },
  // Visibly burning: charred ground, flickering flame tongues, rising embers.
  Fire(reduced, r, c) {
    const g = new THREE.Group();
    const disc = mesh(G.disc(), matBasic(0x3a1206, 0.5, true)); disc.rotation.x = -Math.PI / 2; disc.scale.setScalar(r); disc.position.y = 0.03; g.add(disc);
    const rnd = mulberry(71);
    const tongues = [];
    for (let i = 0; i < (reduced ? 4 : 9); i++) {
      const t = mesh(G.cone(), matBasic(i % 2 ? c.glow : c.core, 0.85));
      const tx = (rnd() * 2 - 1) * r * 0.8, tz = (rnd() * 2 - 1) * r * 0.8;
      t.scale.set(0.18, 0.7, 0.18); t.position.set(tx, 0.4, tz); t.userData = { ph: rnd() * 6 };
      g.add(t); tongues.push(t);
    }
    const embers = makePoints(reduced ? 0 : 16, 0xffb347, 0.32, reduced); if (embers.count) g.add(embers.pts);
    return zoneHandle('Fire', g, (ctx) => {
      const s = ctx.time || 0; disc.material.opacity = 0.35 + ctx.fade * 0.3;
      if (ctx.reduced) return;
      for (let i = 0; i < tongues.length; i++) {
        const f = 0.6 + Math.abs(Math.sin(s * 11 + tongues[i].userData.ph)) * 0.7;
        tongues[i].scale.y = 0.7 * f; tongues[i].scale.x = tongues[i].scale.z = 0.18 * (0.85 + Math.sin(s * 9 + i) * 0.15);
      }
      for (let i = 0; i < embers.count; i++) {
        const a = i / embers.count, ph = (a + s * 0.7) % 1;
        embers.positions[i * 3] = (a * 2 - 1) * r * 0.8 * (1 - ph * 0.3);
        embers.positions[i * 3 + 1] = 0.2 + ph * 1.9;
        embers.positions[i * 3 + 2] = Math.sin(a * 20) * r * 0.6;
      }
      if (embers.count) embers.geometry.attributes.position.needsUpdate = true;
    });
  },
  // A curved wind wall that sweeps back and forth with streaks flowing along it.
  Gust(reduced, r, c) {
    const g = new THREE.Group();
    const bank = new THREE.Group(); g.add(bank);
    const shell = mesh(ownBuffer(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 1.7, 18, 1, true, -0.95, 1.9)), matBasic(c.glow, 0.2, true));
    shell.position.y = 0.85; bank.add(shell);
    const shell2 = mesh(ownBuffer(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 1.45, 18, 1, true, -0.85, 1.7)), matBasic(c.core, 0.14, true));
    shell2.position.y = 0.78; bank.add(shell2);
    const streaks = [];
    for (let i = 0; i < (reduced ? 0 : 4); i++) {
      const yy = 0.35 + i * 0.34;
      const sl = paramLine(16, (u) => { const a = -0.9 + u * 1.8; return [Math.sin(a) * r * 0.88, yy + Math.sin(u * 6 + i) * 0.06, Math.cos(a) * r * 0.88]; }, c.core, 0.7, false);
      bank.add(sl.line); streaks.push(sl);
    }
    return zoneHandle('Gust', g, (ctx) => {
      shell.material.opacity = 0.14 + ctx.fade * 0.16;
      shell2.material.opacity = 0.1 + ctx.fade * 0.12;
      if (ctx.reduced) return;
      const s = ctx.time || 0;
      bank.rotation.y = Math.sin(s * 0.7) * 0.6;             // the wall sweeps across
      for (let i = 0; i < streaks.length; i++) streaks[i].line.material.opacity = 0.35 + Math.abs(Math.sin(s * 2.2 + i)) * 0.45;
    });
  },
  Grounded(reduced, r, c) {
    const g = new THREE.Group();
    const plate = mesh(G.ring(), matBasic(c.glow, 0.5, false)); plate.rotation.x = -Math.PI / 2; plate.scale.setScalar(r * 0.9); plate.position.y = 0.03; g.add(plate);
    const spokes = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const ln = paramLine(2, (u) => [Math.cos(a) * r * 0.9 * u, 0.05, Math.sin(a) * r * 0.9 * u], c.core, 0.6, false); g.add(ln.line); spokes.push(ln); }
    return zoneHandle('Grounded', g, (ctx) => {
      plate.material.opacity = 0.35 + ctx.fade * 0.2;
      const pulse = ctx.reduced ? 0.5 : 0.4 + Math.abs(Math.sin((ctx.time || 0) * 2)) * 0.35;
      for (const sp of spokes) sp.line.material.opacity = pulse;
    });
  },
};

export function makeZoneVfx(kind, reduced, radiusWorld) {
  const c = VFX_SCHOOL_PALETTE[({
    Oil: 'Ember', Wet: 'Tide', Fog: 'Gale', Frozen: 'Tide', Snare: 'Arcane',
    Cover: 'Stone', Hourglass: 'Arcane', Fire: 'Ember', Gust: 'Gale', Grounded: 'Stone',
  })[kind] || 'Arcane'];
  const build = ZONE_BUILDERS[kind];
  if (build) return build(reduced, Math.max(0.8, radiusWorld || 2.4), c);
  // fallback: distinct-enough soft ring
  const g = new THREE.Group();
  const ring = mesh(G.ring(), matBasic(c.glow, 0.5)); ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(radiusWorld || 2.4); ring.position.y = 0.04; g.add(ring);
  return zoneHandle(kind || 'zone', g, (ctx) => { ring.material.opacity = 0.25 + (ctx.fade || 0) * 0.35; });
}

// ==========================================================================
//  DEFENSIVE / CHANNEL — Ward, Barrier Dome, Prismatic Beam.
// ==========================================================================

const _yAxis = new THREE.Vector3(0, 1, 0);
function orientBetween(obj, from, to) {
  _v.copy(to).sub(from);
  const len = _v.length();
  obj.position.copy(from).addScaledVector(_v, 0.5);
  if (len > 1e-6) obj.quaternion.setFromUnitVectors(_yAxis, _dir.copy(_v).normalize());
  return len;
}

export function makeWardVfx(reduced) {
  const c = VFX_SCHOOL_PALETTE.Arcane;
  const g = new THREE.Group();
  const disc = mesh(G.disc(), matBasic(c.glow, 0.22, true)); disc.scale.setScalar(1.1); g.add(disc);
  const hex = paramLine(6, (u) => { const a = u * Math.PI * 2 + Math.PI / 6; return [Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0]; }, c.core, 0.9, true); g.add(hex.line);
  const inner = paramLine(6, (u) => { const a = u * Math.PI * 2 + Math.PI / 6; return [Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0]; }, c.core, 0.7, true); g.add(inner.line);
  const runes = new THREE.Group();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const r = mesh(G.plane(), matBasic(c.core, 0.6)); r.scale.set(0.08, 0.28, 1); r.position.set(Math.cos(a) * 0.92, Math.sin(a) * 0.92, 0.01); r.rotation.z = a; runes.add(r); }
  g.add(runes);
  return {
    object3D: g, kind: 'ward', family: 'ward',
    update(ctx) {
      const st = ctx.strength ?? 1;
      disc.material.opacity = (0.12 + st * 0.16) * (reduced ? 1 : (0.85 + Math.sin((ctx.time || 0) * 4) * 0.15));
      hex.line.material.opacity = 0.5 + st * 0.4; inner.line.material.opacity = 0.4 + st * 0.3;
      if (!reduced) runes.rotation.z = (ctx.time || 0) * 0.6;
    },
    dispose() { disposeTree(g); },
  };
}

export function makeDomeVfx(reduced) {
  const c = VFX_SCHOOL_PALETTE.Arcane;
  const g = new THREE.Group();
  const shell = mesh(G.ballHi(), matBasic(c.glow, 0.14, true)); shell.scale.setScalar(1.5); g.add(shell);
  const inner = mesh(G.ballHi(), matBasic(c.core, 0.08, true)); inner.scale.setScalar(1.2); g.add(inner);
  const rings = [];
  for (let i = 0; i < 3; i++) { const r = mesh(G.torus(), matBasic(c.core, 0.5)); r.scale.setScalar(1.5); r.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0); g.add(r); rings.push(r); }
  return {
    object3D: g, kind: 'barrierDome', family: 'dome',
    update(ctx) {
      const st = ctx.strength ?? 1;
      shell.material.opacity = (0.1 + st * 0.1) * (reduced ? 1 : (0.85 + Math.sin((ctx.time || 0) * 3) * 0.15));
      if (!reduced) { const s = ctx.time || 0; rings[0].rotation.z = s * 0.5; rings[1].rotation.x = s * 0.4; rings[2].rotation.y = s * 0.6; }
    },
    dispose() { disposeTree(g); },
  };
}

// Persistent Reflect state visual — the standing counterpart to Ward, shown for
// the whole 3.6s Reflect window (both duelists) and hidden the instant a
// projectile consumes it. Deliberately DISTINCT from Ward's flat Arcane rune
// disc: an angled, faceted MIRROR pane on a Gale/silver palette with a sharp
// rotated-diamond silhouette, a rotating rune-edge of mirrored facets, and a
// central reflection chevron. Kept translucent + rim-lit so it reads as a
// glinting deflection plane without masking the opponent or the draw pad.
export function makeReflectGuardVfx(reduced) {
  const c = VFX_SCHOOL_PALETTE.Gale;
  const silver = 0xd6e4ea;
  const g = new THREE.Group();

  // Slanted mirror pane: a plane turned 45° into a diamond and tilted back, so
  // it reads as an angled reflective surface rather than a frontal disc.
  const pane = mesh(G.plane(), matBasic(silver, 0.13, true));
  pane.scale.set(1.7, 1.7, 1); pane.rotation.set(0.18, 0, Math.PI / 4); g.add(pane);

  // Sharp diamond silhouette (outer) + a nested inner diamond for depth.
  const diamond = paramLine(4, (u) => { const a = u * Math.PI * 2 + Math.PI / 2; return [Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0]; }, c.core, 0.95, true); g.add(diamond.line);
  const inner = paramLine(4, (u) => { const a = u * Math.PI * 2 + Math.PI / 2; return [Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0]; }, silver, 0.7, true); g.add(inner.line);

  // Rotating rune-edge: mirrored chevron facets set tangent to the rim. They
  // spin opposite Ward's runes so the two guards never read the same in motion.
  const facets = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const f = mesh(G.plane(), matBasic(c.glow, 0.55)); f.scale.set(0.42, 0.1, 1);
    f.position.set(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0.02); f.rotation.z = a + Math.PI / 2; facets.add(f);
  }
  g.add(facets);

  // Central reflection chevron (two angled bars meeting at a point) — the mark
  // that visually distinguishes a deflection plane from a solid shield.
  const chevron = new THREE.Group();
  for (const s of [-1, 1]) {
    const bar = mesh(G.plane(), matBasic(c.core, 0.6)); bar.scale.set(0.08, 0.62, 1);
    bar.position.set(s * 0.2, 0, 0.03); bar.rotation.z = s * 0.6; chevron.add(bar);
  }
  g.add(chevron);

  return {
    object3D: g, kind: 'reflectGuard', family: 'reflectGuard',
    update(ctx) {
      const st = ctx.strength ?? 1;
      const shimmer = reduced ? 1 : (0.78 + Math.sin((ctx.time || 0) * 5.5) * 0.22);
      pane.material.opacity = (0.09 + st * 0.11) * shimmer;
      diamond.line.material.opacity = 0.55 + st * 0.4; inner.line.material.opacity = 0.4 + st * 0.3;
      for (const f of facets.children) f.material.opacity = 0.35 + st * 0.35;
      if (!reduced) { const s = ctx.time || 0; facets.rotation.z = -s * 0.9; chevron.rotation.z = Math.sin(s * 2.4) * 0.06; }
    },
    dispose() { disposeTree(g); },
  };
}

export function makeBeamVfx(spellId, reduced) {
  const profile = getSpellVfx(spellId) || { colors: VFX_SCHOOL_PALETTE.Prismatic };
  const c = profile.colors;
  const g = new THREE.Group();
  const beam = mesh(G.cyl(), matBasic(c.core, 0.6, true)); g.add(beam);
  const halo = mesh(G.cyl(), matBasic(c.glow, 0.25, true)); g.add(halo);
  const endGlow = glow(0.35, c.core, 0.8); g.add(endGlow);
  const rings = [];
  if (!reduced) for (let i = 0; i < 4; i++) { const r = mesh(G.torus(), matBasic(c.glow, 0.7)); r.scale.setScalar(0.24); g.add(r); rings.push(r); }
  return {
    object3D: g, kind: 'prismaticBeam', family: 'beam',
    update(ctx) {
      const from = ctx.from, to = ctx.to; if (!from || !to) return;
      const len = orientBetween(beam, from, to); beam.scale.set(0.07, len, 0.07);
      halo.position.copy(beam.position); halo.quaternion.copy(beam.quaternion); halo.scale.set(0.16, len, 0.16);
      endGlow.position.copy(to);
      const s = ctx.time || 0;
      if (!reduced) {
        const hue = (s * 0.25) % 1; beam.material.color.setHSL(hue, 1, 0.7); halo.material.color.setHSL((hue + 0.4) % 1, 1, 0.6);
        for (let i = 0; i < rings.length; i++) {
          const ph = (s * 0.8 + i / rings.length) % 1;
          rings[i].position.copy(from).lerp(to, ph); rings[i].quaternion.copy(beam.quaternion);
          rings[i].rotation.x += Math.PI / 2; rings[i].material.color.setHSL((hue + ph) % 1, 1, 0.65);
          rings[i].material.opacity = 0.7 * (1 - Math.abs(ph - 0.5) * 0.6);
        }
        endGlow.scale.setScalar(0.35 * (1 + Math.sin(s * 20) * 0.2));
      }
    },
    dispose() { disposeTree(g); },
  };
}

// ==========================================================================
//  CAST WINDUP CUE — school + spell-specific "charging" tell at the caster.
// ==========================================================================

export function makeCastCueVfx(spellId, reduced, opts = {}) {
  const profile = getSpellVfx(spellId) || { colors: VFX_SCHOOL_PALETTE.Arcane, school: 'Arcane', windup: 'arcane-converge' };
  const c = profile.colors;
  const g = new THREE.Group();
  const core = glow(0.12, c.core, 0.5); g.add(core);
  const motes = makePoints(reduced ? 0 : 14, c.glow, 0.35, reduced); if (motes.count) g.add(motes.pts);
  let ground = null, ctrl = null;
  if (opts.heavy) { ground = mesh(G.ring(), matBasic(c.glow, 0.5)); ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; ground.scale.setScalar(0.6); g.add(ground); }
  if (opts.control && !reduced) { ctrl = paramLine(3, (u) => { const a = u * Math.PI * 2; return [Math.cos(a) * 0.35, Math.sin(a) * 0.35, 0]; }, c.core, 0.7, true); g.add(ctrl.line); }
  const rise = profile.school === 'Ember' ? 1 : profile.school === 'Umbra' ? -1 : 0;
  return {
    object3D: g, kind: 'cue:' + profile.kind, family: 'castcue',
    update(ctx) {
      const prog = ctx.prog ?? 0, s = ctx.time || 0;
      core.scale.setScalar(0.1 + prog * 0.18); core.material.opacity = 0.4 + prog * 0.5;
      if (reduced) return;
      for (let i = 0; i < motes.count; i++) {
        const a = i / motes.count;
        const rad = (1 - prog) * 0.5 + 0.12 + Math.sin(s * 6 + a * 20) * 0.03;
        const ang = a * Math.PI * 2 + s * (2 + prog * 4);
        motes.positions[i * 3] = Math.cos(ang) * rad;
        motes.positions[i * 3 + 1] = Math.sin(ang) * rad * 0.6 + rise * (a - 0.5) * 0.4;
        motes.positions[i * 3 + 2] = Math.sin(ang) * rad;
      }
      if (motes.count) motes.geometry.attributes.position.needsUpdate = true;
      if (ground) { ground.scale.setScalar(0.5 + prog * 0.5); ground.rotation.z = s; ground.material.opacity = 0.3 + prog * 0.4; }
      if (ctrl) { ctrl.line.rotation.z = -s * 2; ctrl.line.material.opacity = 0.4 + prog * 0.4; }
    },
    dispose() { disposeTree(g); },
  };
}

// ==========================================================================
//  INSTANT RELEASE EFFECTS — event-driven cast/hex/buff/control/secret VFX.
// ==========================================================================

const RELEASE_HEIGHT = {
  mark: 2.35, entangle: 0.1, frostbind: 1.2, grounding: 0.9, sunder: 1.4,
  eclipse: 1.6, weaken: 1.5, sloth: 1.4, veil: 1.4, leech: 1.4, blink: 1.1,
  mirror: 0.0, phoenix: 0.9, haste: 1.0, surge: 1.1, attunement: 0.9,
  reflect: 1.3, dispel: 1.0,
};

const RELEASE_BUILDERS = {
  reflect(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const plane = mesh(G.plane(), matBasic(c.core, 0.85, true)); plane.scale.set(1.4, 1.8, 1); g.add(plane);
    const edge = paramLine(4, (u) => { const a = u * Math.PI * 2 + Math.PI / 4; return [Math.cos(a) * 1.0, Math.sin(a) * 1.3, 0]; }, c.glow, 0.9, true); g.add(edge.line);
    const ring = ringMesh(c.core, 0.7); g.add(ring);
    return transient('reflect', 'reflect', g, reduced ? 260 : 420, (t) => {
      plane.material.opacity = 0.85 * (1 - t) * (t < 0.2 ? t * 5 : 1);
      edge.line.material.opacity = 0.9 * (1 - t);
      ring.scale.setScalar(0.4 + t * 1.4); ring.material.opacity = 0.7 * (1 - t);
    }, { billboard: true });
  },
  dispel(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const ring = mesh(G.ring(), matBasic(c.glow, 0.85)); ring.rotation.x = -Math.PI / 2; g.add(ring);
    const ring2 = mesh(G.ring(), matBasic(c.core, 0.6)); ring2.rotation.x = -Math.PI / 2; g.add(ring2);
    const motes = makePoints(reduced ? 0 : 14, c.core, 0.35, reduced); if (motes.count) g.add(motes.pts);
    return transient('dispel', 'dispel', g, reduced ? 320 : 700, (t, age, ctx) => {
      const e = 1 - (1 - t) * (1 - t);
      ring.scale.setScalar(0.3 + e * 1.4); ring.material.opacity = 0.85 * (1 - t); ring.rotation.z = t * 4; // CCW
      ring2.scale.setScalar(0.3 + e * 1.0); ring2.material.opacity = 0.6 * (1 - t); ring2.rotation.z = t * 5;
      for (let i = 0; i < motes.count; i++) { const a = i / motes.count; const rad = (1 - t) * 1.2; const ang = a * Math.PI * 2 - t * 6; motes.positions[i * 3] = Math.cos(ang) * rad; motes.positions[i * 3 + 1] = (1 - t) * 1.4; motes.positions[i * 3 + 2] = Math.sin(ang) * rad; }
      if (motes.count) motes.geometry.attributes.position.needsUpdate = true;
    });
  },
  blink(p, reduced, to) {
    const c = p.colors, g = new THREE.Group();
    const a = decoyFigure(c.glow, 0.5); g.add(a);
    const b = decoyFigure(c.core, 0.5); if (to) b.position.copy(to); g.add(b);
    let streak = null;
    if (to && !reduced) { streak = paramLine(2, (u) => [to.x * u, 1.0, to.z * u], c.core, 0.8, false); g.add(streak.line); }
    return transient('blink', 'blink', g, reduced ? 240 : 420, (t) => {
      a.traverse((o) => { if (o.material) o.material.opacity = 0.5 * (1 - t); });
      b.traverse((o) => { if (o.material) o.material.opacity = 0.5 * t; });
      if (streak) streak.line.material.opacity = 0.8 * (1 - t);
    });
  },
  haste(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const streaks = [];
    for (let i = 0; i < (reduced ? 2 : 4); i++) { const sl = paramLine(16, (u) => { const a = u * Math.PI * 3 + i; return [Math.cos(a) * 0.8, u * 1.6, Math.sin(a) * 0.8]; }, i % 2 ? c.core : c.glow, 0.7, false); g.add(sl.line); streaks.push(sl); }
    return transient('haste', 'haste', g, reduced ? 500 : 1200, (t, age, ctx) => {
      const s = ctx.time || 0; const o = (t < 0.2 ? t * 5 : 1) * (1 - t);
      for (let i = 0; i < streaks.length; i++) { streaks[i].line.rotation.y = s * (3 + i) ; streaks[i].line.material.opacity = 0.7 * o; }
    });
  },
  surge(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const eights = [];
    for (let i = 0; i < 2; i++) {
      const e = paramLine(40, (u) => { const a = u * Math.PI * 2; return [Math.sin(a) * 0.6, Math.sin(a * 2) * 0.5 + 0.9, 0]; }, i ? c.glow : c.core, 0.85, true);
      e.line.rotation.y = i * Math.PI / 2; g.add(e.line); eights.push(e);
    }
    const motes = makePoints(reduced ? 0 : 16, c.core, 0.35, reduced); if (motes.count) g.add(motes.pts);
    return transient('aetherSurge', 'surge', g, reduced ? 600 : 1400, (t, age, ctx) => {
      const s = ctx.time || 0; const o = (t < 0.15 ? t / 0.15 : 1) * (1 - t * t);
      for (let i = 0; i < eights.length; i++) { eights[i].line.rotation.y = i * Math.PI / 2 + s * 1.5; eights[i].line.material.opacity = 0.85 * o; }
      for (let i = 0; i < motes.count; i++) { const a = i / motes.count; motes.positions[i * 3] = Math.sin(a * 12 + s) * 0.5; motes.positions[i * 3 + 1] = ((a + s * 0.1) % 1) * 1.8; motes.positions[i * 3 + 2] = Math.cos(a * 12 + s) * 0.5; }
      if (motes.count) motes.geometry.attributes.position.needsUpdate = true;
    });
  },
  mark(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const ring = mesh(G.ring(), matBasic(c.glow, 0.9)); ring.scale.setScalar(0.6); g.add(ring);
    const cross = paramLine(2, (u) => [(u - 0.5) * 1.2, 0, 0], c.core, 0.9, false); g.add(cross.line);
    const cross2 = paramLine(2, (u) => [0, (u - 0.5) * 1.2, 0], c.core, 0.9, false); g.add(cross2.line);
    const chevrons = [];
    for (let i = 0; i < 3; i++) { const ch = mesh(G.cone4(), matBasic(c.core, 0.8)); ch.scale.set(0.14, 0.2, 0.14); ch.position.set(0, 0.7 - i * 0.15, 0); ch.rotation.z = Math.PI; g.add(ch); chevrons.push(ch); }
    return transient('amplifyMark', 'mark', g, reduced ? 900 : 1600, (t, age, ctx) => {
      const s = ctx.time || 0; const o = (t < 0.1 ? t * 10 : 1) * (t > 0.8 ? (1 - t) * 5 : 1);
      ring.rotation.z = reduced ? 0 : s * 1.2; ring.material.opacity = 0.9 * o;
      cross.line.material.opacity = cross2.line.material.opacity = 0.9 * o;
      for (let i = 0; i < chevrons.length; i++) chevrons[i].material.opacity = 0.8 * o * (reduced ? 1 : (0.5 + Math.abs(Math.sin(s * 4 - i)) * 0.5));
    }, { billboard: true });
  },
  attunement(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const ring = mesh(G.ring(), matBasic(c.glow, 0.6)); ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(0.9); g.add(ring);
    const sigils = [];
    for (let i = 0; i < (reduced ? 3 : 6); i++) { const sg = glow(0.09, i % 2 ? c.core : c.glow, 0.85); g.add(sg); sigils.push(sg); }
    return transient('emberAttunement', 'attunement', g, reduced ? 700 : 1400, (t, age, ctx) => {
      const s = ctx.time || 0; const o = (1 - t);
      ring.material.opacity = 0.6 * o;
      for (let i = 0; i < sigils.length; i++) { const a = i / sigils.length; const ang = a * Math.PI * 2 + (reduced ? 0 : s * 2); sigils[i].position.set(Math.cos(ang) * 0.9, 0.9 + Math.sin(s * 3 + a * 6) * 0.15, Math.sin(ang) * 0.9); sigils[i].material.opacity = 0.85 * o; }
    });
  },
  grounding(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const ring = mesh(G.ring(), matBasic(c.glow, 0.6)); ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(0.9); g.add(ring);
    const plates = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const pl = mesh(G.box(), matSolid(c.glow, { roughness: 1, flat: true })); pl.scale.set(0.28, 0.5, 0.12); pl.position.set(Math.cos(a) * 0.7, 0.25, Math.sin(a) * 0.7); pl.rotation.y = -a; g.add(pl); plates.push(pl); const ln = paramLine(2, (u) => [Math.cos(a) * 0.7, u * 0.5, Math.sin(a) * 0.7], c.core, 0.6, false); g.add(ln.line); }
    return transient('groundingMantle', 'grounding', g, reduced ? 700 : 1400, (t) => {
      const o = (t < 0.2 ? t * 5 : 1) * (1 - t * t);
      ring.material.opacity = 0.6 * o; for (const pl of plates) { pl.material.opacity = o; pl.material.transparent = true; }
    });
  },
  weaken(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const arc = paramLine(20, (u) => [(u - 0.5) * 1.4, -Math.sin(u * Math.PI) * 0.5 + 0.2, 0], c.glow, 0.85, false); g.add(arc.line);
    const aura = glow(0.5, c.core, 0.35); g.add(aura);
    return transient('weaken', 'weaken', g, reduced ? 600 : 1200, (t, age, ctx) => {
      const o = (t < 0.15 ? t / 0.15 : 1) * (1 - t);
      arc.line.material.opacity = 0.85 * o; arc.line.position.y = -t * 0.3;
      aura.material.opacity = 0.35 * o; aura.position.y = -t * 0.3;
    }, { billboard: true });
  },
  sunder(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const rnd = mulberry(22);
    const cracks = [];
    for (let i = 0; i < 2; i++) {
      const arr = new Float32Array(4 * 2 * 3); const bg = ownBuffer(new THREE.BufferGeometry()); bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const ang = i ? Math.PI / 4 : -Math.PI / 4;
      fillJagged(arr, 0, _v.set(-Math.cos(ang) * 0.8, -Math.sin(ang) * 0.8, 0), new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang) * 0.8, 0), 4, 0.18, rnd);
      bg.attributes.position.needsUpdate = true; const ls = new THREE.LineSegments(bg, lineMat(i ? c.glow : c.core, 0.95)); ls.frustumCulled = false; g.add(ls); cracks.push(ls);
    }
    return transient('sunder', 'sunder', g, reduced ? 380 : 700, (t) => {
      const sc = 0.5 + t * 0.8; g.scale.setScalar(sc);
      for (const cr of cracks) cr.material.opacity = 0.95 * (1 - t);
    }, { billboard: true });
  },
  sloth(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const spiral = paramLine(40, (u) => { const a = u * Math.PI * 5; const r = u * 0.9; return [Math.cos(a) * r, 0, Math.sin(a) * r]; }, c.glow, 0.8, false); spiral.line.rotation.x = -Math.PI / 2; spiral.line.position.y = 0.05; g.add(spiral.line);
    const ring = mesh(G.ring(), matBasic(c.core, 0.6)); ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(0.9); g.add(ring);
    const motes = makePoints(reduced ? 0 : 12, c.core, 0.35, reduced); if (motes.count) g.add(motes.pts);
    return transient('slothHex', 'sloth', g, reduced ? 800 : 1600, (t, age, ctx) => {
      const s = ctx.time || 0; const o = (t < 0.15 ? t / 0.15 : 1) * (1 - t);
      if (!reduced) spiral.line.rotation.z = s * 0.5; spiral.line.material.opacity = 0.8 * o; ring.material.opacity = 0.6 * o;
      for (let i = 0; i < motes.count; i++) { const a = i / motes.count; const ang = a * Math.PI * 2 + s * 0.4; motes.positions[i * 3] = Math.cos(ang) * 0.8; motes.positions[i * 3 + 1] = 0.3; motes.positions[i * 3 + 2] = Math.sin(ang) * 0.8; }
      if (motes.count) motes.geometry.attributes.position.needsUpdate = true;
    });
  },
  leech(p, reduced, to) {
    const c = p.colors, g = new THREE.Group();
    const src = to || new THREE.Vector3(0, 0, -4);
    const ribbon = paramLine(24, (u) => [src.x * (1 - u), Math.sin(u * Math.PI) * 0.5, src.z * (1 - u)], c.glow, 0.7, false); g.add(ribbon.line);
    const motes = makePoints(reduced ? 4 : 12, c.core, 0.4, false); g.add(motes.pts);
    return transient('aetherLeech', 'leech', g, reduced ? 500 : 900, (t, age, ctx) => {
      const s = ctx.time || 0; ribbon.line.material.opacity = 0.7 * (1 - t);
      for (let i = 0; i < motes.count; i++) { const ph = ((s * 1.4 + i / motes.count) % 1); motes.positions[i * 3] = src.x * (1 - ph); motes.positions[i * 3 + 1] = Math.sin(ph * Math.PI) * 0.5; motes.positions[i * 3 + 2] = src.z * (1 - ph); }
      motes.geometry.attributes.position.needsUpdate = true;
    });
  },
  veil(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const knot = new THREE.Group();
    for (let i = 0; i < 2; i++) { const t = mesh(G.torus(), matBasic(i ? c.glow : c.core, 0.6)); t.scale.setScalar(0.6); t.rotation.set(i ? Math.PI / 2 : 0, i ? 0 : Math.PI / 3, 0); knot.add(t); }
    g.add(knot);
    const haze = glow(0.7, c.glow, 0.2); g.add(haze);
    return transient('veilHex', 'veil', g, reduced ? 700 : 1400, (t, age, ctx) => {
      const s = ctx.time || 0; const o = (t < 0.15 ? t / 0.15 : 1) * (1 - t);
      if (!reduced) { knot.rotation.y = s * 1.2; knot.rotation.x = s * 0.6; }
      knot.children.forEach((m) => (m.material.opacity = 0.6 * o)); haze.material.opacity = 0.2 * o;
    });
  },
  entangle(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const roots = [];
    for (let i = 0; i < (reduced ? 4 : 6); i++) {
      const a = (i / 6) * Math.PI * 2;
      const root = paramLine(12, (u) => [Math.cos(a) * (0.7 - u * 0.4) + Math.sin(u * 6 + i) * 0.1, u * 1.6, Math.sin(a) * (0.7 - u * 0.4) + Math.cos(u * 6 + i) * 0.1], c.glow, 0.85, false);
      g.add(root.line); roots.push(root);
    }
    return transient('entangle', 'entangle', g, reduced ? 900 : 1600, (t) => {
      const grow = Math.min(1, t * 2);
      for (const r of roots) { r.line.geometry.setDrawRange(0, Math.max(2, Math.floor(12 * grow))); r.line.material.opacity = 0.85 * (t > 0.7 ? (1 - t) / 0.3 : 1); }
    });
  },
  frostbind(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const rings = [];
    for (let i = 0; i < 3; i++) { const r = mesh(G.torus(), matBasic(c.core, 0.85)); r.rotation.x = Math.PI / 2; r.position.y = (i - 1) * 0.5; g.add(r); rings.push(r); }
    return transient('frostBind', 'frostbind', g, reduced ? 500 : 900, (t) => {
      const snap = t < 0.4 ? (1 - t / 0.4) * 1.2 + 0.35 : 0.35; // start wide, snap tight
      for (let i = 0; i < rings.length; i++) { rings[i].scale.setScalar(snap); rings[i].material.opacity = 0.85 * (1 - t * 0.6); }
    });
  },
  eclipse(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const dark = mesh(G.disc(), matBasic(c.core, 0.85, false)); dark.scale.setScalar(0.6); g.add(dark);
    const halo = mesh(G.ring(), matBasic(c.glow, 0.9)); halo.scale.setScalar(0.7); g.add(halo);
    const spikes = [];
    for (let i = 0; i < (reduced ? 4 : 8); i++) { const a = (i / 8) * Math.PI * 2; const sp = paramLine(2, (u) => [Math.cos(a) * (0.7 + u * 0.6), Math.sin(a) * (0.7 + u * 0.6), 0], c.glow, 0.8, false); g.add(sp.line); spikes.push(sp); }
    return transient('eclipseGlare', 'eclipse', g, reduced ? 600 : 1200, (t, age, ctx) => {
      const o = (t < 0.15 ? t / 0.15 : 1) * (1 - t);
      dark.material.opacity = 0.85 * o; halo.material.opacity = 0.9 * o; halo.scale.setScalar(0.7 + t * 0.5);
      for (let i = 0; i < spikes.length; i++) spikes[i].line.material.opacity = 0.8 * o * (reduced ? 1 : (0.5 + Math.abs(Math.sin((ctx.time || 0) * 5 + i)) * 0.5));
    }, { billboard: true });
  },
  mirror(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const fig = decoyFigure(c.glow, 0.4); g.add(fig);
    const shimmer = glow(0.6, c.core, 0.15); shimmer.position.y = 1.1; g.add(shimmer);
    return transient('mirrorTwin', 'mirror', g, reduced ? 2000 : 3600, (t, age, ctx) => {
      const o = (t < 0.05 ? t * 20 : 1) * (t > 0.85 ? (1 - t) / 0.15 : 1);
      fig.traverse((m) => { if (m.material) m.material.opacity = 0.4 * o * (reduced ? 1 : (0.7 + Math.sin((ctx.time || 0) * 6) * 0.3)); });
      shimmer.material.opacity = 0.15 * o;
    });
  },
  phoenix(p, reduced) {
    const c = p.colors, g = new THREE.Group();
    const wings = [];
    for (let s = -1; s <= 1; s += 2) {
      const wing = paramLine(16, (u) => [s * (0.2 + u * 1.3), 1.0 + Math.sin(u * Math.PI) * 1.1, -Math.cos(u * Math.PI * 0.5) * 0.3], s < 0 ? c.core : c.glow, 0.8, false);
      g.add(wing.line); wings.push(wing);
    }
    const aura = glow(0.8, c.glow, 0.25); aura.position.y = 1.1; g.add(aura);
    const embers = makePoints(reduced ? 0 : 20, c.core, 0.4, reduced); if (embers.count) g.add(embers.pts);
    return transient('phoenixCovenant', 'phoenix', g, reduced ? 2200 : 4200, (t, age, ctx) => {
      const s = ctx.time || 0; const o = (t < 0.06 ? t / 0.06 : 1) * (t > 0.85 ? (1 - t) / 0.15 : 1);
      const flap = reduced ? 1 : (0.85 + Math.sin(s * 4) * 0.15);
      for (const w of wings) { w.line.material.opacity = 0.8 * o; w.line.scale.y = flap; }
      aura.material.opacity = 0.25 * o * (reduced ? 1 : (0.8 + Math.sin(s * 5) * 0.2));
      for (let i = 0; i < embers.count; i++) { const a = i / embers.count; embers.positions[i * 3] = Math.sin(a * 20 + s) * 0.8; embers.positions[i * 3 + 1] = ((a + s * 0.2) % 1) * 2.4; embers.positions[i * 3 + 2] = Math.cos(a * 20 + s) * 0.8; }
      if (embers.count) embers.geometry.attributes.position.needsUpdate = true;
    });
  },
};

export function makeReleaseVfx(spellId, reduced, opts = {}) {
  const profile = getSpellVfx(spellId);
  const build = profile && RELEASE_BUILDERS[profile.family];
  if (!build) return null;
  let localTo = null;
  if (opts.to && opts.from) localTo = opts.to.clone().sub(opts.from);
  const handle = build(profile, reduced, localTo);
  handle.anchorHeight = RELEASE_HEIGHT[profile.family] ?? 1.4;
  handle.target = profile.target;
  return handle;
}

// ==========================================================================
//  ENVIRONMENTAL REACTION VFX — a distinct, disposable signifier per reaction.
//
//  Each builder returns a self-timed transient handle (family 'reaction') that
//  the arena drives through its production effect path (_pushEffect /
//  _updateEffects) with the shared animation clock and retires + disposes when
//  update() returns false. Reduced motion collapses each to a static, readable
//  silhouette. Anchors: builders lay their content around a local GROUND origin
//  (y≈0); airborne/billboard bursts centre their content a little higher.
// ==========================================================================

function groundRing(color, opacity) { const r = ringMesh(color, opacity); r.rotation.x = -Math.PI / 2; return r; }
function groundDisc(color, opacity, additive = true) { const d = discMesh(color, opacity, additive); d.rotation.x = -Math.PI / 2; return d; }

const REACTION_BUILDERS = {
  // ---- ConductiveArc: headline jagged branching lightning between two points --
  arc(profile, reduced, ctx) {
    const c = profile.colors;
    const to = (ctx && ctx.localTo) ? ctx.localTo.clone() : new THREE.Vector3(0, 0, -3);
    const g = new THREE.Group();
    const segs = reduced ? 7 : 12, branchSegs = reduced ? 0 : 5;
    const arr = new Float32Array((segs + branchSegs) * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const bolt = new THREE.LineSegments(bg, lineMat(c.core, 0.95)); bolt.frustumCulled = false; g.add(bolt);
    const capA = glow(0.18, c.core, 0.9); g.add(capA);
    const capB = glow(0.22, c.glow, 0.85); capB.position.copy(to); g.add(capB);
    const from0 = new THREE.Vector3(0, 0, 0);
    const rnd = mulberry(97);
    const rebuild = () => {
      let o = fillJagged(arr, 0, from0, to, segs, Math.min(0.6, to.length() * 0.11 + 0.15), rnd);
      if (branchSegs) {
        const mid = from0.clone().lerp(to, 0.35 + rnd() * 0.3);
        const off = new THREE.Vector3((rnd() - 0.5) * 1.4, 0.4 + rnd() * 0.7, (rnd() - 0.5) * 1.4);
        fillJagged(arr, o, mid, mid.clone().add(off), branchSegs, 0.45, rnd);
      }
      bg.attributes.position.needsUpdate = true;
    };
    rebuild();
    let acc = 0;
    return transient(profile.kind, 'reaction', g, reduced ? 420 : 640, (t, age, cx) => {
      const fade = 1 - t;
      const flick = reduced ? 1 : ((Math.floor(age / 55) % 2) ? 1 : 0.5);
      bolt.material.opacity = 0.95 * fade * flick;
      capA.material.opacity = 0.9 * fade; capB.material.opacity = 0.85 * fade;
      if (reduced) return;
      acc += cx.dtMs || 16; if (acc > 40) { acc = 0; rebuild(); }
    });
  },

  // ---- Doused: water splash ring + rising droplets extinguishing flames -------
  splash(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const ring = groundRing(c.glow, 0.8); ring.position.y = 0.03; g.add(ring);
    const ring2 = groundRing(c.core, 0.6); ring2.position.y = 0.05; g.add(ring2);
    const drops = makePoints(reduced ? 0 : 16, c.core, 0.16, reduced);
    if (drops.count) g.add(drops.pts);
    const seed = [];
    for (let i = 0; i < drops.count; i++) seed.push({ a: (i / drops.count) * Math.PI * 2, r: 0.1 + Math.random() * 0.5, vy: 1.6 + Math.random() * 1.4 });
    return transient(profile.kind, 'reaction', g, reduced ? 380 : 620, (t) => {
      const e = 1 - (1 - t) * (1 - t), fade = 1 - t;
      ring.scale.setScalar(0.3 + e * 2.4); ring.material.opacity = 0.8 * fade;
      ring2.scale.setScalar(0.2 + e * 1.6); ring2.material.opacity = 0.6 * fade;
      for (let i = 0; i < drops.count; i++) {
        const s = seed[i]; const y = Math.max(0, s.vy * t - 2.4 * t * t);
        drops.positions[i * 3] = Math.cos(s.a) * (s.r + e * 0.9);
        drops.positions[i * 3 + 1] = 0.05 + y;
        drops.positions[i * 3 + 2] = Math.sin(s.a) * (s.r + e * 0.9);
      }
      if (drops.count) { drops.geometry.attributes.position.needsUpdate = true; drops.pts.material.opacity = 0.9 * fade; }
    });
  },

  // ---- WashedGround: a flat sheet of water washing the ground outward ---------
  wash(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const sheet = groundDisc(c.trail, 0.5, false); sheet.position.y = 0.02; g.add(sheet);
    const edge = groundRing(c.core, 0.85); edge.position.y = 0.04; g.add(edge);
    const sheen = groundRing(c.glow, 0.4); sheen.position.y = 0.05; g.add(sheen);
    const spray = makePoints(reduced ? 0 : 12, c.core, 0.12, reduced);
    if (spray.count) g.add(spray.pts);
    const seed = [];
    for (let i = 0; i < spray.count; i++) seed.push({ a: (i / spray.count) * Math.PI * 2 });
    return transient(profile.kind, 'reaction', g, reduced ? 420 : 700, (t) => {
      const e = 1 - (1 - t) * (1 - t), fade = 1 - t, r = 0.3 + e * 2.6;
      sheet.scale.setScalar(r); sheet.material.opacity = 0.5 * (1 - t * 0.8);
      edge.scale.setScalar(r); edge.material.opacity = 0.85 * fade;
      sheen.scale.setScalar(r * 0.7); sheen.material.opacity = 0.4 * fade;
      for (let i = 0; i < spray.count; i++) { const s = seed[i]; spray.positions[i * 3] = Math.cos(s.a) * r; spray.positions[i * 3 + 1] = 0.06; spray.positions[i * 3 + 2] = Math.sin(s.a) * r; }
      if (spray.count) { spray.geometry.attributes.position.needsUpdate = true; spray.pts.material.opacity = 0.8 * fade; }
    });
  },

  // ---- Grounded: lightning driven into the ground + radial grounding lines ----
  grounding(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const segs = reduced ? 6 : 9;
    const arr = new Float32Array(segs * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const bolt = new THREE.LineSegments(bg, lineMat(c.core, 0.95)); bolt.frustumCulled = false; g.add(bolt);
    const rnd = mulberry(41);
    const rebuild = () => { fillJagged(arr, 0, _v.set(0, 2.4, 0), new THREE.Vector3(0, 0.02, 0), segs, 0.22, rnd); bg.attributes.position.needsUpdate = true; };
    rebuild();
    const spokes = new THREE.Group(); g.add(spokes);
    const nSpokes = reduced ? 4 : 7;
    for (let i = 0; i < nSpokes; i++) { const a = (i / nSpokes) * Math.PI * 2; spokes.add(paramLine(2, (u) => [Math.cos(a) * (0.2 + u * 1.3), 0.03, Math.sin(a) * (0.2 + u * 1.3)], c.glow, 0.8, false).line); }
    const hit = glow(0.18, c.core, 0.9); hit.position.y = 0.06; g.add(hit);
    let acc = 0;
    return transient(profile.kind, 'reaction', g, reduced ? 420 : 640, (t, age, cx) => {
      const fade = 1 - t;
      bolt.material.opacity = 0.95 * fade; hit.material.opacity = 0.9 * fade;
      spokes.scale.setScalar(0.6 + (1 - (1 - t) * (1 - t)) * 0.9);
      for (const ln of spokes.children) ln.material.opacity = 0.8 * fade;
      if (reduced) return;
      acc += cx.dtMs || 16; if (acc > 45) { acc = 0; rebuild(); }
    });
  },

  // ---- FrozenGround: ice crystals and frost spreading across the ground -------
  frost(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const ring = groundRing(c.glow, 0.6); ring.position.y = 0.03; g.add(ring);
    const crystals = [];
    const n = reduced ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3, r = 0.4 + Math.random() * 1.2;
      const m = mesh(G.octa(), matBasic(i % 2 ? c.core : c.glow, 0.9));
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); m.scale.setScalar(0.001);
      m.rotation.y = Math.random() * Math.PI; m.userData.h = 0.12 + Math.random() * 0.2;
      g.add(m); crystals.push(m);
    }
    return transient(profile.kind, 'reaction', g, reduced ? 520 : 820, (t) => {
      const grow = Math.min(1, t * 2.2), fade = 1 - t * t;
      ring.scale.setScalar(0.4 + (1 - (1 - t) * (1 - t)) * 1.8); ring.material.opacity = 0.6 * (1 - t);
      for (const m of crystals) { const s = grow * m.userData.h * 2.4; m.scale.set(s * 0.5, s, s * 0.5); m.position.y = s * 0.5; m.material.opacity = 0.9 * fade; }
    });
  },

  // ---- SteamVeil: billowing steam puffs rising and fading ---------------------
  steam(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const puffs = [];
    const n = reduced ? 3 : 7;
    for (let i = 0; i < n; i++) {
      const p = glow(0.32, i % 2 ? c.core : c.glow, 0);
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.5;
      p.position.set(Math.cos(a) * r, 0.1 + Math.random() * 0.2, Math.sin(a) * r);
      p.userData = { x: p.position.x, sp: 0.6 + Math.random() * 0.9, ph: Math.random(), sc: 0.5 + Math.random() * 0.6 };
      g.add(p); puffs.push(p);
    }
    return transient(profile.kind, 'reaction', g, reduced ? 600 : 1000, (t) => {
      for (const p of puffs) {
        const lt = Math.min(1, t + p.userData.ph * 0.2);
        p.position.y = 0.1 + lt * (1.4 * p.userData.sp);
        p.position.x = p.userData.x + (reduced ? 0 : Math.sin(lt * 4 + p.userData.ph * 6) * 0.15);
        p.scale.setScalar(p.userData.sc * (0.6 + lt * 1.6));
        p.material.opacity = Math.sin(Math.min(1, lt) * Math.PI) * 0.5;
      }
    });
  },

  // ---- FlashFire: a flame eruption bursting upward off the ignited oil --------
  flame(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const base = groundDisc(c.trail, 0.5, true); base.position.y = 0.04; base.scale.setScalar(1.1); g.add(base);
    const tongues = [];
    const n = reduced ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 0.2 + Math.random() * 0.4;
      const tng = mesh(G.cone(), matBasic(i % 2 ? c.core : c.glow, 0.85));
      tng.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r); tng.scale.set(0.25, 0.9, 0.25);
      tng.userData = { ph: Math.random() * 6 }; g.add(tng); tongues.push(tng);
    }
    const embers = makePoints(reduced ? 0 : 20, c.core, 0.13, reduced);
    if (embers.count) g.add(embers.pts);
    const eseed = [];
    for (let i = 0; i < embers.count; i++) eseed.push({ a: Math.random() * Math.PI * 2, r: Math.random() * 0.5, vy: 1.5 + Math.random() * 1.8, ph: Math.random() });
    return transient(profile.kind, 'reaction', g, reduced ? 480 : 780, (t, age, cx) => {
      const fade = 1 - t, s = cx.time || 0;
      base.scale.setScalar(1.1 + (1 - (1 - t) * (1 - t)) * 0.9); base.material.opacity = 0.5 * fade;
      for (const tng of tongues) {
        const fl = reduced ? 1 : (0.8 + Math.abs(Math.sin(s * 12 + tng.userData.ph)) * 0.5);
        tng.scale.set(0.25, 0.9 * fl * (0.5 + fade), 0.25); tng.position.y = 0.3 + 0.9 * fl * 0.4;
        tng.material.opacity = 0.85 * fade;
      }
      for (let i = 0; i < embers.count; i++) { const s2 = eseed[i], tt = Math.min(1, t + s2.ph * 0.15); embers.positions[i * 3] = Math.cos(s2.a) * (s2.r + tt * 0.4); embers.positions[i * 3 + 1] = 0.2 + s2.vy * tt; embers.positions[i * 3 + 2] = Math.sin(s2.a) * (s2.r + tt * 0.4); }
      if (embers.count) { embers.geometry.attributes.position.needsUpdate = true; embers.pts.material.opacity = 0.9 * fade; }
    });
  },

  // ---- SpreadingFlame: a curved wall of fire sweeping wider -------------------
  flameSweep(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const row = new THREE.Group(); g.add(row);
    const tongues = [];
    const n = reduced ? 5 : 9;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5);
      const tng = mesh(G.cone(), matBasic(i % 2 ? c.core : c.glow, 0.85));
      tng.position.set(x, 0.35, -0.2 * (1 - (2 * x) * (2 * x))); tng.scale.set(0.18, 0.8, 0.18);
      tng.userData = { ph: i }; row.add(tng); tongues.push(tng);
    }
    const base = groundDisc(c.trail, 0.4, true); base.position.y = 0.03; g.add(base);
    return transient(profile.kind, 'reaction', g, reduced ? 520 : 820, (t, age, cx) => {
      const fade = 1 - t, s = cx.time || 0, width = 1.2 + (1 - (1 - t) * (1 - t)) * 2.4;
      row.scale.set(width, 1, 1); base.scale.set(width, 1, 1.2); base.material.opacity = 0.4 * fade;
      for (const tng of tongues) { const fl = reduced ? 1 : (0.8 + Math.abs(Math.sin(s * 11 + tng.userData.ph)) * 0.55); tng.scale.set(0.18, 0.8 * fl * (0.5 + fade), 0.18); tng.material.opacity = 0.85 * fade; }
    });
  },

  // ---- ClearedAir: expanding gust rings + streaks clearing the air -----------
  wind(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const rings = [];
    for (let i = 0; i < 3; i++) { const r = groundRing(c.glow, 0.7); r.position.y = 0.6 + i * 0.3; g.add(r); rings.push(r); }
    const streaks = [];
    const n = reduced ? 0 : 6;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const ln = paramLine(2, (u) => [Math.cos(a) * (0.4 + u * 1.2), 0.7, Math.sin(a) * (0.4 + u * 1.2)], c.core, 0.8, false).line; g.add(ln); streaks.push(ln); }
    return transient(profile.kind, 'reaction', g, reduced ? 460 : 700, (t) => {
      const fade = 1 - t;
      for (let i = 0; i < rings.length; i++) { const ph = Math.min(1, t + i * 0.18); rings[i].scale.setScalar(0.3 + ph * 2.6); rings[i].material.opacity = 0.7 * (1 - ph); }
      for (const ln of streaks) { ln.material.opacity = 0.8 * fade; ln.scale.setScalar(0.6 + (1 - (1 - t) * (1 - t)) * 1.2); }
    });
  },

  // ---- BacklitFog: warm light blooming through drifting fog -------------------
  backlight(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const halo = glow(0.6, c.glow, 0); halo.position.y = 0.7; g.add(halo);
    const coreGlow = glow(0.3, c.core, 0); coreGlow.position.y = 0.7; g.add(coreGlow);
    const ring = ringMesh(c.core, 0); ring.position.y = 0.7; g.add(ring);
    const fog = [];
    const n = reduced ? 2 : 5;
    for (let i = 0; i < n; i++) { const p = glow(0.5, c.trail, 0); const a = Math.random() * Math.PI * 2; p.position.set(Math.cos(a) * 0.6, 0.6 + Math.random() * 0.4, Math.sin(a) * 0.6); g.add(p); fog.push(p); }
    return transient(profile.kind, 'reaction', g, reduced ? 560 : 900, (t) => {
      const bloom = Math.sin(Math.min(1, t) * Math.PI);
      halo.scale.setScalar(1 + bloom * 1.6); halo.material.opacity = bloom * 0.55;
      coreGlow.scale.setScalar(1 + bloom * 0.8); coreGlow.material.opacity = bloom * 0.7;
      ring.scale.setScalar(1 + bloom * 2.2); ring.material.opacity = bloom * 0.4;
      for (const p of fog) p.material.opacity = bloom * 0.3;
    }, { billboard: true });
  },

  // ---- DriftingOil: a dark oil slick sliding sideways under a sheen -----------
  oildrift(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const pool = groundDisc(0x0a0906, 0.85, false); pool.position.y = 0.02; pool.scale.setScalar(1.4); g.add(pool);
    const sheen = groundRing(0x6a7fb0, 0.4); sheen.position.y = 0.04; sheen.scale.setScalar(1.4); g.add(sheen);
    const glint = groundDisc(0xffffff, 0.22, true); glint.position.y = 0.05; glint.scale.setScalar(0.5); g.add(glint);
    const arrow = paramLine(2, (u) => [u * 1.4, 0.05, 0], c.glow, 0.7, false).line; g.add(arrow);
    return transient(profile.kind, 'reaction', g, reduced ? 620 : 900, (t, age, cx) => {
      const fade = 1 - t, s = cx.time || 0, drift = (1 - (1 - t) * (1 - t)) * 1.2;
      pool.position.x = drift; pool.material.opacity = 0.7 * fade;
      sheen.position.x = drift; if (!reduced) sheen.material.color.setHSL((s * 0.05) % 1, 0.6, 0.6); sheen.material.opacity = 0.4 * fade;
      glint.position.set(drift + (reduced ? 0.4 : Math.cos(s * 0.6) * 0.5), 0.05, reduced ? 0 : Math.sin(s * 0.6) * 0.5); glint.material.opacity = 0.2 * fade;
      arrow.position.x = drift - 0.7; arrow.material.opacity = 0.7 * fade;
    });
  },

  // ---- Rubble: stone fragments bursting out of collapsing cover --------------
  rubble(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const dust = groundDisc(c.trail, 0.5, false); dust.position.y = 0.03; g.add(dust);
    const rocks = [];
    const n = reduced ? 0 : 10;
    for (let i = 0; i < n; i++) {
      const m = mesh(G.box(), matSolid(i % 2 ? c.glow : c.trail, { roughness: 1, flat: true }));
      m.scale.setScalar(0.08 + Math.random() * 0.1);
      const th = Math.random() * Math.PI * 2, ph = Math.random() * 0.6 + 0.2;
      m.userData.vel = new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.sin(ph) + 0.8, Math.sin(th) * Math.cos(ph)).multiplyScalar(2 + Math.random() * 1.5);
      g.add(m); rocks.push(m);
    }
    const chunk = mesh(G.ico(), matSolid(c.glow, { roughness: 1, flat: true })); chunk.scale.setScalar(0.2); chunk.position.y = 0.12; g.add(chunk);
    return transient(profile.kind, 'reaction', g, reduced ? 420 : 760, (t, age, cx) => {
      const dt = (cx.dtMs || 16) * 0.001;
      dust.scale.setScalar(0.5 + (1 - (1 - t) * (1 - t)) * 2); dust.material.opacity = 0.5 * (1 - t);
      for (const m of rocks) {
        m.position.addScaledVector(m.userData.vel, dt); m.userData.vel.y -= 5 * dt;
        m.rotation.x += dt * 5; m.rotation.z += dt * 4;
        if (m.position.y < 0.03) { m.position.y = 0.03; m.userData.vel.y *= -0.3; m.userData.vel.x *= 0.6; m.userData.vel.z *= 0.6; }
      }
      chunk.rotation.y += dt * 2;
    });
  },

  // ---- FracturedCover: a cracking fracture splitting the cover open -----------
  fracture(profile, reduced) {
    const c = profile.colors;
    const g = new THREE.Group();
    const nLines = reduced ? 2 : 4, segs = 4;
    const arr = new Float32Array(nLines * segs * 2 * 3);
    const bg = ownBuffer(new THREE.BufferGeometry());
    bg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const cracks = new THREE.LineSegments(bg, lineMat(c.glow, 0.95)); cracks.frustumCulled = false; g.add(cracks);
    const rnd = mulberry(63);
    let o = 0;
    for (let i = 0; i < nLines; i++) { const a = (i / nLines) * Math.PI + 0.2; o = fillJagged(arr, o, _v.set(0, 0.05, 0), new THREE.Vector3(Math.cos(a) * 1.2, 0.05, Math.sin(a) * 1.2), segs, 0.22, rnd); }
    bg.attributes.position.needsUpdate = true;
    const shards = [];
    const n = reduced ? 0 : 8;
    for (let i = 0; i < n; i++) {
      const m = mesh(G.tetra(), matSolid(c.trail, { roughness: 1, flat: true }));
      m.scale.setScalar(0.07 + Math.random() * 0.07);
      const th = Math.random() * Math.PI * 2, ph = Math.random() * 0.5 + 0.2;
      m.userData.vel = new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.sin(ph) + 0.6, Math.sin(th) * Math.cos(ph)).multiplyScalar(1.6 + Math.random());
      g.add(m); shards.push(m);
    }
    return transient(profile.kind, 'reaction', g, reduced ? 420 : 680, (t, age, cx) => {
      const dt = (cx.dtMs || 16) * 0.001;
      cracks.material.opacity = 0.95 * (1 - t); cracks.scale.setScalar(0.4 + (1 - (1 - t) * (1 - t)) * 0.9);
      for (const m of shards) { m.position.addScaledVector(m.userData.vel, dt); m.userData.vel.y -= 4 * dt; m.rotation.x += dt * 6; }
    });
  },

  // ---- Spectrum: concentric multicolor spectral rings + prismatic motes ------
  spectrum(profile, reduced) {
    const g = new THREE.Group();
    const rings = [];
    for (let i = 0; i < 4; i++) { const r = ringMesh(0xffffff, 0); r.position.y = 0.6; rings.push(r); g.add(r); }
    const motes = makePoints(reduced ? 0 : 16, 0xffffff, 0.14, reduced);
    if (motes.count) { motes.pts.position.y = 0.6; g.add(motes.pts); }
    const mseed = [];
    for (let i = 0; i < motes.count; i++) mseed.push({ a: (i / motes.count) * Math.PI * 2, r: 0.3 + Math.random() * 0.6 });
    return transient(profile.kind, 'reaction', g, reduced ? 520 : 860, (t, age, cx) => {
      const s = cx.time || 0, fade = 1 - t;
      for (let i = 0; i < rings.length; i++) {
        const ph = Math.min(1, t + i * 0.12);
        rings[i].scale.setScalar(0.3 + ph * 2.4);
        rings[i].material.color.setHSL(reduced ? (i / rings.length) : ((s * 0.3 + i / rings.length) % 1), 1, 0.6);
        rings[i].material.opacity = 0.7 * (1 - ph);
      }
      for (let i = 0; i < motes.count; i++) { const m = mseed[i], e = 1 - (1 - t) * (1 - t); motes.positions[i * 3] = Math.cos(m.a + s) * (m.r + e * 1.2); motes.positions[i * 3 + 1] = Math.sin(s * 2 + i) * 0.2; motes.positions[i * 3 + 2] = Math.sin(m.a + s) * (m.r + e * 1.2); }
      if (motes.count) { motes.geometry.attributes.position.needsUpdate = true; motes.pts.material.opacity = 0.9 * fade; }
    }, { billboard: true });
  },
};

// Build the transient VFX handle for an environmental reaction. opts.from/opts.to
// (world points) drive link reactions (ConductiveArc); the arena positions the
// handle at opts.from and the arc is drawn to (to - from) in local space.
export function makeReactionVfx(name, reduced, opts = {}) {
  const profile = getReactionVfx(name);
  const build = profile && REACTION_BUILDERS[profile.vfx];
  if (!build) return null;
  let localTo = null;
  if (opts.to && opts.from) localTo = opts.to.clone().sub(opts.from);
  const handle = build(profile, reduced, { localTo, radius: opts.radius });
  handle.anchor = profile.anchor;
  return handle;
}

// Renderer self-check: every reaction profile's builder must exist here.
export function reactionVfxCoverage() {
  const covered = new Set(Object.keys(REACTION_BUILDERS));
  return REACTION_VFX_BUILDERS.filter((v) => !covered.has(v));
}

// Renderer self-check: every profile family must have a builder somewhere.
export function vfxFamilyCoverage() {
  const covered = new Set([
    ...Object.keys(PROJECTILE_BUILDERS),
    ...Object.keys(RELEASE_BUILDERS),
    'zone', 'ward', 'dome', 'beam',
  ]);
  return VFX_FAMILIES.filter((f) => !covered.has(f));
}
