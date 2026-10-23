import * as THREE from "three";
import { buildScene, canopyRadius, type Block, type BuildResult, type Kind, type SceneModel } from "../qr/scene";
import { SEASON_TINT, writeBlockColor, type RGB, type Season } from "./palette";

const KINDS: Kind[] = ["path", "grass", "finder", "skirt", "trunk", "canopy"];
const PETALS = 72;
const SPIN = 0.34;

type Bucket = {
  mesh: THREE.InstancedMesh;
  blocks: Block[];
};

type Petal = { x: number; y: number; z: number; speed: number; drift: number; phase: number };

export class Diorama {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly turntable = new THREE.Group();
  private readonly persp = new THREE.PerspectiveCamera(30, 1, 0.1, 800);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  private active: THREE.Camera = this.persp;
  private readonly canvas: HTMLCanvasElement;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly background = new THREE.Color(0xf3eee4);
  private readonly cream = new THREE.Color(0xf3eee4);
  private readonly white = new THREE.Color(0xffffff);
  private readonly rgb: RGB = [0, 0, 0];
  private readonly clock = new THREE.Clock();
  private readonly buckets: Bucket[] = [];
  private readonly cube: THREE.BoxGeometry;
  private readonly platform: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly petals: THREE.InstancedMesh;
  private readonly petalState: Petal[] = [];
  private readonly wood = new THREE.Group();
  private readonly woodMat: THREE.MeshBasicMaterial;
  private readonly trunk: THREE.Mesh;
  private readonly blossoms: THREE.InstancedMesh;
  private readonly blossomMat: THREE.MeshBasicMaterial;
  private model: SceneModel | null = null;
  private season: Season = "spring";
  private tint = SEASON_TINT.spring;
  private eased = 0;
  private animFrom = 0;
  private animTo = 0;
  private animStart = 0;
  private animMs = 860;
  private animating = false;
  private orbitAz = (40 * Math.PI) / 180;
  private orbitEl = (28 * Math.PI) / 180;
  private yaw = 0.4;
  private alignHome: number | null = null;
  private reportedFlat = false;
  private width = 1;
  private height = 1;
  private frame = 0;
  private paintDirty = true;
  private viewDirty = true;
  private lastToggle = 0;
  private pointer: { x: number; y: number; moved: boolean } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly onFlatChange: (flat: boolean) => void,
  ) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(this.background, 1);
    this.scene.background = this.background;
    this.scene.add(this.turntable);

    this.cube = shadedBox();
    this.platform = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.36, 1),
      new THREE.MeshBasicMaterial({ color: 0xe7dcc8 }),
    );
    this.platform.position.y = -0.18;
    this.turntable.add(this.platform);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        transparent: true,
        depthWrite: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -0.02;
    this.shadow.renderOrder = -1;
    this.turntable.add(this.shadow);

    this.petals = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.05, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      PETALS,
    );
    this.petals.frustumCulled = false;
    this.petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.turntable.add(this.petals);
    for (let i = 0; i < PETALS; i++) this.petalState.push({ x: 0, y: 1, z: 0, speed: 0.4, drift: 1, phase: i });

    this.woodMat = new THREE.MeshBasicMaterial({ color: 0x5c3b28 });
    this.trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.5, 4.6, 16), new THREE.MeshBasicMaterial({ map: barkTexture(), color: 0x6a4632 }));
    this.trunk.position.y = 2.4;
    this.wood.add(this.trunk);
    this.turntable.add(this.wood);

    this.blossomMat = new THREE.MeshBasicMaterial({
      map: blossomTexture(),
      color: this.tint,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.blossoms = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.blossomMat, 5200);
    this.blossoms.count = 0;
    this.blossoms.frustumCulled = false;
    this.blossoms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blossoms.renderOrder = 2;
    this.turntable.add(this.blossoms);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointerup", this.onPointerUp);
    this.frame = requestAnimationFrame(this.tick);
  }

  get hasModel() {
    return this.model !== null;
  }

  setText(text: string): BuildResult {
    const result = buildScene(text);
    if (!result.ok) return result;
    this.model = result.scene;
    this.rebuild();
    this.scatterPetals(true);
    this.paintDirty = true;
    this.viewDirty = true;
    return result;
  }

  clear() {
    this.model = null;
    this.rebuild();
  }

  setSeason(season: Season) {
    this.season = season;
    this.tint = SEASON_TINT[season];
    this.blossomMat.color.set(this.tint);
    this.paintDirty = true;
    this.scatterPetals(false);
  }

  setTint(hex: string) {
    this.tint = hex;
    this.blossomMat.color.set(hex);
    this.paintDirty = true;
  }

  setFlat(flat: boolean) {
    const next = flat ? 1 : 0;
    if (!this.animating && this.eased === next) return;
    if (this.animating && this.animTo === next) return;
    this.animFrom = this.eased;
    this.animTo = next;
    this.animStart = performance.now();
    this.animMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 860;
    this.animating = true;
    this.reportedFlat = flat;
    this.onFlatChange(flat);
  }

  scrub(progress: number) {
    const next = clamp(progress, 0, 1);
    this.animating = false;
    this.eased = next;
    this.animTo = next;
    this.viewDirty = true;
    this.paintDirty = true;
    const flat = next > 0.92;
    if (flat === this.reportedFlat) return;
    this.reportedFlat = flat;
    this.onFlatChange(flat);
  }

  toggle() {
    const flat = this.animating ? this.animTo === 1 : this.eased >= 1;
    this.setFlat(!flat);
  }

  download() {
    const url = this.snapshot();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = "canopy-qr.png";
    link.click();
  }

  snapshot() {
    if (!this.model) return "";
    const eased = this.eased;
    const pixels = this.model.grid * 16;
    this.writeBlocks(1);
    this.paintFoliage(1);
    this.frameCamera(1);
    this.updateBackdrop(1);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(pixels, pixels, false);
    this.renderer.render(this.scene, this.active);
    const url = this.canvas.toDataURL("image/png");
    this.eased = eased;
    this.syncBuffer();
    this.writeBlocks(eased);
    this.paintFoliage(eased);
    this.frameCamera(eased);
    this.updateBackdrop(eased);
    this.paintPetals(0, eased);
    this.renderer.render(this.scene, this.active);
    return url;
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.syncBuffer();
    this.viewDirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.dispose();
  }

  private rebuild() {
    for (const bucket of this.buckets) {
      this.turntable.remove(bucket.mesh);
      const material = bucket.mesh.material;
      if (!Array.isArray(material)) material.dispose();
    }
    this.buckets.length = 0;
    if (!this.model) {
      this.platform.visible = false;
      this.shadow.visible = false;
      this.petals.visible = false;
      this.wood.visible = false;
      this.blossoms.visible = false;
      return;
    }

    for (const kind of KINDS) {
      const blocks = this.model.blocks.filter((block) => block.kind === kind);
      if (!blocks.length) continue;
      const mesh = new THREE.InstancedMesh(this.cube, new THREE.MeshBasicMaterial({ vertexColors: true }), blocks.length);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.turntable.add(mesh);
      this.buckets.push({ mesh, blocks });
    }

    const span = this.model.grid + 3.2;
    this.platform.scale.set(span, 1, span);
    this.shadow.scale.set(span * 1.12, span * 1.12, 1);
    this.growWood(canopyRadius(this.model.modules));
    this.layoutBlossoms();
    this.paintDirty = true;
  }

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, this.clock.getDelta());
    this.spinBase(dt);
    this.turntable.rotation.y = this.yaw;
    if (this.animating) {
      const u = this.animMs === 0 ? 1 : Math.min(1, (now - this.animStart) / this.animMs);
      this.eased = lerp(this.animFrom, this.animTo, easeInOutCubic(u));
      if (u >= 1) {
        this.eased = this.animTo;
        this.animating = false;
      }
      this.viewDirty = true;
      this.paintDirty = true;
    }
    this.syncBuffer();
    if (this.viewDirty) {
      this.frameCamera(this.eased);
      this.viewDirty = false;
    }
    if (this.paintDirty) {
      this.writeBlocks(this.eased);
      this.paintFoliage(this.eased);
      this.updateBackdrop(this.eased);
      this.paintDirty = false;
    }
    this.paintPetals(dt, this.eased);
    this.canvas.style.imageRendering = this.eased >= 1 ? "pixelated" : "";
    this.renderer.render(this.scene, this.active);
    this.frame = requestAnimationFrame(this.tick);
  };

  private writeBlocks(t: number) {
    const flatten = smoothstep(0.12, 1, t);
    const contrast = t >= 1 ? 1 : smoothstep(0.38, 0.96, t);
    const unit = lerp(0.92, 1, flatten);
    const foliage = 1 - smoothstep(0.16, 0.68, t);
    for (const bucket of this.buckets) {
      bucket.blocks.forEach((block, index) => {
        const fade = block.structural ? 1 : foliage;
        const hidden = fade < 0.001;
        const tile = block.kind === "path" || block.kind === "grass" || block.kind === "finder";
        let xz = unit * fade;
        let ySize = block.height;
        let y = block.layer * unit + ySize / 2;
        let ox = 0;
        let oz = 0;
        if (tile) {
          xz = lerp(0.98, 1, flatten);
          ySize = 0.16;
          y = 0.08;
        } else if (block.kind === "skirt") {
          xz = 0.28 * fade;
          ySize = block.height * 0.95;
          y = ySize / 2;
        } else if (block.kind === "canopy") {
          xz = block.cap ? unit * flatten : 0;
          ySize = block.cap ? lerp(0.16, 0.9, flatten) : 0;
          y = block.cap ? 0.1 + ySize / 2 : -40;
        } else if (!block.structural) {
          xz = 0;
          ySize = 0;
        } else {
          const taper = Math.max(0.72, 1.05 - block.layer * 0.04);
          xz = unit * taper;
          ySize = block.height;
          y = block.layer * 0.7 + ySize / 2;
        }
        this.dummy.position.set(block.x + ox, hidden ? -40 : y, block.z + oz);
        this.dummy.scale.set(hidden ? 0 : xz, hidden ? 0 : ySize, hidden ? 0 : xz);
        this.dummy.rotation.set(block.kind === "skirt" ? block.shade * 0.35 : 0, 0, block.kind === "skirt" ? block.shade * 0.45 : 0);
        this.dummy.updateMatrix();
        bucket.mesh.setMatrixAt(index, this.dummy.matrix);
        writeBlockColor(
          block.kind,
          block.dark,
          this.season,
          this.tint,
          block.shade,
          block.layer,
          block.structural ? contrast : 0,
          this.rgb,
        );
        this.color.setRGB(this.rgb[0] / 255, this.rgb[1] / 255, this.rgb[2] / 255, THREE.SRGBColorSpace);
        bucket.mesh.setColorAt(index, this.color);
      });
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
    }
  }

  private updateBackdrop(t: number) {
    const fade = smoothstep(0.5, 1, t);
    this.background.copy(this.cream).lerp(this.white, fade);
    this.renderer.setClearColor(this.background, 1);
    const alive = this.model !== null;
    this.platform.visible = alive && t < 1;
    this.shadow.visible = alive && t < 0.8;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - smoothstep(0.15, 0.75, t);
    this.petals.visible = alive && t < 0.9;
  }

  private paintPetals(dt: number, t: number) {
    const grid = this.model?.grid ?? 21;
    const radius = grid * 0.32;
    const fade = 1 - smoothstep(0.02, 0.4, t);
    this.color.set(petalHex(this.season, this.tint));
    (this.petals.material as THREE.MeshBasicMaterial).color.copy(this.color);
    const time = this.clock.elapsedTime;
    const winter = this.season === "winter";
    this.petalState.forEach((petal, index) => {
      petal.y -= petal.speed * dt;
      petal.x += Math.sin(time * petal.drift + petal.phase) * dt * 0.18;
      if (petal.y < 0.2) this.resetPetal(petal, radius, true);
      const size = (winter ? 0.55 : 1) * fade;
      this.dummy.position.set(petal.x, petal.y, petal.z);
      this.dummy.scale.set(size, winter ? size : size * 0.7, size);
      this.dummy.rotation.set(time * 0.4, petal.phase + time * petal.drift, 0);
      this.dummy.updateMatrix();
      this.petals.setMatrixAt(index, this.dummy.matrix);
    });
    this.petals.instanceMatrix.needsUpdate = true;
    this.petals.visible = this.model !== null && fade > 0.02;
  }

  private scatterPetals(initial: boolean) {
    const radius = (this.model?.grid ?? 21) * 0.32;
    for (const petal of this.petalState) this.resetPetal(petal, radius, !initial);
  }

  private resetPetal(petal: Petal, radius: number, fromTop: boolean) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * radius;
    petal.x = Math.cos(angle) * dist;
    petal.z = Math.sin(angle) * dist;
    petal.y = fromTop ? 16 + Math.random() * 3 : 0.4 + Math.random() * 10;
    const winter = this.season === "winter";
    petal.speed = (winter ? 0.22 : 0.38) + Math.random() * (winter ? 0.28 : 0.55);
    petal.drift = 0.5 + Math.random() * 1.5;
    petal.phase = Math.random() * Math.PI * 2;
  }

  private frameCamera(t: number) {
    const grid = this.model?.grid ?? 25;
    if (t >= 1) {
      const half = grid / 2;
      this.ortho.left = -half;
      this.ortho.right = half;
      this.ortho.top = half;
      this.ortho.bottom = -half;
      this.ortho.near = 0.1;
      this.ortho.far = 300;
      this.ortho.position.set(0, 50, 0);
      this.ortho.up.set(0, 0, -1);
      this.ortho.lookAt(0, 0, 0);
      this.ortho.updateProjectionMatrix();
      this.active = this.ortho;
      return;
    }

    const az = lerp(this.orbitAz, 0, smoothstep(0.15, 0.92, t));
    const el = lerp(this.orbitEl, Math.PI / 2 - 0.012, t);
    const fov = lerp(30, 7, t);
    const halfWant = lerp(grid * 0.64, grid * 0.5, t);
    const dist = halfWant / Math.tan((fov * Math.PI) / 360);
    const lookY = lerp(8, 0, t);
    this.persp.fov = fov;
    this.persp.aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.persp.near = 0.08;
    this.persp.far = dist * 4 + 80;
    const horiz = Math.cos(el) * dist;
    this.persp.position.set(horiz * Math.sin(az), Math.sin(el) * dist + lookY, horiz * Math.cos(az));
    const upBlend = smoothstep(0.62, 1, t);
    this.persp.up.set(0, 1 - upBlend, -upBlend).normalize();
    this.persp.lookAt(0, lookY, 0);
    this.persp.updateProjectionMatrix();
    this.active = this.persp;
  }

  private syncBuffer() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.eased >= 1 && this.model) {
      const ppm = Math.max(8, Math.round((this.width * dpr) / this.model.grid));
      const px = this.model.grid * ppm;
      if (this.canvas.width === px && this.canvas.height === px && this.renderer.getPixelRatio() === 1) return;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(px, px, false);
      return;
    }
    const w = Math.max(1, Math.floor(this.width));
    const h = Math.max(1, Math.floor(this.height));
    const bw = Math.max(1, Math.floor(w * dpr));
    const bh = Math.max(1, Math.floor(h * dpr));
    if (this.canvas.width === bw && this.canvas.height === bh) return;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
  }

  private growWood(radius: number) {
    for (const child of [...this.wood.children]) {
      if (child === this.trunk) continue;
      this.wood.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    const trunkTop = 4.7;
    const arms = 8;
    for (let i = 0; i < arms; i++) {
      const angle = (i / arms) * Math.PI * 2 + 0.4;
      const reach = radius * (0.82 + (i % 2) * 0.1);
      const lift = 7.4 + (i % 3) * 0.7;
      const steps = 7;
      let prev = new THREE.Vector3(0, trunkTop, 0);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const next = new THREE.Vector3(
          Math.cos(angle) * reach * t,
          trunkTop + lift * t * 0.92,
          Math.sin(angle) * reach * t,
        );
        this.addTwig(prev, next, lerp(0.28, 0.09, t));
        if (s === 4 || s === 6) {
          const side = angle + (i % 2 === 0 ? 0.75 : -0.65);
          const fork = next.clone();
          fork.x += Math.cos(side) * radius * 0.24;
          fork.z += Math.sin(side) * radius * 0.24;
          fork.y += 1.45;
          this.addTwig(next, fork, 0.1);
        }
        prev = next;
      }
    }
    for (let i = 0; i < 3; i++) {
      const angle = i * 2.2 + 0.5;
      const base = new THREE.Vector3(Math.cos(angle) * 0.3, 11.5, Math.sin(angle) * 0.3);
      const tip = new THREE.Vector3(Math.cos(angle) * 2.8, 17.8, Math.sin(angle) * 1.6);
      this.addTwig(base, tip, 0.08);
    }
  }

  private addTwig(from: THREE.Vector3, to: THREE.Vector3, thickness: number) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const length = dir.length();
    if (length < 0.05) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, length, thickness), this.woodMat);
    mesh.renderOrder = 3;
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.wood.add(mesh);
  }

  private layoutBlossoms() {
    const blocks = this.model?.blocks.filter((block) => block.kind === "canopy") ?? [];
    const tops = new Map<string, number>();
    for (const block of blocks) {
      const key = `${Math.round(block.x)},${Math.round(block.z)}`;
      tops.set(key, Math.max(tops.get(key) ?? 0, block.layer));
    }
    let count = 0;
    const place = (x: number, y: number, z: number, spin: number, size: number, shade: number) => {
      if (count >= this.blossoms.instanceMatrix.count) return;
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(0.4, spin, shade * 0.25);
      this.dummy.scale.set(size, size * 0.92, 1);
      this.dummy.updateMatrix();
      this.blossoms.setMatrixAt(count, this.dummy.matrix);
      const light = 0.7 + (shade * 0.5 + 0.5) * 0.3;
      this.color.setRGB(light, light * 0.9, light * 0.94);
      this.blossoms.setColorAt(count, this.color);
      count += 1;
    };
    for (const block of blocks) {
      const key = `${Math.round(block.x)},${Math.round(block.z)}`;
      const top = tops.get(key) ?? block.layer;
      if (block.layer < top - 3) continue;
      const y = block.layer * 0.92 + 0.2;
      if (y < 8) continue;
      const spin = block.shade * Math.PI;
      place(block.x, y, block.z, spin, 1.55, block.shade);
      place(block.x, y + 0.2, block.z, spin + Math.PI / 2, 1.35, block.shade);
      if (block.layer >= top - 1) {
        place(block.x + block.shade * 0.45, y + 0.55, block.z + block.shade * 0.28, spin + 0.7, 1.15, -block.shade);
      }
    }
    this.blossoms.count = count;
    this.blossoms.instanceMatrix.needsUpdate = true;
    if (this.blossoms.instanceColor) this.blossoms.instanceColor.needsUpdate = true;
  }

  private paintFoliage(t: number) {
    const show = 1 - smoothstep(0.04, 0.62, t);
    const visible = this.model !== null && show > 0.02;
    this.wood.visible = visible;
    this.blossoms.visible = visible;
    this.woodMat.opacity = show;
    this.woodMat.transparent = show < 0.98;
    const trunkMat = this.trunk.material as THREE.MeshBasicMaterial;
    trunkMat.opacity = show;
    trunkMat.transparent = show < 0.98;
    this.blossomMat.opacity = show;
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.pointer = { x: event.clientX, y: event.clientY, moved: false };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.pointer) return;
    const dx = event.clientX - this.pointer.x;
    const dy = event.clientY - this.pointer.y;
    if (Math.hypot(dx, dy) > 4) this.pointer.moved = true;
    if (!this.pointer.moved) return;
    this.yaw -= dx * 0.008;
    this.scrub(this.eased + dy * 0.0035);
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const line = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.canvas.clientHeight : 1;
    this.scrub(this.eased + event.deltaY * line * 0.0018);
  };

  private spinBase(dt: number) {
    if (!this.pointer && this.eased < 0.08) {
      this.yaw += dt * SPIN;
      this.alignHome = null;
      return;
    }
    if (this.eased < 0.08) return;
    if (this.alignHome === null) this.alignHome = Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
    this.yaw = lerp(this.yaw, this.alignHome, Math.min(1, 0.12 + this.eased));
  }

  private onPointerUp = () => {
    if (this.pointer && !this.pointer.moved && performance.now() - this.lastToggle > 450) {
      this.lastToggle = performance.now();
      this.toggle();
    }
    this.pointer = null;
  };
}

function shadedBox() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const normal = geometry.getAttribute("normal");
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const shade = ny > 0.5 ? 1 : ny < -0.5 ? 0.42 : nz > 0.5 ? 0.86 : nz < -0.5 ? 0.68 : nx > 0.5 ? 0.78 : 0.72;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function barkTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  context.fillStyle = "#6d4630";
  context.fillRect(0, 0, 32, 128);
  for (let band = 0; band < 6; band++) {
    context.fillStyle = band % 2 === 0 ? "#4a2f1e" : "#7c5340";
    context.fillRect(0, 8 + band * 20, 32, 7);
  }
  texture.needsUpdate = true;
  return texture;
}

function blossomTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  const cx = 64;
  const cy = 64;
  for (let petal = 0; petal < 5; petal++) {
    const angle = (petal / 5) * Math.PI * 2 - Math.PI / 2;
    context.beginPath();
    context.ellipse(cx + Math.cos(angle) * 26, cy + Math.sin(angle) * 26, 24, 16, angle, 0, Math.PI * 2);
    context.fillStyle = "rgba(235, 190, 205, 0.94)";
    context.fill();
  }
  context.beginPath();
  context.arc(cx, cy, 11, 0, Math.PI * 2);
  context.fillStyle = "rgba(255,255,255,0.98)";
  context.fill();
  texture.needsUpdate = true;
  return texture;
}

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  const gradient = context.createRadialGradient(64, 64, 10, 64, 64, 62);
  gradient.addColorStop(0, "rgba(48, 32, 20, 0.28)");
  gradient.addColorStop(1, "rgba(48, 32, 20, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  texture.needsUpdate = true;
  return texture;
}

function petalHex(season: Season, tint: string) {
  if (season === "winter") return "#f4f8fb";
  if (season === "autumn") return "#e08a3c";
  if (season === "summer") return "#8fb56a";
  return tint;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
