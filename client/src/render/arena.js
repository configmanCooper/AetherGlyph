// arena.js — first-person Three.js arena for The Confluence.
//
// Renders the opposing wizard, the player's own hands/wand cues, projectiles,
// shields/barriers, the dueling platform + focus stones, and reactive lighting.
// All gameplay-readable state (health/resources/status) lives in the HTML HUD;
// this module only draws the world and consumes sim events for effects.

import * as THREE from 'three';
import { SPELLS_BY_ID } from '@shared/balance/spellData.generated.js';
import { effectFor } from '@shared/sim/spellEffects.js';

const ARC_W = 3.2;
const SEP = 11;
const PLAYER_Z = SEP / 2;
const ENEMY_Z = -SEP / 2;

const SCHOOL_COLOR = {
  Ember: 0xff6a3d, Tide: 0x54c8ff, Storm: 0xffe14d, Stone: 0xb08a5a,
  Gale: 0x9be8d8, Arcane: 0xb98bff, Umbra: 0x7a6f99, Prismatic: 0xffffff,
};

function wizardX(w) { return w.arcPos * ARC_W; }

export class Arena {
  constructor(canvas) {
    this.canvas = canvas;
    this.reduced = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0713);
    this.scene.fog = new THREE.Fog(0x0a0713, 10, 26);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);
    this.camera.position.set(0, 1.7, PLAYER_Z);

    this._buildLights();
    this._buildArena();
    this._buildEnemy();
    this._buildHands();

    this.projMeshes = new Map(); // projectile id -> mesh
    this.effects = [];           // transient effect meshes
    this.pShield = this._makeShield(0x4fd6c9); this.scene.add(this.pShield); this.pShield.visible = false;
    this.eShield = this._makeShield(0xb98bff); this.scene.add(this.eShield); this.eShield.visible = false;
    this.eBarrier = this._makeBarrier(); this.scene.add(this.eBarrier); this.eBarrier.visible = false;
    this.pBarrier = this._makeBarrier(); this.scene.add(this.pBarrier); this.pBarrier.visible = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setReduced(v) { this.reduced = v; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x40306a, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, 8, 4);
    this.scene.add(dir);
    this.keyLight = new THREE.PointLight(0x8b6bff, 0.6, 30);
    this.keyLight.position.set(0, 5, 0);
    this.scene.add(this.keyLight);
  }

  _buildArena() {
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8.4, 0.5, 40),
      new THREE.MeshStandardMaterial({ color: 0x241a3a, roughness: 0.9, metalness: 0.1 }),
    );
    platform.position.y = -0.25;
    this.scene.add(platform);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(8, 0.12, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0x8b6bff, emissive: 0x4a2f99, emissiveIntensity: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    // Three destructible waist-high focus stones across the middle.
    this.stones = [];
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a3d63, roughness: 1 });
    for (const x of [-2.6, 0, 2.6]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.7), stoneMat.clone());
      s.position.set(x, 0.5, 0);
      this.scene.add(s); this.stones.push(s);
    }
  }

  _robeFigure(color) {
    const g = new THREE.Group();
    const robe = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 2.0, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    robe.position.y = 1.0; g.add(robe);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8d9c0, roughness: 0.7 }),
    );
    head.position.y = 2.1; g.add(head);
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.9, 12),
      new THREE.MeshStandardMaterial({ color: 0x2c2148, roughness: 0.8 }),
    );
    hat.position.y = 2.55; g.add(hat);
    // Casting hand with an aura we can tint per school.
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8d9c0 }),
    );
    hand.position.set(0.55, 1.35, 0.2); g.add(hand);
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x8b6bff, transparent: true, opacity: 0 }),
    );
    hand.add(aura);
    g.userData = { hand, aura, robe };
    return g;
  }

  _buildEnemy() {
    this.enemy = this._robeFigure(0x3a2d5e);
    this.enemy.position.set(0, 0, ENEMY_Z);
    this.enemy.rotation.y = Math.PI; // face the player
    this.scene.add(this.enemy);
  }

  _buildHands() {
    // Player hands/wand attached to the camera so they stay in first-person view.
    this.handRig = new THREE.Group();
    this.camera.add(this.handRig);
    this.scene.add(this.camera);

    const skin = new THREE.MeshStandardMaterial({ color: 0xe8d9c0, roughness: 0.7 });
    this.leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), skin);
    this.leftHand.position.set(-0.42, -0.42, -0.9);
    this.handRig.add(this.leftHand);

    this.rightHand = new THREE.Group();
    const rh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), skin);
    this.rightHand.add(rh);
    const wand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c2148 }),
    );
    wand.rotation.x = Math.PI / 2.4; wand.position.set(0.02, 0.12, -0.22);
    this.rightHand.add(wand);
    this.wandTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x8b6bff, transparent: true, opacity: 0.2 }),
    );
    this.wandTip.position.set(0.04, 0.32, -0.42);
    this.rightHand.add(this.wandTip);
    this.rightHand.position.set(0.46, -0.42, -0.9);
    this.handRig.add(this.rightHand);
  }

  _makeShield(color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    return m;
  }
  _makeBarrier() {
    return new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xb98bff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    );
  }

  reset() {
    for (const [, m] of this.projMeshes) this.scene.remove(m);
    this.projMeshes.clear();
    for (const e of this.effects) this.scene.remove(e.mesh);
    this.effects = [];
  }

  // Ambient render used while in menus (no active match).
  renderIdle(dtMs) {
    this._idleT = (this._idleT || 0) + dtMs * 0.0002;
    this.camera.position.x = Math.sin(this._idleT) * 1.2;
    this.camera.lookAt(0, 1.5, ENEMY_Z);
    this._updateEffects(dtMs);
    this.renderer.render(this.scene, this.camera);
  }

  // ---- per-frame update from live sim state ----
  update(sim, alpha, dtMs) {
    const player = sim.wizards[0];
    const enemy = sim.wizards[1];

    // Camera follows the player's strafe position; opponent under soft lock.
    const px = wizardX(player);
    this.camera.position.x += (px - this.camera.position.x) * 0.3;
    const ex = wizardX(enemy);
    this.enemy.position.x += (ex - this.enemy.position.x) * 0.3;
    this.camera.lookAt(this.enemy.position.x, 1.5, ENEMY_Z);

    // Enemy casting tell: raise + tint the aura by school.
    const eAura = this.enemy.userData.aura;
    if (enemy.casting) {
      const sp = SPELLS_BY_ID[enemy.casting.spellId];
      const col = SCHOOL_COLOR[sp?.school] || 0x8b6bff;
      eAura.material.color.setHex(col);
      const prog = 1 - enemy.casting.ticks / Math.max(1, enemy.casting.totalTicks || 1);
      eAura.material.opacity = 0.3 + prog * 0.6;
      this.enemy.userData.hand.position.y = 1.35 + prog * 0.5;
    } else {
      eAura.material.opacity *= 0.85;
      this.enemy.userData.hand.position.y += (1.35 - this.enemy.userData.hand.position.y) * 0.2;
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

    // Shields / barriers.
    this._shieldFor(this.pShield, player, PLAYER_Z);
    this._shieldFor(this.eShield, enemy, ENEMY_Z);
    this.pBarrier.visible = !!player.barrier;
    if (player.barrier) this.pBarrier.position.set(px, 1.2, PLAYER_Z);
    this.eBarrier.visible = !!enemy.barrier;
    if (enemy.barrier) this.eBarrier.position.set(ex, 1.2, ENEMY_Z);

    // Projectiles.
    this._syncProjectiles(sim, alpha);

    // Transient effects.
    this._updateEffects(dtMs);

    // Reactive light: brighter with recent combat intensity.
    this.keyLight.intensity += (0.6 - this.keyLight.intensity) * 0.05;

    this.renderer.render(this.scene, this.camera);
  }

  _shieldFor(mesh, w, z) {
    mesh.visible = !!w.shield;
    if (w.shield) { mesh.position.set(wizardX(w), 1.1, z + (z > 0 ? -0.6 : 0.6)); mesh.lookAt(0, 1.1, 0); }
  }

  _syncProjectiles(sim, alpha) {
    const seen = new Set();
    for (const p of sim.projectiles) {
      seen.add(p.id);
      let mesh = this.projMeshes.get(p.id);
      const sp = SPELLS_BY_ID[p.spellId];
      const col = SCHOOL_COLOR[sp?.school] || 0xffffff;
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 12, 12),
          new THREE.MeshBasicMaterial({ color: col }),
        );
        const glow = new THREE.PointLight(col, 0.8, 4);
        mesh.add(glow);
        this.scene.add(mesh);
        this.projMeshes.set(p.id, mesh);
      }
      const total = Math.max(1, p.totalTicks || 1);
      const prog = Math.min(1, (total - p.ticks + alpha) / total);
      const ownerZ = p.owner === 0 ? PLAYER_Z : ENEMY_Z;
      const targetZ = p.owner === 0 ? ENEMY_Z : PLAYER_Z;
      const startX = (p.originPos ?? 0) * ARC_W;
      const endX = (p.targetPos ?? 0) * ARC_W;
      mesh.position.set(
        startX + (endX - startX) * prog,
        1.4 + Math.sin(prog * Math.PI) * 0.25,
        ownerZ + (targetZ - ownerZ) * prog,
      );
    }
    for (const [id, mesh] of this.projMeshes) {
      if (!seen.has(id)) { this.scene.remove(mesh); this.projMeshes.delete(id); }
    }
  }

  // ---- event-driven effects ----
  handleEvents(events, sim) {
    for (const e of events) {
      if (e.type === 'damage') this._burst(e.target === 0 ? PLAYER_Z : ENEMY_Z, sim.wizards[e.target], 0xff5d73);
      else if (e.type === 'cast') { this.keyLight.intensity = 1.3; }
      else if (e.type === 'reflect') {
        const reflector = sim.wizards[e.by];
        this._burst(e.by === 0 ? PLAYER_Z : ENEMY_Z, reflector, 0x4fd6c9);
      }
      else if (e.type === 'roundEnd') this.keyLight.intensity = 1.6;
    }
  }

  _burst(z, w, color) {
    if (this.reduced) return;
    const x = w ? wizardX(w) : 0;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(x, 1.4, z + (z > 0 ? -0.4 : 0.4));
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 350, max: 350 });
  }

  _updateEffects(dtMs) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dtMs;
      const t = 1 - e.life / e.max;
      e.mesh.scale.setScalar(1 + t * 3);
      e.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
      if (e.life <= 0) { this.scene.remove(e.mesh); this.effects.splice(i, 1); }
    }
  }
}
