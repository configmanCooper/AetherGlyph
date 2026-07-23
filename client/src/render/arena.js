// arena.js — first-person Three.js arena for The Confluence.
//
// Renders the opposing wizard, the player's own hands/wand cues, projectiles,
// shields/barriers, the dueling platform + focus stones, and reactive lighting.
// Health/resources remain in the HTML HUD; this module also mirrors active
// statuses onto both wizard representations with compact color-coded auras.
//
// The per-spell visual identity lives in ./spellVfx.js (data-driven by
// ./spellVfxProfiles.js). This module owns object lifetime: it creates a VFX
// handle per projectile/zone/effect, drives its update() each frame, and calls
// dispose() when the source ends so geometries/materials never leak. Transient
// effects are capped so worst-case clutter stays bounded on low-end Android.

import * as THREE from 'three';
import { SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';
import { effectFor, PROJECTILE, CHANNEL, ZONE, SHIELD, BARRIER } from '@shared/sim/spellEffects.js';
import { getSpellVfx, getReactionVfx } from './spellVfxProfiles.js';
import {
  makeProjectileVfx, makeImpactVfx, makeZoneVfx, makeReleaseVfx,
  makeWardVfx, makeDomeVfx, makeReflectGuardVfx, makeBeamVfx, makeCastCueVfx, makeReactionVfx,
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

const STATUS_COLOR = {
  Burning: 0xff4a1c, Chilled: 0x64d8ff, Sloth: 0xa56de2, Wet: 0x65bfff, Soaked: 0x368cff,
  Static: 0xffe45c, Sundered: 0xff7a4d, Weakened: 0xb56cff, Marked: 0xff4fd8,
  Blinded: 0xf4f4ff, Veiled: 0x7863aa, Rooted: 0x70cf5c, KnockedDown: 0xd9a66f, Frozen: 0xb9f4ff,
  Stunned: 0xffff73, Haste: 0x63ff9b, Grounded: 0xc6a878,
  AetherSurge: 0x45f6ff, Attunement: 0xff8738, Phoenix: 0xffd36a,
};
const STATUS_PRIORITY = [
  'Frozen', 'Stunned', 'KnockedDown', 'Burning', 'Rooted', 'Static', 'Chilled', 'Soaked', 'Wet',
  'Marked', 'Sundered', 'Weakened', 'Sloth', 'Blinded', 'Veiled',
  'Phoenix', 'Grounded', 'AetherSurge', 'Attunement', 'Haste',
];

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
    this._buildFogVeil();
    this._buildBlindVeil();

    this._buildLights();
    this._buildSky();
    this._buildArena();
    this._buildAcademy();
    this._buildEnemy();
    this._buildMenuPlayer();
    this._buildHands();
    this._buildStatusIndicators();

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

  _buildFogVeil() {
    const material = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        time: { value: 0 },
        strength: { value: 0 },
        reduced: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform float time;
        uniform float strength;
        uniform float reduced;
        void main() {
          float t = time * (1.0 - reduced);
          float a = sin(vUv.x * 18.0 + t * 0.7 + sin(vUv.y * 9.0 - t * 0.35));
          float b = sin(vUv.y * 23.0 - t * 0.5 + cos(vUv.x * 11.0 + t * 0.25));
          float haze = 0.5 + 0.25 * a + 0.25 * b;
          float edge = smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
          float alpha = strength * (0.30 + haze * 0.22) * edge;
          vec3 color = mix(vec3(0.34,0.38,0.46), vec3(0.58,0.63,0.70), haze);
          gl_FragColor = vec4(color, alpha);
        }`,
    });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    veil.frustumCulled = false;
    veil.renderOrder = 1000;
    veil.visible = false;
    this.camera.add(veil);
    this.fogVeil = veil;
  }

  _updateFogVeil(strength) {
    if (!this.fogVeil) return;
    const value = Math.max(0, Math.min(1, Number(strength) || 0));
    this.fogVeil.visible = value > 0.001;
    this.fogVeil.material.uniforms.time.value = this._t;
    this.fogVeil.material.uniforms.strength.value = value;
    this.fogVeil.material.uniforms.reduced.value = this.reduced ? 1 : 0;
  }

  _buildBlindVeil() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: false, opacity: 1,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.4), material);
    veil.visible = false;
    veil.renderOrder = 20;
    veil.layers.set(2);
    this.scene.add(veil);
    this.blindVeil = veil;
  }

  _syncBlindness(player, enemy) {
    if (!this.blindVeil) return;
    const blinded = !!player?.statuses?.Blinded && player.statuses.Blinded.ticks > 0;
    this.blindVeil.visible = blinded;
    if (!blinded) return;
    this.blindVeil.position.set(wizardX(enemy), 1.65, ENEMY_Z + 0.72);
    this.blindVeil.lookAt(this.camera.position);
    this.blindVeil.material.opacity = 1;
  }

  _renderScene() {
    const oldMask = this.camera.layers.mask;
    const background = this.scene.background;
    this.renderer.autoClear = false;
    this.renderer.clear(true, true, true);

    this.camera.layers.set(0);
    this.renderer.render(this.scene, this.camera);
    this.scene.background = null;

    if (this.blindVeil?.visible) {
      this.renderer.clearDepth();
      this.camera.layers.set(2);
      this.renderer.render(this.scene, this.camera);
    }

    this.renderer.clearDepth();
    this.camera.layers.set(1);
    const restoredBlendings = this.blindVeil?.visible ? this._prepareBlindSpellBlending() : [];
    this.renderer.render(this.scene, this.camera);
    for (const [material, blending] of restoredBlendings) material.blending = blending;

    this.camera.layers.mask = oldMask;
    this.scene.background = background;
    this.renderer.autoClear = true;
  }

  _prepareBlindSpellBlending() {
    const restored = [];
    this.scene.traverse((object) => {
      if ((object.layers.mask & 2) === 0 || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material.transparent && material.blending === THREE.AdditiveBlending) {
          restored.push([material, material.blending]);
          material.blending = THREE.NormalBlending;
        }
      }
    });
    return restored;
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
    this.scene.traverse((object) => {
      if (object.isLight) object.layers.enable(1);
    });
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
    this._platformRing = ring;

    // Inlaid courtyard sigil-ring on the dueling floor for academy flavour.
    const inlay = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 5.7, 48),
      new THREE.MeshBasicMaterial({ color: 0x6a52a8, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.015;
    this.scene.add(inlay);
    this._platformInlay = inlay;

    // Three destructible waist-high focus stones across the middle.
    this.stones = [];
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a3d63, roughness: 1 });
    for (const x of [-2.6, 0, 2.6]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.7), stoneMat.clone());
      s.position.set(x, 0.5, 0);
      this.scene.add(s); this.stones.push(s);
    }
  }

  // A readable, front-facing academy duelist assembled from simple procedural
  // primitives (no external assets). The silhouette reads as a person, not a
  // stack of cones: planted legs + boots, a layered flared robe skirt separated
  // from a tailored bodice, a shoulder mantle with pauldrons, two ARTICULATED
  // arms (upper + fore + hand) — the off arm grips a held staff, the cast arm
  // carries the school-tintable aura — a neck + head with an expressive FACE
  // (eyes, brows, nose, moustache, silver beard) framed (not hidden) by a
  // back-cowl hood and an asymmetric brimmed hat. The model's FRONT is +Z
  // (placket / buckle / crest / face), so _buildEnemy leaves rotation.y = 0 to
  // face the player. Colours are kept off pure-black; only robe colour + accent
  // differ between duelists. userData drives idle/cast animation + debug stats.
  _robeFigure(color, accent = 0x8b6bff) {
    const g = new THREE.Group();
    const base = new THREE.Color(color);
    const darkHex = base.clone().multiplyScalar(0.62).getHex();   // under-robe (lifted off black)
    const midHex = base.clone().multiplyScalar(0.82).getHex();    // front panels
    const liteHex = base.clone().lerp(new THREE.Color(0xffffff), 0.16).getHex();
    const hatHex = base.clone().multiplyScalar(0.7).getHex();

    const robeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const underMat = new THREE.MeshStandardMaterial({ color: darkHex, roughness: 0.9 });
    const panelMat = new THREE.MeshStandardMaterial({ color: midHex, roughness: 0.85 });
    const mantleMat = new THREE.MeshStandardMaterial({ color: midHex, roughness: 0.82, side: THREE.DoubleSide });
    const trimMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.45, roughness: 0.5 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe9d6ba, emissive: 0x3a2c1e, emissiveIntensity: 0.18, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0xd9d4e4, roughness: 0.85 }); // silver beard / brows
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 0.7, metalness: 0.15 }); // belt / boots / staff
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a7f9c, roughness: 0.45, metalness: 0.55 });   // buckle / claw
    const hatMat = new THREE.MeshStandardMaterial({ color: hatHex, roughness: 0.85 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf3f2f6, roughness: 0.4 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x241d33, roughness: 0.5 });
    const parts = {};

    // ---- lower body: two planted legs + boots (robe is separated above) ----
    const legMat = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.5).getHex(), roughness: 0.9 });
    const legGeo = new THREE.CylinderGeometry(0.11, 0.1, 0.72, 8);
    const bootGeo = new THREE.BoxGeometry(0.24, 0.22, 0.44);
    const bootCuffGeo = new THREE.TorusGeometry(0.14, 0.035, 6, 12);
    for (const sx of [-0.17, 0.17]) {
      const leg = new THREE.Mesh(legGeo, legMat); leg.position.set(sx, 0.54, 0); g.add(leg);
      const boot = new THREE.Mesh(bootGeo, leatherMat); boot.position.set(sx, 0.12, 0.09); g.add(boot);
      const cuff = new THREE.Mesh(bootCuffGeo, trimMat); cuff.rotation.x = Math.PI / 2; cuff.position.set(sx, 0.26, 0.02); g.add(cuff);
    }
    parts.legs = true; parts.boots = true;

    // ---- layered robe skirt: flared frustums (not a full spike cone) with an
    // open front (two swept panels) + a lit hem. Planted on the ground group. ----
    const underSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.58, 1.22, 16, 1, true), underMat);
    underSkirt.position.y = 0.79; g.add(underSkirt);
    const overSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.64, 1.0, 16, 1, true), robeMat);
    overSkirt.position.y = 0.92; g.add(overSkirt); parts.robe = overSkirt;
    const panelGeo = new THREE.BoxGeometry(0.26, 1.02, 0.05);
    const lPanel = new THREE.Mesh(panelGeo, panelMat); lPanel.position.set(-0.15, 0.92, 0.42); lPanel.rotation.set(0.05, 0, 0.13); g.add(lPanel);
    const rPanel = new THREE.Mesh(panelGeo, panelMat); rPanel.position.set(0.15, 0.92, 0.42); rPanel.rotation.set(0.05, 0, -0.13); g.add(rPanel);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 6, 22), trimMat);
    hem.rotation.x = Math.PI / 2; hem.position.y = 0.42; g.add(hem); parts.trim = hem;
    parts.robePanels = true;

    // ================= upper body (breathes as one unit) =================
    const torso = new THREE.Group(); g.add(torso);

    // Tailored bodice + inner tunic layer, front placket (opening) + V-collar.
    const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.6, 14), robeMat);
    bodice.position.y = 1.5; torso.add(bodice);
    const tunic = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.32, 0.52, 12), underMat);
    tunic.position.y = 1.3; torso.add(tunic); parts.tunic = tunic;
    const placket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.66, 0.05), trimMat);
    placket.position.set(0, 1.5, 0.31); torso.add(placket);
    const collarGeo = new THREE.BoxGeometry(0.26, 0.05, 0.06);
    const lCollar = new THREE.Mesh(collarGeo, trimMat); lCollar.position.set(-0.09, 1.73, 0.26); lCollar.rotation.z = -0.5; torso.add(lCollar);
    const rCollar = new THREE.Mesh(collarGeo, trimMat); rCollar.position.set(0.09, 1.73, 0.26); rCollar.rotation.z = 0.5; torso.add(rCollar);
    parts.collar = true;

    // Academy crest / sigil on the chest (disc + star).
    const crest = new THREE.Group();
    const crestDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), new THREE.MeshStandardMaterial({ color: liteHex, roughness: 0.55, metalness: 0.25 }));
    crestDisc.rotation.x = Math.PI / 2; crest.add(crestDisc);
    const crestStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), trimMat); crestStar.scale.set(1, 1, 0.45); crestStar.position.z = 0.03; crest.add(crestStar);
    crest.position.set(0, 1.58, 0.32); torso.add(crest); parts.crest = true;

    // Belt + buckle at the waist.
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.055, 6, 20), leatherMat);
    belt.rotation.x = Math.PI / 2; belt.position.y = 1.21; torso.add(belt); parts.belt = belt;
    const buckle = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), metalMat); buckle.position.set(0, 1.21, 0.31); torso.add(buckle);

    // Shoulder mantle (short cape) + pauldrons.
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.52, 0.42, 16, 1, true), mantleMat);
    mantle.position.y = 1.66; torso.add(mantle); parts.mantle = true;
    const pauldronGeo = new THREE.SphereGeometry(0.14, 10, 8);
    for (const sx of [-0.37, 0.37]) { const p = new THREE.Mesh(pauldronGeo, trimMat); p.position.set(sx, 1.74, 0); p.scale.y = 0.66; torso.add(p); }
    parts.shoulders = true;

    // ---- two articulated arms (shoulder pivot -> upper + elbow + fore + hand) ----
    const upperGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.4, 8);
    const foreGeo = new THREE.CylinderGeometry(0.085, 0.075, 0.4, 8);
    const jointGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const handGeo = new THREE.SphereGeometry(0.11, 10, 8);
    const armCuffGeo = new THREE.TorusGeometry(0.088, 0.028, 6, 10);
    const makeArm = () => {
      const arm = new THREE.Group(); // origin = shoulder
      const sj = new THREE.Mesh(jointGeo, robeMat); arm.add(sj);
      const upper = new THREE.Mesh(upperGeo, robeMat); upper.position.y = -0.22; arm.add(upper);
      const elbow = new THREE.Mesh(jointGeo, robeMat); elbow.position.y = -0.44; elbow.scale.setScalar(0.82); arm.add(elbow);
      const fore = new THREE.Mesh(foreGeo, robeMat); fore.position.y = -0.66; arm.add(fore);
      const cuff = new THREE.Mesh(armCuffGeo, trimMat); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.85; arm.add(cuff);
      const hand = new THREE.Mesh(handGeo, skinMat); hand.position.y = -0.92; arm.add(hand);
      return { arm, hand };
    };

    // Off arm (left) — swept forward + inward to grip the staff.
    const off = makeArm();
    off.arm.position.set(-0.34, 1.72, 0.02);
    off.arm.rotation.set(-0.24, 0.05, -0.16);
    torso.add(off.arm); parts.leftArm = true;

    // Cast arm (right) — carries the tintable aura, extends toward the player.
    const cast = makeArm();
    cast.arm.position.set(0.34, 1.72, 0.02);
    const restCastX = -0.16;
    cast.arm.rotation.set(restCastX, -0.05, 0.14);
    torso.add(cast.arm); parts.rightArm = true;
    const hand = cast.hand; parts.hand = hand;
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 16), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    hand.add(aura);

    // ---- neck + head (its own pivot for the "looking at you" tilt) ----
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.16, 10), skinMat);
    neck.position.y = 1.88; torso.add(neck); parts.neck = true;
    const head = new THREE.Group(); head.position.y = 2.05; torso.add(head); parts.head = true;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 16), skinMat); head.add(skull);

    // Expressive face on the +Z front: eyes (with pupils), angled brows, a nose,
    // a moustache and a swept silver beard framing the chin.
    const eyeGeo = new THREE.SphereGeometry(0.052, 10, 8);
    const pupilGeo = new THREE.SphereGeometry(0.026, 8, 6);
    const browGeo = new THREE.BoxGeometry(0.14, 0.03, 0.04);
    for (const sx of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat); eye.position.set(sx, 0.04, 0.21); eye.scale.set(1, 0.85, 0.7); head.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat); pupil.position.set(0, 0, 0.045); eye.add(pupil);
      const brow = new THREE.Mesh(browGeo, hairMat); brow.position.set(sx, 0.13, 0.2); brow.rotation.z = sx < 0 ? 0.16 : -0.16; head.add(brow);
    }
    parts.eyes = true; parts.brows = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 8), skinMat);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.02, 0.25); head.add(nose); parts.nose = true;
    const moustache = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.08), hairMat);
    moustache.position.set(0, -0.1, 0.2); moustache.rotation.x = 0.2; head.add(moustache);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.34, 12), hairMat);
    beard.rotation.x = Math.PI; beard.position.set(0, -0.26, 0.11); beard.scale.set(1, 1, 0.7); head.add(beard); parts.beard = true;

    // Back-cowl hood (rear half only) so it frames the face without hiding it.
    const hood = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.62, 14, 1, true, Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ color: darkHex, roughness: 0.9, side: THREE.DoubleSide }),
    );
    hood.position.set(0, 0.06, -0.03); hood.rotation.x = -0.14; head.add(hood); parts.hood = hood;

    // Asymmetric brimmed wizard hat: shaped drooping brim, banded leaning crown,
    // a small star sigil. The brim sits above the brows, framing the face.
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.14, 20, 1, true), hatMat);
    brim.position.set(0, 0.29, 0); brim.rotation.set(0.05, 0, 0.06); head.add(brim);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.31, 1.0, 16), hatMat);
    crown.position.set(0.04, 0.78, -0.01); crown.rotation.z = 0.16; head.add(crown); parts.hat = true;
    const crownTip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 12), hatMat);
    crownTip.position.set(0.16, 1.24, -0.02); crownTip.rotation.z = 0.5; head.add(crownTip);
    const hatBand = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.045, 6, 16), trimMat);
    hatBand.rotation.x = Math.PI / 2; hatBand.position.set(0, 0.33, 0); hatBand.rotation.z = 0.06; head.add(hatBand);
    const hatStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), trimMat); hatStar.position.set(0, 0.52, 0.24); head.add(hatStar);

    // ---- staff, positioned so the OFF hand actually grips it (computed) ----
    torso.updateMatrixWorld(true);
    const gripPos = off.hand.getWorldPosition(new THREE.Vector3()); // g-local (g at origin during build)
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.5, 8), leatherMat);
    shaft.position.y = 1.15; staff.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x2c2438, roughness: 0.6 }));
    grip.position.y = gripPos.y; staff.add(grip); parts.grip = true;
    const crook = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14, Math.PI * 1.2), metalMat);
    crook.position.y = 2.34; crook.rotation.x = Math.PI / 2; crook.rotation.z = -0.3; staff.add(crook);
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15, 0),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    crystal.position.y = 2.5; staff.add(crystal);
    staff.position.set(gripPos.x, 0, gripPos.z);
    torso.add(staff); parts.staff = staff; parts.staffCrystal = true;

    g.userData = {
      // cast-tell + legacy contract
      hand, aura, robe: overSkirt, staff, hood, belt, staffCrystal: crystal, parts,
      robeLayers: 3, robePanels: 4,
      // animation rig
      torso, head, castArm: cast.arm, offArm: off.arm, offHand: off.hand, staffShaft: shaft,
      rest: { torsoY: 0, castArmX: restCastX, headX: 0.14 },
      anim: { enabled: false, breath: 0, castRaise: 0 },
      // debug metadata
      meta: { eyes: 2, nose: true, beard: true, brows: true, arms: 2, articulated: true, crest: true, mantle: true },
    };
    // Start in the static rest pose (correct look under reduced motion / frame 0).
    head.rotation.x = 0.14;
    return g;
  }

  _buildEnemy() {
    this.enemy = this._robeFigure(0x4c3c72, 0xb98bff);
    this.enemy.position.set(0, 0, ENEMY_Z);
    // The figure's front (placket, buckle, crest, face) is built on +Z and the
    // camera/player stand at +Z, so no yaw is needed to face the player. (The
    // previous rotation.y = PI turned the model's BACK to the camera.)
    this.enemy.rotation.y = 0;
    this.scene.add(this.enemy);
  }

  _buildMenuPlayer() {
    this.menuPlayer = this._robeFigure(0x243f68, 0x55e2ff);
    this.menuPlayer.position.set(0, 0, PLAYER_Z);
    this.menuPlayer.visible = false;
    this.scene.add(this.menuPlayer);
  }

  // Restrained opponent animation: idle breathing + robe/head sway (skipped
  // under reduced motion) plus a casting tell — the cast arm extends toward the
  // player while the aura and staff crystal light up in the school colour. The
  // casting tell is gameplay-relevant, so it stays active (snapping instantly)
  // even under reduced motion; only the decorative idle sway is suppressed.
  _animateEnemy(dtMs, enemyState) {
    const e = this.enemy; if (!e) return;
    const ud = e.userData; const t = this._t;
    const casting = enemyState && enemyState.casting ? enemyState.casting : null;
    const knockedDown = !!(enemyState?.statuses?.KnockedDown?.ticks > 0);
    const prog = casting ? 1 - casting.ticks / Math.max(1, casting.totalTicks || 1) : 0;
    const targetFall = knockedDown ? 1.35 : 0;
    const fallK = this.reduced ? 1 : 1 - Math.exp(-14 * Math.max(0, dtMs) * 0.001);
    e.rotation.z += (targetFall - e.rotation.z) * fallK;

    // Aura tint + staff crystal glow (school-coloured cast tell).
    const aura = ud.aura, crystal = ud.staffCrystal;
    if (casting) {
      const sp = SPELLS_BY_ID[casting.spellId];
      const col = SCHOOL_COLOR[sp?.school] || 0x8b6bff;
      if (aura) { aura.material.color.setHex(col); aura.material.opacity = 0.3 + prog * 0.6; }
      if (crystal) { crystal.material.color.setHex(col); crystal.material.opacity = 0.6 + prog * 0.4; }
    } else {
      if (aura) aura.material.opacity *= 0.85;
      if (crystal) crystal.material.opacity += (0.5 - crystal.material.opacity) * 0.1;
    }

    // Cast arm extension toward the player (0 at rest, forward+up while casting).
    const targetRaise = casting ? 0.5 + prog * 0.7 : 0;
    const k = this.reduced ? 1 : 1 - Math.exp(-12 * Math.max(0, dtMs) * 0.001);
    ud.anim.castRaise += (targetRaise - ud.anim.castRaise) * k;
    if (ud.castArm) ud.castArm.rotation.x = ud.rest.castArmX - ud.anim.castRaise;

    // Idle life: breathing bob + robe/shoulder sway + head looking at the player.
    if (this.reduced) {
      if (ud.torso) { ud.torso.position.y = ud.rest.torsoY; ud.torso.rotation.z = 0; }
      if (ud.robe) ud.robe.rotation.z = 0;
      if (ud.head) ud.head.rotation.set(ud.rest.headX, 0, 0);
      ud.anim.enabled = false; ud.anim.breath = 0;
      return;
    }
    const breath = Math.sin(t * 1.5);
    if (ud.torso) { ud.torso.position.y = ud.rest.torsoY + breath * 0.014; ud.torso.rotation.z = Math.sin(t * 0.7) * 0.012; }
    if (ud.robe) ud.robe.rotation.z = Math.sin(t * 0.6 + 0.5) * 0.02;
    if (ud.head) {
      ud.head.rotation.x = ud.rest.headX + breath * 0.03;
      ud.head.rotation.y = Math.sin(t * 0.5) * 0.05;
    }
    ud.anim.enabled = true; ud.anim.breath = +breath.toFixed(3);
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
    this._handStatusMats = { glove: gloveMat, trim: trimMat };
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

  _makeStatusAura(radius) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, Math.max(0.018, radius * 0.035), 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.75,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    group.add(ring);
    const orbs = [];
    for (let i = 0; i < 3; i++) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.035, radius * 0.09), 8, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.85,
          depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      group.add(orb); orbs.push(orb);
    }
    group.visible = false;
    group.userData.statusAura = { ring, orbs, radius };
    return group;
  }

  _buildStatusIndicators() {
    this.enemyStatusAura = this._makeStatusAura(0.92);
    this.scene.add(this.enemyStatusAura);
    this.playerStatusAura = this._makeStatusAura(0.17);
    this.playerStatusAura.position.set(0, -0.01, 0.04);
    this.leftHand.add(this.playerStatusAura);
  }

  _activeStatusStyles(w) {
    const statuses = w?.statuses || {};
    return STATUS_PRIORITY
      .filter((name) => statuses[name] && statuses[name].ticks > 0)
      .map((name) => ({ name, color: STATUS_COLOR[name] }));
  }

  _syncStatusAura(aura, styles, hidden = false) {
    const data = aura.userData.statusAura;
    aura.visible = !hidden && styles.length > 0;
    if (!aura.visible) return;
    const pulse = this.reduced ? 1 : 1 + Math.sin(this._t * 5.2) * 0.09;
    aura.scale.setScalar(pulse);
    data.ring.material.color.setHex(styles[0].color);
    data.ring.material.opacity = this.reduced ? 0.72 : 0.58 + Math.sin(this._t * 6.5) * 0.18;
    for (let i = 0; i < data.orbs.length; i++) {
      const orb = data.orbs[i], style = styles[i];
      orb.visible = !!style;
      if (!style) continue;
      orb.material.color.setHex(style.color);
      const angle = this._t * (this.reduced ? 0 : 1.4) + i * (Math.PI * 2 / 3);
      orb.position.set(Math.cos(angle) * data.radius, Math.sin(angle) * data.radius, 0.03);
    }
  }

  _syncStatusIndicators(player, enemy) {
    const playerStyles = this._activeStatusStyles(player);
    const enemyStyles = this._activeStatusStyles(enemy);
    this._syncStatusAura(this.playerStatusAura, playerStyles, player?.invisibleTicks > 0);
    this._syncStatusAura(this.enemyStatusAura, enemyStyles, enemy?.invisibleTicks > 0);
    this.enemyStatusAura.position.set(wizardX(enemy || { arcPos: 0 }), 1.4, ENEMY_Z + 0.08);
    this.enemyStatusAura.lookAt(this.camera.position);

    const primary = playerStyles[0];
    const mats = this._handStatusMats;
    if (primary) {
      const pulse = this.reduced ? 0.7 : 0.55 + Math.sin(this._t * 6.2) * 0.25;
      mats.glove.emissive.setHex(primary.color); mats.glove.emissiveIntensity = pulse;
      mats.trim.color.setHex(primary.color); mats.trim.emissive.setHex(primary.color);
      mats.trim.emissiveIntensity = 0.65 + pulse * 0.45;
    } else {
      mats.glove.emissive.setHex(0x000000); mats.glove.emissiveIntensity = 0;
      mats.trim.color.setHex(0x8b6bff); mats.trim.emissive.setHex(0x5a3fb0); mats.trim.emissiveIntensity = 0.4;
    }
  }

  _syncWizardVisibility(player, enemy) {
    this.enemy.visible = !(enemy?.invisibleTicks > 0);
    this.handRig.visible = !(player?.invisibleTicks > 0);
  }

  // Ward (frontal rune disc) + Barrier Dome (layered sphere) + Reflect (angled
  // mirror plane) visuals per wizard.
  _buildGuards() {
    this.pWard = makeWardVfx(this.reduced); this.pWard.object3D.visible = false; this.scene.add(this.pWard.object3D);
    this.eWard = makeWardVfx(this.reduced); this.eWard.object3D.visible = false; this.scene.add(this.eWard.object3D);
    this.pDome = makeDomeVfx(this.reduced); this.pDome.object3D.visible = false; this.scene.add(this.pDome.object3D);
    this.eDome = makeDomeVfx(this.reduced); this.eDome.object3D.visible = false; this.scene.add(this.eDome.object3D);
    this.pReflect = makeReflectGuardVfx(this.reduced); this.pReflect.object3D.visible = false; this.scene.add(this.pReflect.object3D);
    this.eReflect = makeReflectGuardVfx(this.reduced); this.eReflect.object3D.visible = false; this.scene.add(this.eReflect.object3D);
  }

  _disposeGuards() {
    for (const g of [this.pWard, this.eWard, this.pDome, this.eDome, this.pReflect, this.eReflect]) {
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
    this._updateFogVeil(0);
    if (this.blindVeil) this.blindVeil.visible = false;
    this.shake = 0;
  }

  _wizardWorld(wid, y = 1.4) {
    if (this._showcaseMode) {
      const figure = wid === 0 ? this.menuPlayer : this.enemy;
      return new THREE.Vector3(figure.position.x, y, figure.position.z);
    }
    const w = wid === 0 ? this._lastPlayer : this._lastEnemy;
    const x = w ? wizardX(w) : 0;
    return new THREE.Vector3(x, y, wid === 0 ? PLAYER_Z : ENEMY_Z);
  }

  // Ambient render used while in menus (no active match).
  renderIdle(dtMs) {
    this._showcaseMode = false;
    this.menuPlayer.visible = false;
    this.handRig.visible = true;
    this.enemy.rotation.y = 0;
    this.enemy.position.z = ENEMY_Z;
    this.camera.position.y = 1.7;
    this.camera.position.z = PLAYER_Z;
    this._setTitleArenaScale(1);
    this._idleT = (this._idleT || 0) + dtMs * 0.0002;
    this.camera.position.x = Math.sin(this._idleT) * 1.2;
    this.camera.lookAt(0, 1.5, ENEMY_Z);
    this._t += dtMs * 0.001;
    this._syncWizardVisibility({ invisibleTicks: 0 }, { invisibleTicks: 0 });
    this._syncStatusIndicators({ statuses: {} }, { statuses: {}, arcPos: 0 });
    this._updateFogVeil(0);
    this._syncBlindness({ statuses: {} }, { arcPos: 0 });
    this._animateEnemy(dtMs, null);
    this._updateAcademy(dtMs);
    this._updateEffects(dtMs);
    this._updateDebug(dtMs);
    this._renderScene();
  }

  _animateShowcaseFigure(figure, state, dtMs, phase = 0, fallDirection = 1) {
    if (!figure) return;
    const ud = figure.userData;
    const casting = state?.casting || null;
    const progress = casting ? 1 - casting.ticks / Math.max(1, casting.totalTicks || 1) : 0;
    const knockedDown = !!(state?.statuses?.KnockedDown?.ticks > 0);
    const k = this.reduced ? 1 : 1 - Math.exp(-12 * Math.max(0, dtMs) * 0.001);
    const targetRaise = casting ? 0.5 + progress * 0.7 : 0;
    ud.anim.castRaise += (targetRaise - ud.anim.castRaise) * k;
    if (ud.castArm) ud.castArm.rotation.x = ud.rest.castArmX - ud.anim.castRaise;
    figure.rotation.z += ((knockedDown ? fallDirection * 1.35 : 0) - figure.rotation.z) * k;

    const school = casting ? SPELLS_BY_ID[casting.spellId]?.school : null;
    const color = SCHOOL_COLOR[school] || 0x8b6bff;
    if (ud.aura) {
      ud.aura.material.color.setHex(color);
      ud.aura.material.opacity += ((casting ? 0.35 + progress * 0.55 : 0.08) - ud.aura.material.opacity) * k;
    }
    if (ud.staffCrystal) {
      ud.staffCrystal.material.color.setHex(color);
      ud.staffCrystal.material.opacity += ((casting ? 0.95 : 0.5) - ud.staffCrystal.material.opacity) * k;
    }

    const breath = this.reduced ? 0 : Math.sin(this._t * 1.5 + phase);
    if (ud.torso) {
      ud.torso.position.y = ud.rest.torsoY + breath * 0.018;
      ud.torso.rotation.z = this.reduced ? 0 : Math.sin(this._t * 0.7 + phase) * 0.015;
    }
    if (ud.robe) ud.robe.rotation.z = this.reduced ? 0 : Math.sin(this._t * 0.6 + phase) * 0.022;
    if (ud.head) {
      ud.head.rotation.x = ud.rest.headX + breath * 0.025;
      ud.head.rotation.y = this.reduced ? 0 : Math.sin(this._t * 0.5 + phase) * 0.04;
    }
    ud.anim.breath = +breath.toFixed(3);
  }

  showcaseArcPosition(wizardId, arcPos, landscapePhone = false) {
    const arcRadiusX = landscapePhone ? 14.2 : 7.1;
    const arcRadiusZ = landscapePhone ? 6.5 : 7.1;
    const halfArc = (landscapePhone ? 55 : 60) * Math.PI / 180;
    const midpoint = wizardId === 0 ? 0.6 : -0.6;
    const t = Math.max(-1, Math.min(1, (arcPos - midpoint) / 0.32));
    const angle = t * halfArc;
    return wizardId === 0
      ? { x: Math.cos(angle) * arcRadiusX, z: Math.sin(angle) * arcRadiusZ }
      : { x: -Math.cos(angle) * arcRadiusX, z: Math.sin(angle) * arcRadiusZ };
  }

  updateShowcase(sim, alpha, dtMs) {
    this._showcaseMode = true;
    this._t += dtMs * 0.001;
    const player = sim.wizards[0];
    const enemy = sim.wizards[1];
    this._lastPlayer = player;
    this._lastEnemy = enemy;

    this.handRig.visible = false;
    this.enemy.visible = enemy.invisibleTicks <= 0;
    this.menuPlayer.visible = player.invisibleTicks <= 0;
    const landscapePhone = this.canvas.clientWidth > this.canvas.clientHeight
      && this.canvas.clientHeight <= 620;
    const titleArenaScale = landscapePhone ? 2 : 1;
    this._setTitleArenaScale(titleArenaScale);
    const enemyArc = this.showcaseArcPosition(1, enemy.arcPos, landscapePhone);
    const playerArc = this.showcaseArcPosition(0, player.arcPos, landscapePhone);
    this.enemy.position.set(enemyArc.x, 0, enemyArc.z);
    this.menuPlayer.position.set(playerArc.x, 0, playerArc.z);

    const dx = this.menuPlayer.position.x - this.enemy.position.x;
    const dz = this.menuPlayer.position.z - this.enemy.position.z;
    this.enemy.rotation.y = Math.atan2(dx, dz);
    this.menuPlayer.rotation.y = Math.atan2(-dx, -dz);
    this._animateShowcaseFigure(this.enemy, enemy, dtMs, 0.5, -1);
    this._animateShowcaseFigure(this.menuPlayer, player, dtMs, 2.1, 1);

    this.camera.position.set(0, 3.8, landscapePhone ? 18.2 : 14);
    this.camera.lookAt(-0.4, 1.45, 0);
    this._syncCastCues(sim);
    this._syncGuards(player, PLAYER_Z);
    this._syncGuards(enemy, ENEMY_Z);
    this._syncBeams(sim);
    this._syncProjectiles(sim, alpha);
    this._syncZones(sim);
    this._updateFogVeil(0);
    this._updateAcademy(dtMs);
    this._updateEffects(dtMs);
    this._updateDebug(dtMs);
    this.keyLight.intensity += (0.72 - this.keyLight.intensity) * 0.06;
    this._renderScene();
  }

  showcaseStats() {
    const screenX = (figure) => {
      if (!figure || !this.canvas.clientWidth) return null;
      const projected = figure.getWorldPosition(new THREE.Vector3()).project(this.camera);
      return (projected.x + 1) * 0.5 * this.canvas.clientWidth;
    };
    return {
      playerVisible: !!this.menuPlayer?.visible,
      enemyVisible: !!this.enemy?.visible,
      firstPersonHidden: !this.handRig?.visible,
      playerX: this.menuPlayer?.position.x ?? 0,
      enemyX: this.enemy?.position.x ?? 0,
      playerZ: this.menuPlayer?.position.z ?? 0,
      enemyZ: this.enemy?.position.z ?? 0,
      playerScreenX: screenX(this.menuPlayer),
      enemyScreenX: screenX(this.enemy),
      platformScaleX: this._platform?.scale.x ?? 1,
      cameraRadius: Math.hypot(this.camera.position.x, this.camera.position.z),
      cameraX: this.camera.position.x,
      cameraZ: this.camera.position.z,
    };
  }

  _setTitleArenaScale(scaleX) {
    const x = Math.max(1, Number(scaleX) || 1);
    for (const object of [this._platform, this._platformRing, this._platformInlay]) {
      if (object) object.scale.x = x;
    }
  }

  viewStats() {
    return {
      showcaseMode: !!this._showcaseMode,
      cameraZ: this.camera.position.z,
      enemyZ: this.enemy.position.z,
    };
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
    const meta = wiz.meta || {};

    // Front-facing check: the model's front is local +Z; the player stands at
    // +Z relative to the enemy, so a positive dot means it faces the camera.
    let facing = { towardCamera: false, dot: 0 };
    let staffHeld = false, gripGap = null;
    if (this.enemy) {
      const fwd = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(this.enemy.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const dot = fwd.dot(new THREE.Vector3(0, 0, 1)); // player is +Z from the enemy
      facing = { towardCamera: dot > 0.25, dot: +dot.toFixed(3) };
      if (wiz.offHand && wiz.staffShaft) {
        const hp = wiz.offHand.getWorldPosition(new THREE.Vector3());
        const sp = wiz.staffShaft.getWorldPosition(new THREE.Vector3());
        gripGap = +Math.hypot(hp.x - sp.x, hp.z - sp.z).toFixed(3); // horizontal distance to the shaft
        staffHeld = gripGap < 0.25;
      }
    }

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
        robeLayers: wiz.robeLayers || 0, robePanels: wiz.robePanels || 0,
        facing,
        face: { eyes: meta.eyes || 0, nose: !!meta.nose, beard: !!meta.beard, brows: !!meta.brows },
        arms: { count: meta.arms || 0, articulated: !!meta.articulated },
        staffHeld, gripGap,
        hasCrest: !!meta.crest, hasMantle: !!meta.mantle,
        animation: {
          enabled: !this.reduced,
          breath: (wiz.anim && wiz.anim.breath) || 0,
          castRaise: +(((wiz.anim && wiz.anim.castRaise) || 0).toFixed(3)),
          reducedMotion: this.reduced,
        },
      },
      firstPerson: { gloveParts: this._gloveParts || 0, hasWand: !!this.wandTip },
      guards: {
        ward: this.pWard && this.pWard.kind,
        barrier: this.pDome && this.pDome.kind,
        reflect: this.pReflect && this.pReflect.kind,
        distinct: new Set([
          this.pWard && this.pWard.kind,
          this.pDome && this.pDome.kind,
          this.pReflect && this.pReflect.kind,
        ].filter(Boolean)).size === 3,
      },
      statusIndicators: {
        player: !!this.playerStatusAura,
        enemy: !!this.enemyStatusAura,
        covered: STATUS_PRIORITY.slice(),
      },
      budget: {
        lights, meshes, transparent, points, lines,
        lightBudgetOk: lights <= 8, transparentBudgetOk: transparent <= 110,
      },
      reduced: this.reduced,
    };
  }

  // ---- per-frame update from live sim state ----
  update(sim, alpha, dtMs) {
    this._showcaseMode = false;
    this._t += dtMs * 0.001;
    const player = sim.wizards[0];
    const enemy = sim.wizards[1];
    this._lastPlayer = player; this._lastEnemy = enemy;
    this.menuPlayer.visible = false;
    this.enemy.rotation.y = 0;
    this.enemy.position.z = ENEMY_Z;
    this.camera.position.z = PLAYER_Z;
    this._setTitleArenaScale(1);
    this._syncWizardVisibility(player, enemy);

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
    this._syncBlindness(player, enemy);

    // Enemy idle breathing + casting tell (arm extension, aura + staff glow).
    this._animateEnemy(dtMs, enemy);
    this._syncStatusIndicators(player, enemy);

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

    this._renderScene();
  }

  _syncGuards(w, z) {
    const ward = w.id === 0 ? this.pWard : this.eWard;
    const dome = w.id === 0 ? this.pDome : this.eDome;
    const reflect = w.id === 0 ? this.pReflect : this.eReflect;
    const figure = this._showcaseMode ? (w.id === 0 ? this.menuPlayer : this.enemy) : null;
    const x = figure ? figure.position.x : wizardX(w);
    const worldZ = figure ? figure.position.z : z;
    ward.object3D.visible = !!w.shield;
    if (w.shield) {
      ward.object3D.position.set(x, 1.1, worldZ + (worldZ > 0 ? -0.6 : 0.6));
      ward.object3D.lookAt(0, 1.1, 0);
      ward.update({ dtMs: 16, strength: 1, time: this._t });
    }
    dome.object3D.visible = !!w.barrier;
    if (w.barrier) {
      dome.object3D.position.set(x, 1.2, worldZ);
      dome.update({ dtMs: 16, strength: 1, time: this._t });
    }
    // Reflect is a persistent state visual tied to the live reflect window; it
    // vanishes the same tick a projectile consumes it (reflectTicks -> 0).
    reflect.object3D.visible = w.reflectTicks > 0;
    if (w.reflectTicks > 0) {
      reflect.object3D.position.set(x, 1.15, worldZ + (worldZ > 0 ? -0.55 : 0.55));
      reflect.object3D.lookAt(0, 1.15, 0);
      reflect.update({ dtMs: 16, strength: 1, time: this._t });
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
      if (this._showcaseMode) {
        cue.handle.object3D.position.copy(this._wizardWorld(w.id, w.id === 0 ? 1.15 : 1.7));
      } else if (w.id === 0) {
        cue.handle.object3D.position.set(wizardX(w), 1.15, PLAYER_Z - 1.25);
      } else {
        cue.handle.object3D.position.set(wizardX(w), 1.7, ENEMY_Z + 0.35);
      }
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
      const ownerFigure = this._showcaseMode ? (p.owner === 0 ? this.menuPlayer : this.enemy) : null;
      const targetFigure = this._showcaseMode ? (p.owner === 0 ? this.enemy : this.menuPlayer) : null;
      const ownerZ = ownerFigure ? ownerFigure.position.z : (p.owner === 0 ? PLAYER_Z : ENEMY_Z);
      const targetZ = targetFigure ? targetFigure.position.z : (p.owner === 0 ? ENEMY_Z : PLAYER_Z);
      const startX = ownerFigure ? ownerFigure.position.x : (p.originPos ?? 0) * ARC_W;
      const endX = targetFigure ? targetFigure.position.x : (p.targetPos ?? 0) * ARC_W;
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
    let fogStrength = 0;
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
      handle.object3D.position.z = z.kind === 'Cover'
        ? (z.owner === 0 ? PLAYER_Z - 1.4 : ENEMY_Z + 1.4)
        : 0;
      const fade = Math.min(1, z.ticks / Math.max(1, z.totalTicks || 1));
      if (z.kind === 'Fog' && sim.wizardInZone(sim.wizards[0], z)) {
        fogStrength = Math.max(fogStrength, fade);
      }
      handle.update({ dtMs: 16, fade, time: this._t, reduced: this.reduced });
    }
    for (const [id, handle] of this.zoneMeshes) {
      if (!seen.has(id)) { this.scene.remove(handle.object3D); handle.dispose(); this.zoneMeshes.delete(id); }
    }
    this._updateFogVeil(fogStrength);
  }

  debugFogForPosition(playerArc, zoneCenter, radius = 0.55) {
    const inside = Math.abs(Number(playerArc) - Number(zoneCenter)) <= Number(radius);
    this._updateFogVeil(inside ? 1 : 0);
    const result = { inside, visible: !!this.fogVeil?.visible };
    this._updateFogVeil(0);
    return result;
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
        this._spawnReaction(e);
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

  // Spawn the transient VFX for an environmental reaction at a sensible world
  // location: 'link' arcs between caster and target (ConductiveArc lightning),
  // 'target' anchors at the affected wizard's feet, 'center' sits on the reacting
  // ground zone (arc position -> world x). Animated + disposed via _updateEffects.
  _spawnReaction(e) {
    const profile = getReactionVfx(e.name);
    if (!profile) return;
    const centerX = (typeof e.center === 'number' ? e.center : 0) * ARC_W;
    const casterId = (e.casterId === 0 || e.casterId === 1) ? e.casterId : 0;
    const targetId = (e.targetId === 0 || e.targetId === 1) ? e.targetId : (casterId === 0 ? 1 : 0);
    let anchor, from = null, to = null;
    if (profile.anchor === 'link') {
      from = this._wizardWorld(casterId, 1.3);
      to = this._wizardWorld(targetId, 1.3);
      anchor = from.clone();
    } else if (profile.anchor === 'target') {
      anchor = this._wizardWorld(targetId, 0.12);
    } else {
      anchor = new THREE.Vector3(centerX, 0.12, 0);
    }
    const handle = makeReactionVfx(e.name, this.reduced, { from, to });
    if (!handle) return;
    this._pushEffect(handle, anchor, !!handle.billboard);
    if (SCHOOL_COLOR[profile.school]) this.keyLight.color.setHex(SCHOOL_COLOR[profile.school]);
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

  debugZoneBounds(kind) {
    const handle = makeZoneVfx(kind, this.reduced, 2.6);
    const box = new THREE.Box3().setFromObject(handle.object3D);
    const size = new THREE.Vector3();
    box.getSize(size);
    handle.dispose();
    return { width: size.x, height: size.y, depth: size.z };
  }

  // Spawn any of the three persistent guard visuals (Ward / Barrier Dome /
  // Reflect) into the dev gallery so the smoke test can confirm they draw
  // DISTINCT objects, animate WebGL frames, and dispose cleanly. Never wired to
  // production UI (the live guards are driven by _syncGuards from sim state).
  debugSpawnGuard(kind) {
    const k = String(kind).toLowerCase();
    const handle = k === 'ward' ? makeWardVfx(this.reduced)
      : k === 'dome' || k === 'barrier' ? makeDomeVfx(this.reduced)
        : k === 'reflect' ? makeReflectGuardVfx(this.reduced)
          : null;
    if (!handle) return null;
    handle.object3D.position.set(0, 1.2, ENEMY_Z + 2);
    this.scene.add(handle.object3D);
    const entry = { handle, age: 0, life: 2200, kind: handle.kind };
    entry.tick = (dt) => { entry.age += dt; handle.update({ dtMs: dt, strength: 1, time: this._t }); };
    while (this._debug.length >= 16) { const old = this._debug.shift(); this.scene.remove(old.handle.object3D); old.handle.dispose(); }
    this._debug.push(entry);
    return entry.kind;
  }

  debugWizardState(playerStatuses = [], enemyStatuses = [], playerInvisibleTicks = 0, enemyInvisibleTicks = 0) {
    const makeWizard = (names, invisibleTicks) => ({
      arcPos: 0,
      invisibleTicks: Number(invisibleTicks) || 0,
      statuses: Object.fromEntries((Array.isArray(names) ? names : [names])
        .filter((name) => STATUS_COLOR[name])
        .map((name) => [name, { ticks: 60, stacks: 1 }])),
    });
    const player = makeWizard(playerStatuses, playerInvisibleTicks);
    const enemy = makeWizard(enemyStatuses, enemyInvisibleTicks);
    this._syncWizardVisibility(player, enemy);
    this._syncStatusIndicators(player, enemy);
    const result = {
      playerModelVisible: this.handRig.visible,
      enemyModelVisible: this.enemy.visible,
      playerStatusVisible: this.playerStatusAura.visible && this.handRig.visible,
      enemyStatusVisible: this.enemyStatusAura.visible,
      playerColor: this.playerStatusAura.userData.statusAura.ring.material.color.getHex(),
      enemyColor: this.enemyStatusAura.userData.statusAura.ring.material.color.getHex(),
    };
    this._syncWizardVisibility({ invisibleTicks: 0 }, { invisibleTicks: 0 });
    this._syncStatusIndicators({ statuses: {} }, { statuses: {}, arcPos: 0 });
    return result;
  }

  debugFogVeil(strength = 1) {
    this._updateFogVeil(strength);
    const result = {
      visible: !!this.fogVeil?.visible,
      strength: this.fogVeil?.material?.uniforms?.strength?.value || 0,
    };
    this._updateFogVeil(0);
    return result;
  }

  debugBlindVeil(enabled = true) {
    this._syncBlindness(
      { statuses: enabled ? { Blinded: { ticks: 240 } } : {} },
      { arcPos: 0 },
    );
    const projectile = makeProjectileVfx(4, this.reduced);
    let spellRenderOrder = 0;
    projectile.object3D.traverse((object) => {
      if (object.material && object.material.transparent === false) {
        spellRenderOrder = Math.max(spellRenderOrder, object.renderOrder || 0);
      }
    });
    projectile.dispose();
    const additiveProjectile = makeProjectileVfx(8, this.reduced);
    this.scene.add(additiveProjectile.object3D);
    const blendings = this._prepareBlindSpellBlending();
    const normalBlendCount = blendings.filter(([material]) => material.blending === THREE.NormalBlending).length;
    for (const [material, blending] of blendings) material.blending = blending;
    this.scene.remove(additiveProjectile.object3D);
    additiveProjectile.dispose();
    let spellLights = 0;
    this.scene.traverse((object) => {
      if (object.isLight && (object.layers.mask & 2) !== 0) spellLights++;
    });
    const result = {
      visible: !!this.blindVeil?.visible,
      opacity: this.blindVeil?.material?.opacity || 0,
      depthWrite: !!this.blindVeil?.material?.depthWrite,
      renderOrder: this.blindVeil?.renderOrder || 0,
      layer: this.blindVeil?.layers?.mask || 0,
      spellRenderOrder,
      spellLayer: projectile.object3D.layers.mask,
      normalBlendCount,
      spellLights,
      width: this.blindVeil?.geometry?.parameters?.width || 0,
      height: this.blindVeil?.geometry?.parameters?.height || 0,
    };
    this._syncBlindness({ statuses: {} }, { arcPos: 0 });
    return result;
  }

  debugClear() {
    for (const e of this._debug) { this.scene.remove(e.handle.object3D); e.handle.dispose(); }
    this._debug = [];
  }

  // Spawn a reaction VFX in the dev gallery (idle arena) so the smoke test can
  // confirm each reaction draws a DISTINCT object, animates WebGL frames, and
  // disposes cleanly. Never wired to production UI.
  debugSpawnReaction(name) {
    const profile = getReactionVfx(name);
    if (!profile) return null;
    let from = null, to = null, anchor;
    if (profile.anchor === 'link') {
      from = new THREE.Vector3(-1.6, 1.3, ENEMY_Z + 2); to = new THREE.Vector3(1.6, 1.3, ENEMY_Z + 2); anchor = from.clone();
    } else {
      anchor = new THREE.Vector3(0, 0.12, ENEMY_Z + 2);
    }
    const handle = makeReactionVfx(name, this.reduced, { from, to });
    if (!handle) return null;
    handle.object3D.position.copy(anchor);
    this.scene.add(handle.object3D);
    const entry = { handle, age: 0, life: 1100, kind: handle.kind };
    entry.tick = (dt) => {
      entry.age += dt;
      if (handle.billboard) handle.object3D.quaternion.copy(this.camera.quaternion);
      if (handle.update({ dtMs: dt, time: this._t }) === false) entry.age = entry.life;
    };
    while (this._debug.length >= 16) { const old = this._debug.shift(); this.scene.remove(old.handle.object3D); old.handle.dispose(); }
    this._debug.push(entry);
    return entry.kind;
  }

  // Drive the PRODUCTION reaction path (not the gallery): spawns via the same
  // _spawnReaction the live sim uses and returns the live effect's kind + count.
  debugProductionReaction(name) {
    const before = this.effects.length;
    this._spawnReaction({ name: String(name), casterId: 0, targetId: 1, center: 0 });
    if (this.effects.length <= before) return null;
    return this.effects[this.effects.length - 1].handle.kind;
  }

  _updateDebug(dtMs) {
    for (let i = this._debug.length - 1; i >= 0; i--) {
      const e = this._debug[i];
      e.tick(dtMs);
      if (e.age >= e.life) { this.scene.remove(e.handle.object3D); e.handle.dispose(); this._debug.splice(i, 1); }
    }
  }
}
