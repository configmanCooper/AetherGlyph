// arena.js — first-person Three.js arena for The Confluence.
//
// Renders the opposing wizard, the player's own hands/wand cues, projectiles,
// shields/barriers, the dueling platform + focus stones, and reactive lighting.
// All gameplay-readable state (health/resources/status) lives in the HTML HUD;
// this module only draws the world and consumes sim events for effects.
//
// The per-spell visual identity lives in ./spellVfx.js (data-driven by
// ./spellVfxProfiles.js). This module owns object lifetime: it creates a VFX
// handle per projectile/zone/effect, drives its update() each frame, and calls
// dispose() when the source ends so geometries/materials never leak. Transient
// effects are capped so worst-case clutter stays bounded on low-end Android.

import * as THREE from 'three';
import { SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';
import { effectFor, PROJECTILE, CHANNEL, ZONE, SHIELD, BARRIER } from '@shared/sim/spellEffects.js';
import { getSpellVfx } from './spellVfxProfiles.js';
import {
  makeProjectileVfx, makeImpactVfx, makeZoneVfx, makeReleaseVfx,
  makeWardVfx, makeDomeVfx, makeBeamVfx, makeCastCueVfx,
} from './spellVfx.js';

const ARC_W = 3.2;
const SEP = 11;
const PLAYER_Z = SEP / 2;
const ENEMY_Z = -SEP / 2;
const MAX_EFFECTS = 26; // hard cap on live transient effects (impacts + releases)

const SCHOOL_COLOR = {
  Ember: 0xff6a3d, Tide: 0x54c8ff, Storm: 0xffe14d, Stone: 0xb08a5a,
  Gale: 0x9be8d8, Arcane: 0xb98bff, Umbra: 0x7a6f99, Prismatic: 0xffffff,
};

// Heavy impacts that briefly shake the camera (skipped under reduced motion).
const SHAKE_BY_SPELL = { 6: 0.05, 8: 0.11, 9: 0.09, 30: 0.06, 34: 0.13, 40: 0.03 };

const PROJECTILE_FAMILIES = new Set([
  'orb', 'spear', 'dart', 'spike', 'missile', 'wave', 'lightning', 'fireball',
  'comet', 'airpulse', 'thunderring', 'quakewave',
]);

function wizardX(w) { return w.arcPos * ARC_W; }

export class Arena {
  constructor(canvas) {
    this.canvas = canvas;
    this.reduced = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0a1c);
    this.scene.fog = new THREE.Fog(0x0b0a1c, 18, 55);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
    this.camera.position.set(0, 1.7, PLAYER_Z);

    this._buildLights();
    this._buildSky();
    this._buildArena();
    this._buildAcademy();
    this._buildEnemy();
    this._buildHands();

    this.projMeshes = new Map(); // projectile id -> { handle, dir, lastPos, prog, spellId }
    this.zoneMeshes = new Map(); // zone id -> handle
    this.effects = [];           // transient effect handles { handle, billboardable }
    this.castCues = new Map();   // caster id -> { handle, spellId }
    this.beams = new Map();      // caster id -> { handle, spellId }
    this._t = 0;                 // seconds accumulator for animation
    this.shake = 0;
    this._debug = [];            // dev-only VFX gallery objects (never in normal play)

    // Ward / Barrier Dome visuals (spell-specific, per wizard).
    this._buildGuards();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setReduced(v) {
    this.reduced = v;
    // Rebuild persistent visuals so the motion setting takes effect immediately.
    this._disposeGuards();
    this._buildGuards();
    for (const [, c] of this.castCues) { this.scene.remove(c.handle.object3D); c.handle.dispose(); }
    this.castCues.clear();
    for (const [, b] of this.beams) { this.scene.remove(b.handle.object3D); b.handle.dispose(); }
    this.beams.clear();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildLights() {
    // Night ambience on a small, fixed light budget for phone GPUs: cool moon
    // key + warm brazier accents (added in _buildAcademy) + one reactive combat
    // light. No shadows (expensive on low-end Android).
    this.scene.add(new THREE.AmbientLight(0x2a2c48, 1.05));
    this.moonLight = new THREE.DirectionalLight(0xbfd0ff, 0.85);
    this.moonLight.position.set(-5, 11, -7);
    this.scene.add(this.moonLight);
    this.keyLight = new THREE.PointLight(0x8b6bff, 0.55, 30);
    this.keyLight.position.set(0, 5, 0);
    this.scene.add(this.keyLight);
  }

  // Moonlit night sky: a gradient dome (unlit, fog-excluded), a haloed moon, and
  // a scattered star field. One dome draw call + one points cloud keeps it cheap.
  _buildSky() {
    const sky = new THREE.Group();
    const domeGeo = new THREE.SphereGeometry(80, 20, 12);
    const pos = domeGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const zenith = new THREE.Color(0x080614), horizon = new THREE.Color(0x241a3a);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 80);
      tmp.copy(horizon).lerp(zenith, t);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.add(dome);

    const moon = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false, depthWrite: false }));
    moon.position.set(-13, 24, -48); moon.lookAt(0, 6, 0); sky.add(moon);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(6.2, 32), new THREE.MeshBasicMaterial({ color: 0x9fb0ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.position.set(-13, 24, -48.2); halo.lookAt(0, 6, 0); sky.add(halo);

    const starN = 140, sp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const a = (i * 2.3999632) % (Math.PI * 2), el = 0.12 + ((i * 97) % 100) / 100 * 0.6, rad = 70;
      sp[i * 3] = Math.cos(a) * Math.cos(el) * rad;
      sp[i * 3 + 1] = Math.sin(el) * rad + 4;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(el) * rad - 12;
    }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfd6ff, size: 0.45, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    sky.add(stars);

    this.scene.add(sky);
    this._sky = sky; this._moon = moon; this._stars = stars;
  }

  // Original grand arcane-academy hall: symmetric stone arcades, a tall
  // arched-window back wall with abstract sigils, hanging banners, distant
  // moonlit towers, floating lanterns, and animated braziers. All motifs are
  // generic gothic-magical geometry — no copyrighted castle is referenced.
  _buildAcademy() {
    const group = new THREE.Group();
    this._academy = group;
    this.braziers = [];
    this._floatingLights = [];
    this._banners = [];
    this._towers = [];
    this._columns = [];
    this._windowCount = 0;

    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3552, roughness: 0.95, metalness: 0.05 });
    const stoneDark = new THREE.MeshStandardMaterial({ color: 0x2a2740, roughness: 1 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x201d30, roughness: 0.6, metalness: 0.4 });
    // Shared geometry reused across every repeated element (one geometry, many meshes).
    const colGeo = new THREE.CylinderGeometry(0.32, 0.4, 5.2, 10);
    const fluteGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
    const baseGeo = new THREE.BoxGeometry(1.1, 0.4, 1.1);
    const archGeo = new THREE.TorusGeometry(1.5, 0.2, 6, 12, Math.PI);

    // --- two symmetric side arcades (colonnades) ---
    const arcadeZ = [-4.5, -1.5, 1.5, 4.5];
    for (const side of [-1, 1]) {
      const x = side * 7.6;
      for (const z of arcadeZ) {
        const col = new THREE.Mesh(colGeo, stone); col.position.set(x, 2.7, z); group.add(col); this._columns.push(col);
        const base = new THREE.Mesh(baseGeo, stoneDark); base.position.set(x, 0.2, z); group.add(base);
        const cap = new THREE.Mesh(baseGeo, stoneDark); cap.position.set(x, 5.3, z); cap.scale.set(0.95, 0.9, 0.95); group.add(cap);
        const flute = new THREE.Mesh(fluteGeo, stoneDark); flute.position.set(x, 0.55, z); group.add(flute);
      }
      for (let i = 0; i < arcadeZ.length - 1; i++) {
        const zc = (arcadeZ[i] + arcadeZ[i + 1]) / 2;
        const arch = new THREE.Mesh(archGeo, stone);
        arch.position.set(x, 5.3, zc); arch.rotation.y = Math.PI / 2; group.add(arch);
      }
    }

    // --- tall arched-window back wall behind the far wizard ---
    const wall = new THREE.Mesh(new THREE.BoxGeometry(17, 8.4, 0.6), stone);
    wall.position.set(0, 3.6, -9.0); group.add(wall); this._backWall = wall;
    const paneMat = new THREE.MeshBasicMaterial({ color: 0x5f82ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const paneGeo = new THREE.PlaneGeometry(2.0, 4.2);
    const topGeo = new THREE.CircleGeometry(1.0, 14, 0, Math.PI);
    const mullionGeo = new THREE.BoxGeometry(0.12, 4.4, 0.12);
    for (const wx of [-5.4, -1.8, 1.8, 5.4]) {
      const pane = new THREE.Mesh(paneGeo, paneMat.clone()); pane.position.set(wx, 3.6, -8.68); group.add(pane);
      const top = new THREE.Mesh(topGeo, paneMat.clone()); top.position.set(wx, 5.7, -8.68); group.add(top);
      const mull = new THREE.Mesh(mullionGeo, stoneDark); mull.position.set(wx, 3.6, -8.6); group.add(mull);
      group.add(this._makeSigil(wx, 3.7, -8.62, 0xbfe0ff, 0.7));
      this._windowCount++;
    }

    // --- hanging banners with original abstract sigils ---
    const bannerGeo = new THREE.PlaneGeometry(1.3, 3.2);
    for (const [bx, hue] of [[-3.6, 0x5a2d6a], [3.6, 0x2d4a6a]]) {
      const banner = new THREE.Mesh(bannerGeo, new THREE.MeshStandardMaterial({ color: hue, roughness: 1, side: THREE.DoubleSide }));
      banner.position.set(bx, 4.1, -8.55); group.add(banner); this._banners.push(banner);
      group.add(this._makeSigil(bx, 4.1, -8.45, 0xffd27a, 0.55));
    }

    // --- distant moonlit towers (fogged silhouettes with a few lit windows) ---
    const towerMat = new THREE.MeshBasicMaterial({ color: 0x15121f });
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffcaa0, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    for (const [tx, tz, h, rad] of [[-15, -24, 17, 2.0], [-6, -30, 22, 2.4], [7, -27, 19, 2.2], [16, -23, 15, 1.8]]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.72, rad, h, 8), towerMat);
      tower.position.set(tx, h / 2 - 1, tz); group.add(tower); this._towers.push(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.95, rad * 1.7, 8), towerMat);
      roof.position.set(tx, h - 1 + rad * 0.85, tz); group.add(roof);
      for (let k = 0; k < 3; k++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8), winMat.clone());
        win.position.set(tx + (k - 1) * rad * 0.5, 2 + k * 3, tz + rad); group.add(win);
      }
    }

    // --- floating lanterns / candles gently bobbing above the hall ---
    const lanternGeo = new THREE.SphereGeometry(0.13, 8, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rad = 5.2 + (i % 2) * 1.4;
      const y = 3.3 + (i % 3) * 0.7;
      const lantern = new THREE.Mesh(lanternGeo, new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      lantern.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad * 0.7 - 1.5);
      group.add(lantern);
      this._floatingLights.push({ mesh: lantern, baseY: y, phase: i * 1.7 });
    }

    // --- animated magical braziers (the warm accent lights) ---
    const standGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.5, 8);
    const bowlGeo = new THREE.CylinderGeometry(0.5, 0.26, 0.36, 10, 1, true);
    const flameGeo = new THREE.ConeGeometry(0.32, 1.0, 8);
    for (let i = 0; i < 4; i++) {
      const bx = (i < 2 ? -1 : 1) * 4.4, bz = (i % 2 === 0 ? 1 : -1) * 3.6;
      const brazier = new THREE.Group();
      const stand = new THREE.Mesh(standGeo, metalMat); stand.position.y = 0.75; brazier.add(stand);
      const bowl = new THREE.Mesh(bowlGeo, metalMat); bowl.position.y = 1.55; brazier.add(bowl);
      const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.y = 2.05; brazier.add(flame);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.y = 2.05; brazier.add(glow);
      brazier.position.set(bx, 0, bz); group.add(brazier);
      // Only the front pair carries a real light — keeps total scene lights <= 5.
      let light = null;
      if (i % 2 === 0) { light = new THREE.PointLight(0xff8a3a, 0.55, 9); light.position.set(bx, 2.1, bz); group.add(light); }
      this.braziers.push({ flame, glow: glow, light, phase: i * 1.9, baseY: 2.05 });
    }

    this.scene.add(group);
  }

  // Build an original, abstract arcane sigil from procedural line geometry: a
  // ringed star crossed by a diamond. Not any real-world / trademarked symbol.
  _makeSigil(x, y, z, color, scale = 1) {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const circle = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; circle.push(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0); }
    g.add(this._lineFrom(circle, mat, false));
    const star = [];
    for (let i = 0; i <= 5; i++) { const a = (i * 2 / 5) * Math.PI * 2 - Math.PI / 2; star.push(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0); }
    g.add(this._lineFrom(star, mat, false));
    const diamond = [0, 0.22, 0, 0.22, 0, 0, 0, -0.22, 0, -0.22, 0, 0, 0, 0.22, 0];
    g.add(this._lineFrom(diamond, mat, false));
    g.scale.setScalar(scale); g.position.set(x, y, z);
    return g;
  }

  _lineFrom(arr, material, loop) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    const line = new (loop ? THREE.LineLoop : THREE.Line)(geo, material);
    line.frustumCulled = false;
    return line;
  }

  _buildArena() {
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8.4, 0.5, 40),
      new THREE.MeshStandardMaterial({ color: 0x241a3a, roughness: 0.9, metalness: 0.1 }),
    );
    platform.position.y = -0.25;
    this.scene.add(platform);
    this._platform = platform;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(8, 0.12, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0x8b6bff, emissive: 0x4a2f99, emissiveIntensity: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    // Inlaid courtyard sigil-ring on the dueling floor for academy flavour.
    const inlay = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 5.7, 48),
      new THREE.MeshBasicMaterial({ color: 0x6a52a8, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.015;
    this.scene.add(inlay);

    // Three destructible waist-high focus stones across the middle.
    this.stones = [];
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a3d63, roughness: 1 });
    for (const x of [-2.6, 0, 2.6]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.7), stoneMat.clone());
      s.position.set(x, 0.5, 0);
      this.scene.add(s); this.stones.push(s);
    }
  }

  // A layered, readable wizard: robe + tunic, hem trim + belt, a shoulder
  // mantle with pauldrons, boots, gloved hands, an expressive hood + wizard hat,
  // and a visible staff with a glowing crystal. Symmetric between duelists —
  // only the robe colour + accent differ. userData.hand/aura drive cast tells.
  _robeFigure(color, accent = 0x8b6bff) {
    const g = new THREE.Group();
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8d9c0, roughness: 0.7 });
    const darker = new THREE.Color(color).multiplyScalar(0.55).getHex();
    const trimMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.35, roughness: 0.5 });
    const parts = {};

    // Outer robe + inner tunic (two layers) with a lit hem trim.
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.72, 2.0, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    robe.position.y = 1.0; g.add(robe); parts.robe = robe;
    const tunic = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.7, 12), new THREE.MeshStandardMaterial({ color: darker, roughness: 0.9 }));
    tunic.position.y = 0.95; g.add(tunic); parts.tunic = tunic;
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.07, 6, 20), trimMat);
    hem.rotation.x = Math.PI / 2; hem.position.y = 0.16; g.add(hem); parts.trim = hem;
    const placket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.05), trimMat);
    placket.position.set(0, 1.05, 0.5); g.add(placket);

    // Belt at the waist.
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 18), new THREE.MeshStandardMaterial({ color: 0x2a2233, roughness: 0.7, metalness: 0.3 }));
    belt.rotation.x = Math.PI / 2; belt.position.y = 1.02; g.add(belt); parts.belt = belt;
    const buckle = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), trimMat); buckle.position.set(0, 1.02, 0.5); g.add(buckle);

    // Shoulder mantle + pauldrons.
    const mantle = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.55, 14, 1, true), new THREE.MeshStandardMaterial({ color: darker, roughness: 0.85, side: THREE.DoubleSide }));
    mantle.position.y = 1.72; g.add(mantle); parts.mantle = mantle;
    const pauldronGeo = new THREE.SphereGeometry(0.17, 10, 8);
    for (const sx of [-0.42, 0.42]) { const p = new THREE.Mesh(pauldronGeo, trimMat); p.position.set(sx, 1.72, 0); p.scale.y = 0.7; g.add(p); }
    parts.shoulders = true;

    // Boots.
    const bootGeo = new THREE.BoxGeometry(0.24, 0.2, 0.42);
    for (const sx of [-0.2, 0.2]) { const b = new THREE.Mesh(bootGeo, new THREE.MeshStandardMaterial({ color: 0x201a2c, roughness: 0.9 })); b.position.set(sx, 0.1, 0.14); g.add(b); }
    parts.boots = true;

    // Head + expressive hood + tall wizard hat.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), skinMat);
    head.position.y = 2.12; g.add(head); parts.head = head;
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 12, 1, true), new THREE.MeshStandardMaterial({ color: darker, roughness: 0.9, side: THREE.DoubleSide }));
    hood.position.y = 2.28; g.add(hood); parts.hood = hood;
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x2c2148, roughness: 0.85 }));
    hatBrim.position.y = 2.42; g.add(hatBrim);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.0, 14), new THREE.MeshStandardMaterial({ color: 0x2c2148, roughness: 0.85 }));
    hat.position.y = 2.95; hat.rotation.z = 0.12; g.add(hat); parts.hat = hat;
    const hatBand = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.05, 6, 16), trimMat);
    hatBand.rotation.x = Math.PI / 2; hatBand.position.y = 2.55; g.add(hatBand);

    // Off hand + casting hand (with a school-tintable aura).
    const offHand = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), skinMat);
    offHand.position.set(-0.55, 1.3, 0.2); g.add(offHand);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skinMat);
    hand.position.set(0.55, 1.35, 0.2); g.add(hand); parts.hand = hand;
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    hand.add(aura);

    // Visible staff with a glowing crystal head, held in the off hand.
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.3, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 }));
    staff.add(shaft);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    crystal.position.y = 1.25; staff.add(crystal);
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2a2233, metalness: 0.4, roughness: 0.6 }));
    claw.position.y = 1.1; claw.rotation.x = Math.PI / 2; staff.add(claw);
    staff.position.set(-0.6, 1.15, 0.24); staff.rotation.z = 0.16; g.add(staff);
    parts.staff = staff; parts.staffCrystal = crystal;

    g.userData = { hand, aura, robe, staff, hood, belt, staffCrystal: crystal, parts, robeLayers: 2 };
    return g;
  }

  _buildEnemy() {
    this.enemy = this._robeFigure(0x3a2d5e, 0xb98bff);
    this.enemy.position.set(0, 0, ENEMY_Z);
    this.enemy.rotation.y = Math.PI; // face the player
    this.scene.add(this.enemy);
  }

  _buildHands() {
    // First-person gloves + wand attached to the camera. The gloves get a cuff
    // and trim so the caster's own hands read as an academy duelist's, and the
    // wand carries a glowing crystal tip that lights up during a windup.
    this.handRig = new THREE.Group();
    this.camera.add(this.handRig);
    this.scene.add(this.camera);

    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x35507a, roughness: 0.7 });
    const cuffMat = new THREE.MeshStandardMaterial({ color: 0x1f2f4a, roughness: 0.6, metalness: 0.2 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x8b6bff, emissive: 0x5a3fb0, emissiveIntensity: 0.4, roughness: 0.5 });
    this._gloveParts = 0;

    // Left glove: palm + a cuff + three stubby knuckles.
    this.leftHand = new THREE.Group();
    const lPalm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), gloveMat); lPalm.scale.set(1, 0.8, 1.15); this.leftHand.add(lPalm); this._gloveParts++;
    const lCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.16, 10), cuffMat); lCuff.rotation.x = Math.PI / 2; lCuff.position.set(0, -0.02, 0.12); this.leftHand.add(lCuff); this._gloveParts++;
    for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.11, 6), gloveMat); f.rotation.x = Math.PI / 2; f.position.set((k - 1) * 0.06, 0.03, -0.14); this.leftHand.add(f); this._gloveParts++; }
    const lTrim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 12), trimMat); lTrim.rotation.x = Math.PI / 2; lTrim.position.set(0, -0.02, 0.05); this.leftHand.add(lTrim); this._gloveParts++;
    this.leftHand.position.set(-0.42, -0.42, -0.9); this.leftHand.rotation.set(0.3, 0.2, 0);
    this.handRig.add(this.leftHand);

    // Right glove holding the wand/staff.
    this.rightHand = new THREE.Group();
    const rPalm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), gloveMat); rPalm.scale.set(1, 0.8, 1.15); this.rightHand.add(rPalm); this._gloveParts++;
    const rCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.16, 10), cuffMat); rCuff.rotation.x = Math.PI / 2; rCuff.position.set(0, -0.02, 0.12); this.rightHand.add(rCuff); this._gloveParts++;
    const rTrim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 12), trimMat); rTrim.rotation.x = Math.PI / 2; rTrim.position.set(0, -0.02, 0.05); this.rightHand.add(rTrim); this._gloveParts++;
    const wand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.034, 0.66, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c2148, roughness: 0.7 }),
    );
    wand.rotation.x = Math.PI / 2.4; wand.position.set(0.02, 0.14, -0.24);
    this.rightHand.add(wand);
    const wandClaw = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 10, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2a2233, metalness: 0.5, roughness: 0.5 }));
    wandClaw.position.set(0.03, 0.28, -0.4); wandClaw.rotation.x = Math.PI / 2.2; this.rightHand.add(wandClaw);
    this.wandTip = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.07, 0),
      new THREE.MeshBasicMaterial({ color: 0x8b6bff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.wandTip.position.set(0.04, 0.34, -0.44);
    this.rightHand.add(this.wandTip);
    this.rightHand.position.set(0.46, -0.42, -0.9); this.rightHand.rotation.set(0.2, -0.15, 0);
    this.handRig.add(this.rightHand);
  }

  // Ward (frontal rune disc) + Barrier Dome (layered sphere) visuals per wizard.
  _buildGuards() {
    this.pWard = makeWardVfx(this.reduced); this.pWard.object3D.visible = false; this.scene.add(this.pWard.object3D);
    this.eWard = makeWardVfx(this.reduced); this.eWard.object3D.visible = false; this.scene.add(this.eWard.object3D);
    this.pDome = makeDomeVfx(this.reduced); this.pDome.object3D.visible = false; this.scene.add(this.pDome.object3D);
    this.eDome = makeDomeVfx(this.reduced); this.eDome.object3D.visible = false; this.scene.add(this.eDome.object3D);
  }

  _disposeGuards() {
    for (const g of [this.pWard, this.eWard, this.pDome, this.eDome]) {
      if (g) { this.scene.remove(g.object3D); g.dispose(); }
    }
  }

  reset() {
    for (const [, p] of this.projMeshes) { this.scene.remove(p.handle.object3D); p.handle.dispose(); }
    this.projMeshes.clear();
    for (const [, h] of this.zoneMeshes) { this.scene.remove(h.object3D); h.dispose(); }
    this.zoneMeshes.clear();
    for (const e of this.effects) { this.scene.remove(e.handle.object3D); e.handle.dispose(); }
    this.effects = [];
    for (const [, c] of this.castCues) { this.scene.remove(c.handle.object3D); c.handle.dispose(); }
    this.castCues.clear();
    for (const [, b] of this.beams) { this.scene.remove(b.handle.object3D); b.handle.dispose(); }
    this.beams.clear();
    this.shake = 0;
  }

  _wizardWorld(wid, y = 1.4) {
    const w = wid === 0 ? this._lastPlayer : this._lastEnemy;
    const x = w ? wizardX(w) : 0;
    return new THREE.Vector3(x, y, wid === 0 ? PLAYER_Z : ENEMY_Z);
  }

  // Ambient render used while in menus (no active match).
  renderIdle(dtMs) {
    this._idleT = (this._idleT || 0) + dtMs * 0.0002;
    this.camera.position.x = Math.sin(this._idleT) * 1.2;
    this.camera.lookAt(0, 1.5, ENEMY_Z);
    this._t += dtMs * 0.001;
    this._updateAcademy(dtMs);
    this._updateEffects(dtMs);
    this._updateDebug(dtMs);
    this.renderer.render(this.scene, this.camera);
  }

  // Animate the living academy: brazier flame flicker + light pulse and gently
  // bobbing lanterns. All motion is gated by reduced-motion (static otherwise).
  _updateAcademy(dtMs) {
    const s = this._t;
    if (this.reduced) {
      for (const b of (this.braziers || [])) { b.flame.scale.setScalar(1); b.flame.material.opacity = 0.85; if (b.light) b.light.intensity = 0.5; }
      return;
    }
    for (const b of (this.braziers || [])) {
      const f = 0.85 + Math.abs(Math.sin(s * 7 + b.phase)) * 0.4;
      b.flame.scale.set(0.9 + Math.sin(s * 11 + b.phase) * 0.12, f, 0.9 + Math.cos(s * 9 + b.phase) * 0.12);
      b.flame.material.opacity = 0.75 + Math.abs(Math.sin(s * 8 + b.phase)) * 0.22;
      b.glow.material.opacity = 0.3 + Math.abs(Math.sin(s * 6 + b.phase)) * 0.2;
      if (b.light) b.light.intensity = 0.45 + Math.abs(Math.sin(s * 8 + b.phase)) * 0.25;
    }
    for (const l of (this._floatingLights || [])) {
      l.mesh.position.y = l.baseY + Math.sin(s * 0.9 + l.phase) * 0.18;
      l.mesh.material.opacity = 0.7 + Math.abs(Math.sin(s * 1.4 + l.phase)) * 0.3;
    }
  }

  // Renderer stats + component identity for tests / dev tooling. No production
  // UI: it only reports what the scene currently contains and its light /
  // transparent-layer budgets, so a headless test can assert the academy and
  // wizard were built and stay within the mobile budget.
  academyStats() {
    let lights = 0, meshes = 0, transparent = 0, points = 0, lines = 0;
    this.scene.traverse((o) => {
      if (o.isLight) lights++;
      if (o.isMesh) { meshes++; const m = o.material; if (m && (Array.isArray(m) ? m.some((x) => x.transparent) : m.transparent)) transparent++; }
      if (o.isPoints) points++;
      if (o.isLine || o.isLineSegments || o.isLineLoop) lines++;
    });
    const wiz = (this.enemy && this.enemy.userData) || {};
    return {
      components: {
        sky: !!this._sky, moon: !!this._moon, stars: !!this._stars,
        academy: !!this._academy, arcadeColumns: (this._columns || []).length,
        archedWindows: this._windowCount || 0, banners: (this._banners || []).length,
        braziers: (this.braziers || []).length, floatingLights: (this._floatingLights || []).length,
        distantTowers: (this._towers || []).length, backWall: !!this._backWall,
        platform: !!this._platform, focusStones: (this.stones || []).length,
      },
      wizard: {
        parts: Object.keys(wiz.parts || {}),
        hasStaff: !!wiz.staff, hasHood: !!wiz.hood, hasBelt: !!wiz.belt,
        robeLayers: wiz.robeLayers || 0,
      },
      firstPerson: { gloveParts: this._gloveParts || 0, hasWand: !!this.wandTip },
      budget: {
        lights, meshes, transparent, points, lines,
        lightBudgetOk: lights <= 8, transparentBudgetOk: transparent <= 110,
      },
      reduced: this.reduced,
    };
  }

  // ---- per-frame update from live sim state ----
  update(sim, alpha, dtMs) {
    this._t += dtMs * 0.001;
    const player = sim.wizards[0];
    const enemy = sim.wizards[1];
    this._lastPlayer = player; this._lastEnemy = enemy;

    // Camera follows the player's strafe position; opponent under soft lock.
    const px = wizardX(player);
    const camBaseX = this.camera.position.x + (px - this.camera.position.x) * 0.3;
    const ex = wizardX(enemy);
    this.enemy.position.x += (ex - this.enemy.position.x) * 0.3;

    // Camera shake decays; heavy impacts push it up.
    let shakeX = 0, shakeY = 0;
    if (this.shake > 0.0005 && !this.reduced) {
      shakeX = (Math.sin(this._t * 91) + Math.sin(this._t * 57)) * 0.5 * this.shake;
      shakeY = Math.sin(this._t * 73) * this.shake;
      this.shake *= 0.86;
    } else { this.shake = 0; }
    this.camera.position.x = camBaseX + shakeX;
    this.camera.position.y = 1.7 + shakeY;
    this.camera.lookAt(this.enemy.position.x, 1.5 + shakeY * 0.5, ENEMY_Z);

    // Enemy casting tell: raise + tint the aura by school, and light the staff.
    const eAura = this.enemy.userData.aura;
    const eCrystal = this.enemy.userData.staffCrystal;
    if (enemy.casting) {
      const sp = SPELLS_BY_ID[enemy.casting.spellId];
      const col = SCHOOL_COLOR[sp?.school] || 0x8b6bff;
      eAura.material.color.setHex(col);
      const prog = 1 - enemy.casting.ticks / Math.max(1, enemy.casting.totalTicks || 1);
      eAura.material.opacity = 0.3 + prog * 0.6;
      this.enemy.userData.hand.position.y = 1.35 + prog * 0.5;
      if (eCrystal) { eCrystal.material.color.setHex(col); eCrystal.material.opacity = 0.6 + prog * 0.4; }
    } else {
      eAura.material.opacity *= 0.85;
      this.enemy.userData.hand.position.y += (1.35 - this.enemy.userData.hand.position.y) * 0.2;
      if (eCrystal) eCrystal.material.opacity += (0.55 - eCrystal.material.opacity) * 0.1;
    }

    // Player wand tip glows during own windup.
    if (player.casting) {
      const sp = SPELLS_BY_ID[player.casting.spellId];
      const col = SCHOOL_COLOR[sp?.school] || 0x8b6bff;
      this.wandTip.material.color.setHex(col);
      this.wandTip.material.opacity = 0.9;
      this.rightHand.position.z = -0.9 + 0.15;
    } else {
      this.wandTip.material.opacity *= 0.9;
      this.rightHand.position.z += (-0.9 - this.rightHand.position.z) * 0.2;
    }

    // Spell-specific cast windup cues (polled from state — robust to lost events).
    this._syncCastCues(sim);

    // Shields / barriers as Ward + Barrier Dome visuals.
    this._syncGuards(player, PLAYER_Z);
    this._syncGuards(enemy, ENEMY_Z);

    // Prismatic Beam channel visuals.
    this._syncBeams(sim);

    // Projectiles.
    this._syncProjectiles(sim, alpha);

    // Environmental zones.
    this._syncZones(sim);

    // Transient effects.
    this._updateAcademy(dtMs);
    this._updateEffects(dtMs);
    this._updateDebug(dtMs);

    // Reactive light: brighter with recent combat intensity.
    this.keyLight.intensity += (0.6 - this.keyLight.intensity) * 0.05;

    this.renderer.render(this.scene, this.camera);
  }

  _syncGuards(w, z) {
    const ward = w.id === 0 ? this.pWard : this.eWard;
    const dome = w.id === 0 ? this.pDome : this.eDome;
    ward.object3D.visible = !!w.shield;
    if (w.shield) {
      ward.object3D.position.set(wizardX(w), 1.1, z + (z > 0 ? -0.6 : 0.6));
      ward.object3D.lookAt(0, 1.1, 0);
      ward.update({ dtMs: 16, strength: 1, time: this._t });
    }
    dome.object3D.visible = !!w.barrier;
    if (w.barrier) {
      dome.object3D.position.set(wizardX(w), 1.2, z);
      dome.update({ dtMs: 16, strength: 1, time: this._t });
    }
  }

  _syncCastCues(sim) {
    const active = new Set();
    for (const w of sim.wizards) {
      if (!w.casting) continue;
      const spellId = w.casting.spellId;
      active.add(w.id);
      let cue = this.castCues.get(w.id);
      if (!cue || cue.spellId !== spellId) {
        if (cue) { this.scene.remove(cue.handle.object3D); cue.handle.dispose(); }
        const sp = SPELLS_BY_ID[spellId];
        const heavy = !!sp && sp.charges >= 1;
        const control = !!sp && sp.category === 'Control';
        const handle = makeCastCueVfx(spellId, this.reduced, { heavy, control });
        this.scene.add(handle.object3D);
        cue = { handle, spellId };
        this.castCues.set(w.id, cue);
      }
      const prog = 1 - w.casting.ticks / Math.max(1, w.casting.totalTicks || 1);
      if (w.id === 0) cue.handle.object3D.position.set(wizardX(w), 1.15, PLAYER_Z - 1.25);
      else cue.handle.object3D.position.set(wizardX(w), 1.7, ENEMY_Z + 0.35);
      cue.handle.update({ dtMs: 16, prog, time: this._t });
    }
    for (const [id, cue] of this.castCues) {
      if (!active.has(id)) { this.scene.remove(cue.handle.object3D); cue.handle.dispose(); this.castCues.delete(id); }
    }
  }

  _syncBeams(sim) {
    const active = new Set();
    for (const w of sim.wizards) {
      if (!w.channel) continue;
      active.add(w.id);
      let beam = this.beams.get(w.id);
      if (!beam || beam.spellId !== w.channel.spellId) {
        if (beam) { this.scene.remove(beam.handle.object3D); beam.handle.dispose(); }
        const handle = makeBeamVfx(w.channel.spellId, this.reduced);
        this.scene.add(handle.object3D);
        beam = { handle, spellId: w.channel.spellId };
        this.beams.set(w.id, beam);
      }
      const from = this._wizardWorld(w.id, 1.5);
      const to = this._wizardWorld(w.id === 0 ? 1 : 0, 1.4);
      beam.handle.update({ dtMs: 16, from, to, time: this._t });
    }
    for (const [id, beam] of this.beams) {
      if (!active.has(id)) { this.scene.remove(beam.handle.object3D); beam.handle.dispose(); this.beams.delete(id); }
    }
  }

  _syncProjectiles(sim, alpha) {
    const seen = new Set();
    for (const p of sim.projectiles) {
      seen.add(p.id);
      let entry = this.projMeshes.get(p.id);
      if (!entry) {
        const handle = makeProjectileVfx(p.spellId, this.reduced);
        this.scene.add(handle.object3D);
        entry = { handle, dir: new THREE.Vector3(0, 0, p.owner === 0 ? -1 : 1), lastPos: null, prog: 0, spellId: p.spellId };
        this.projMeshes.set(p.id, entry);
      }
      const total = Math.max(1, p.totalTicks || 1);
      const prog = Math.min(1, (total - p.ticks + alpha) / total);
      const ownerZ = p.owner === 0 ? PLAYER_Z : ENEMY_Z;
      const targetZ = p.owner === 0 ? ENEMY_Z : PLAYER_Z;
      const startX = (p.originPos ?? 0) * ARC_W;
      const endX = (p.targetPos ?? 0) * ARC_W;
      const groundHug = entry.handle.object3D.userData && entry.handle.object3D.userData.groundHug;
      const y = groundHug ? 0.12 : 1.4 + Math.sin(prog * Math.PI) * 0.25;
      const pos = entry.handle.object3D.position;
      const prevX = entry.lastPos ? entry.lastPos.x : startX;
      const prevY = entry.lastPos ? entry.lastPos.y : y;
      const prevZ = entry.lastPos ? entry.lastPos.z : ownerZ;
      pos.set(startX + (endX - startX) * prog, y, ownerZ + (targetZ - ownerZ) * prog);
      if (entry.lastPos) {
        this._tmpDir = this._tmpDir || new THREE.Vector3();
        this._tmpDir.set(pos.x - prevX, pos.y - prevY, pos.z - prevZ);
        if (this._tmpDir.lengthSq() > 1e-6) entry.dir.copy(this._tmpDir).normalize();
      }
      if (!entry.lastPos) entry.lastPos = new THREE.Vector3();
      entry.lastPos.copy(pos);
      entry.prog = prog;
      entry.handle.update({ dtMs: 16, prog, dir: entry.dir, reduced: this.reduced, owner: p.owner });
    }
    for (const [id, entry] of this.projMeshes) {
      if (!seen.has(id)) {
        // Spell-matched impact at the resolution point (skip clear near-origin fizzles).
        if (entry.prog > 0.55 && entry.lastPos) this._impactAt(entry.spellId, entry.lastPos.clone());
        this.scene.remove(entry.handle.object3D); entry.handle.dispose(); this.projMeshes.delete(id);
      }
    }
  }

  // Distinct environmental visuals per zone kind.
  _syncZones(sim) {
    const seen = new Set();
    for (const z of sim.zones) {
      seen.add(z.id);
      let handle = this.zoneMeshes.get(z.id);
      if (!handle) {
        const r = 1.4 + (z.radius || 0.55) * 3.4;
        handle = makeZoneVfx(z.kind, this.reduced, r);
        this.scene.add(handle.object3D);
        this.zoneMeshes.set(z.id, handle);
      }
      const centered = z.kind === 'Cover' || z.kind === 'Snare' || z.kind === 'Grounded';
      handle.object3D.position.x = centered ? (z.center || 0) * ARC_W : 0;
      const fade = Math.min(1, z.ticks / Math.max(1, z.totalTicks || 1));
      handle.update({ dtMs: 16, fade, time: this._t, reduced: this.reduced });
    }
    for (const [id, handle] of this.zoneMeshes) {
      if (!seen.has(id)) { this.scene.remove(handle.object3D); handle.dispose(); this.zoneMeshes.delete(id); }
    }
  }

  // ---- event-driven effects ----
  handleEvents(events, sim) {
    for (const e of events) {
      if (e.type === 'cast') {
        this.keyLight.intensity = 1.1;
        this._spawnRelease(e.spellId, e.caster);
      } else if (e.type === 'damage') {
        this._hurtFlash(e.target === 0 ? PLAYER_Z : ENEMY_Z, sim.wizards[e.target]);
        if (e.target === 0 && !this.reduced) this.shake = Math.max(this.shake, 0.02);
      } else if (e.type === 'reflect') {
        const reflector = sim.wizards[e.by];
        const rx = reflector ? wizardX(reflector) : 0;
        const rz = e.by === 0 ? PLAYER_Z : ENEMY_Z;
        const flash = makeReleaseVfx(12, this.reduced);
        if (flash) this._pushEffect(flash, new THREE.Vector3(rx, 1.3, rz + (rz > 0 ? -0.6 : 0.6)), true);
        this._impactAt(e.spellId, new THREE.Vector3(rx, 1.4, rz + (rz > 0 ? -0.4 : 0.4)));
      } else if (e.type === 'reaction') {
        this.keyLight.intensity = 1.8;
      } else if (e.type === 'phoenixSave' || e.type === 'phoenix') {
        const id = e.target ?? e.caster;
        const w = sim.wizards[id];
        const h = makeReleaseVfx(39, this.reduced);
        if (h) this._pushEffect(h, new THREE.Vector3(w ? wizardX(w) : 0, (h.anchorHeight ?? 0.9), id === 0 ? PLAYER_Z : ENEMY_Z));
      } else if (e.type === 'decoyHit') {
        this._impactAt(5, new THREE.Vector3(0, 1.4, ENEMY_Z + 0.4));
      } else if (e.type === 'shield' || e.type === 'barrier' || e.type === 'zone' || e.type === 'mirror') {
        this.keyLight.intensity = 1.2;
      } else if (e.type === 'roundEnd') {
        this.keyLight.intensity = 1.6;
      }
    }
  }

  // Spawn the instant release visual for a non-projectile / non-zone spell.
  _spawnRelease(spellId, casterId) {
    const eff = effectFor(spellId);
    if (!eff) return;
    // Projectiles / channels / zones / shields / barriers have their own state sync.
    if ([PROJECTILE, CHANNEL, ZONE, SHIELD, BARRIER].includes(eff.type)) return;
    const profile = getSpellVfx(spellId);
    if (!profile) return;
    const oppId = casterId === 0 ? 1 : 0;
    let from, to = null;
    if (profile.target === 'enemy') {
      from = this._wizardWorld(oppId, 1.4);
    } else if (profile.target === 'link') {
      from = this._wizardWorld(casterId, 1.4);
      to = this._wizardWorld(oppId, 1.4);
    } else if (profile.family === 'blink') {
      const w = casterId === 0 ? this._lastPlayer : this._lastEnemy;
      const opp = casterId === 0 ? this._lastEnemy : this._lastPlayer;
      const dir = (w && opp && w.arcPos >= opp.arcPos) ? 1 : -1;
      to = this._wizardWorld(casterId, 1.4);
      from = to.clone(); from.x -= dir * 0.5 * ARC_W;
    } else {
      from = this._wizardWorld(casterId, 1.4);
    }
    const handle = makeReleaseVfx(spellId, this.reduced, { from, to });
    if (!handle) return;
    const anchor = from.clone(); anchor.y = handle.anchorHeight ?? 1.4;
    this._pushEffect(handle, anchor);
  }

  _impactAt(spellId, worldPos) {
    const profile = getSpellVfx(spellId);
    const eff = effectFor(spellId);
    const scale = (eff && (eff.area || (eff.charges || 0) >= 1)) ? 1.5 : 1;
    const handle = makeImpactVfx(spellId, this.reduced, { scale });
    this._pushEffect(handle, this._cameraSafeEffectPosition(worldPos, 1.7), true);
    const sh = SHAKE_BY_SPELL[spellId];
    if (sh && !this.reduced) this.shake = Math.max(this.shake, sh);
    this.keyLight.intensity = Math.max(this.keyLight.intensity, 1.2);
    if (profile && SCHOOL_COLOR[profile.school]) this.keyLight.color.setHex(SCHOOL_COLOR[profile.school]);
  }

  _hurtFlash(z, w) {
    if (this.reduced) return;
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff5d73, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const raw = new THREE.Vector3(w ? wizardX(w) : 0, 1.4, z + (z > 0 ? -1.5 : 1.5));
    const pos = this._cameraSafeEffectPosition(raw, 1.6);
    const handle = {
      object3D: flash, kind: 'hurt', family: 'impact', _age: 0,
      update(ctx) { this._age += ctx.dtMs || 16; const t = this._age / 260; flash.scale.setScalar(1 + t * 1.2); flash.material.opacity = Math.max(0, 0.8 * (1 - t)); return this._age < 260; },
      dispose() { flash.geometry.dispose(); flash.material.dispose(); },
    };
    this._pushEffect(handle, pos);
  }

  _cameraSafeEffectPosition(worldPos, minDistance) {
    const pos = worldPos.clone();
    const delta = pos.clone().sub(this.camera.position);
    if (delta.length() < minDistance) {
      if (delta.lengthSq() < 1e-6) delta.set(0, -0.15, -1);
      pos.copy(this.camera.position).add(delta.normalize().multiplyScalar(minDistance));
    }
    return pos;
  }

  _pushEffect(handle, worldPos, billboardable = false) {
    if (worldPos) handle.object3D.position.copy(worldPos);
    this.scene.add(handle.object3D);
    // Cap live transient effects to bound worst-case clutter.
    while (this.effects.length >= MAX_EFFECTS) {
      const old = this.effects.shift();
      this.scene.remove(old.handle.object3D); old.handle.dispose();
    }
    this.effects.push({ handle, billboardable });
  }

  _updateEffects(dtMs) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.handle.billboard) e.handle.object3D.quaternion.copy(this.camera.quaternion);
      const alive = e.handle.update({ dtMs, time: this._t });
      if (alive === false) { this.scene.remove(e.handle.object3D); e.handle.dispose(); this.effects.splice(i, 1); }
    }
  }

  // ---- dev-only VFX gallery (never wired to production UI) ----
  // Spawns a representative renderable for one spell so a headless smoke test /
  // developer can confirm every family draws without WebGL errors and that the
  // produced object kinds differ. Returns the VFX kind string.
  debugSpawn(spellId) {
    const profile = getSpellVfx(spellId);
    if (!profile) return null;
    const eff = effectFor(spellId);
    const fam = profile.family;
    const midZ = ENEMY_Z + 2;
    let entry = null;

    if (PROJECTILE_FAMILIES.has(fam)) {
      const handle = makeProjectileVfx(spellId, this.reduced);
      this.scene.add(handle.object3D);
      const dir = new THREE.Vector3(0, 0, 1);
      entry = { handle, age: 0, life: 1700, kind: handle.kind };
      entry.tick = (dt) => {
        entry.age += dt; const prog = Math.min(1, entry.age / 1200);
        const gh = handle.object3D.userData && handle.object3D.userData.groundHug;
        handle.object3D.position.set(0, gh ? 0.12 : 1.4 + Math.sin(prog * Math.PI) * 0.25, ENEMY_Z + (PLAYER_Z - ENEMY_Z - 3) * prog);
        handle.update({ dtMs: dt, prog, dir, reduced: this.reduced, owner: 1 });
        if (prog >= 1 && !entry._hit) { entry._hit = true; this._impactAt(spellId, handle.object3D.position.clone()); }
      };
    } else if (fam === 'zone') {
      const kind = (eff && eff.zoneKind) || 'Fog';
      const handle = makeZoneVfx(kind, this.reduced, 2.6);
      handle.object3D.position.set(0, 0, midZ);
      this.scene.add(handle.object3D);
      entry = { handle, age: 0, life: 2600, kind: handle.kind };
      entry.tick = (dt) => { entry.age += dt; handle.update({ dtMs: dt, fade: 1 - entry.age / entry.life, time: this._t, reduced: this.reduced }); };
    } else if (fam === 'ward' || fam === 'dome') {
      const handle = fam === 'ward' ? makeWardVfx(this.reduced) : makeDomeVfx(this.reduced);
      handle.object3D.position.set(0, 1.2, midZ);
      this.scene.add(handle.object3D);
      entry = { handle, age: 0, life: 2200, kind: handle.kind };
      entry.tick = (dt) => { entry.age += dt; handle.update({ dtMs: dt, strength: 1, time: this._t }); };
    } else if (fam === 'beam') {
      const handle = makeBeamVfx(spellId, this.reduced);
      this.scene.add(handle.object3D);
      entry = { handle, age: 0, life: 2200, kind: handle.kind };
      entry.tick = (dt) => { entry.age += dt; handle.update({ dtMs: dt, from: new THREE.Vector3(0, 1.5, ENEMY_Z), to: new THREE.Vector3(0, 1.4, midZ + 2), time: this._t }); };
    } else {
      const from = new THREE.Vector3(0, 1.4, midZ);
      const to = new THREE.Vector3(1.4, 1.4, PLAYER_Z - 2);
      const handle = makeReleaseVfx(spellId, this.reduced, { from, to });
      if (!handle) return null;
      handle.object3D.position.set(from.x, handle.anchorHeight ?? 1.4, from.z);
      this.scene.add(handle.object3D);
      entry = { handle, age: 0, life: 2400, kind: handle.kind };
      entry.tick = (dt) => {
        entry.age += dt;
        if (handle.billboard) handle.object3D.quaternion.copy(this.camera.quaternion);
        const alive = handle.update({ dtMs: dt, time: this._t });
        if (alive === false) entry.age = entry.life;
      };
    }

    while (this._debug.length >= 16) { const old = this._debug.shift(); this.scene.remove(old.handle.object3D); old.handle.dispose(); }
    this._debug.push(entry);
    return entry.kind;
  }

  debugKinds() { return this._debug.map((e) => e.kind); }

  debugProductionRelease(spellId) {
    this._spawnRelease(Number(spellId), 0);
    return this.effects.length ? this.effects[this.effects.length - 1].handle.kind : null;
  }

  debugProductionMotion() {
    if (!this.effects.length) return null;
    let rotation = 0;
    this.effects[this.effects.length - 1].handle.object3D.traverse((o) => {
      rotation += o.rotation.x + o.rotation.y + o.rotation.z;
    });
    return Number(rotation.toFixed(5));
  }

  debugProductionCount() { return this.effects.length; }

  debugPlayerHitSafety(spellId = 8) {
    const start = this.effects.length;
    const raw = new THREE.Vector3(this.camera.position.x, 1.4, PLAYER_Z);
    this._impactAt(Number(spellId), raw);
    this._hurtFlash(PLAYER_Z, { arcPos: this.camera.position.x / ARC_W });
    return this.effects.slice(start).map((e) =>
      Number(e.handle.object3D.position.distanceTo(this.camera.position).toFixed(3)));
  }

  // Spawn any environmental zone kind by name (including the reaction-only
  // Fire / Frozen / Grounded zones that no single spell casts) so the VFX
  // gallery / smoke test can confirm the whole weather family draws distinctly.
  debugSpawnZone(kind) {
    const handle = makeZoneVfx(kind, this.reduced, 2.6);
    handle.object3D.position.set(0, 0, ENEMY_Z + 2);
    this.scene.add(handle.object3D);
    const entry = { handle, age: 0, life: 2600, kind: handle.kind };
    entry.tick = (dt) => { entry.age += dt; handle.update({ dtMs: dt, fade: 1 - entry.age / entry.life, time: this._t, reduced: this.reduced }); };
    while (this._debug.length >= 16) { const old = this._debug.shift(); this.scene.remove(old.handle.object3D); old.handle.dispose(); }
    this._debug.push(entry);
    return entry.kind;
  }

  debugClear() {
    for (const e of this._debug) { this.scene.remove(e.handle.object3D); e.handle.dispose(); }
    this._debug = [];
  }

  _updateDebug(dtMs) {
    for (let i = this._debug.length - 1; i >= 0; i--) {
      const e = this._debug[i];
      e.tick(dtMs);
      if (e.age >= e.life) { this.scene.remove(e.handle.object3D); e.handle.dispose(); this._debug.splice(i, 1); }
    }
  }
}
