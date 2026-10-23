import * as THREE from "three";
import { buildScene, canopyRadius, type Block, type BuildResult, type Kind, type SceneModel } from "../qr/scene";
import { SEASON_TINT, writeBlockColor, type RGB, type Season, type Theme } from "./palette";
import type { Hologram, PortraitCell } from "./portrait";

const KINDS: Kind[] = ["path", "grass", "finder", "skirt", "trunk", "canopy"];
const PETALS = 120;
const SPIN = 0.34;

type Bucket = {
  mesh: THREE.InstancedMesh;
  blocks: Block[];
};

type Petal = { x: number; y: number; z: number; speed: number; drift: number; phase: number };

type Orbit = { pivot: THREE.Object3D; speed: number; phase: number };

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
  private readonly cream = new THREE.Color(0xfffaf6);
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
  private readonly system = new THREE.Group();
  private readonly halo = new THREE.Group();
  private readonly bokeh = new THREE.Group();
  private readonly orbits: Orbit[] = [];
  private readonly stars: THREE.Points;
  private readonly sky: THREE.Group;
  private sun!: THREE.Mesh;
  private sunGlow!: THREE.Sprite;
  private moonPivot: THREE.Group | null = null;
  private portrait: THREE.InstancedMesh | null = null;
  private hologram: THREE.Group | null = null;
  private hologramUniforms: HoloUniforms | null = null;
  private hologramFigure: THREE.Object3D | null = null;
  private hologramDeck: THREE.Object3D | null = null;
  private hologramFades: THREE.Material[] = [];
  private hologramTexture: THREE.Texture | null = null;
  private portraitHeight = 0;
  private theme: Theme = "day";
  private readonly nightSky = new THREE.Color(0x050b18);
  private gazeX = 0;
  private gazeY = 0;
  private readonly reducedMotion: boolean;
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
  private yaw = 0.4;
  private alignHome: number | null = null;
  private reportedFlat = false;
  private width = 1;
  private height = 1;
  private chromeTop = 0;
  private chromeBottom = 0;
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
      new THREE.PlaneGeometry(0.62, 0.4),
      new THREE.MeshBasicMaterial({ map: petalTexture(), color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
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
    this.buildSystem();
    this.buildHalo();
    this.buildBokeh();
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sky = new THREE.Group();
    this.stars = starField();
    this.sky.add(this.stars);
    this.sky.add(warmStars());
    this.sky.add(nebula());
    this.sky.add(foregroundRocks());
    this.sky.visible = false;
    this.scene.add(this.sky);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointermove", this.onGaze);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointerup", this.onPointerUp);
    this.frame = requestAnimationFrame(this.tick);
  }

  get hasModel() {
    return this.model !== null;
  }

  get isFlat() {
    return this.reportedFlat;
  }

  get hasPortrait() {
    return this.portrait !== null || this.hologram !== null;
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

  setTheme(theme: Theme) {
    if (this.theme === theme) return;
    this.theme = theme;
    (this.platform.material as THREE.MeshBasicMaterial).color.set(theme === "night" ? 0x141a28 : 0xe7dcc8);
    (this.shadow.material as THREE.MeshBasicMaterial).color.set(theme === "night" ? 0x9eb4d8 : 0xffffff);
    this.paintDirty = true;
    this.viewDirty = true;
    this.scatterPetals(false);
  }

  setPortrait(cells: PortraitCell[] | null, wire: Hologram | null = null) {
    if (this.portrait) {
      this.turntable.remove(this.portrait);
      const material = this.portrait.material;
      if (!Array.isArray(material)) material.dispose();
      this.portrait = null;
      this.portraitHeight = 0;
    }
    this.clearHologram();
    if (cells && cells.length > 0) {
      const mesh = new THREE.InstancedMesh(this.cube, new THREE.MeshBasicMaterial({ vertexColors: true }), cells.length);
      mesh.frustumCulled = false;
      let top = 0;
      cells.forEach((cell, index) => {
        this.dummy.position.set(cell.x, cell.y, cell.z);
        this.dummy.scale.set(cell.size, cell.size, cell.size);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
        this.color.setRGB(cell.color[0] / 255, cell.color[1] / 255, cell.color[2] / 255, THREE.SRGBColorSpace);
        mesh.setColorAt(index, this.color);
        top = Math.max(top, cell.y + cell.size / 2);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.turntable.add(mesh);
      this.portrait = mesh;
      this.portraitHeight = top;
    }
    if (wire && wire.pixels.length > 0) {
      this.hologram = this.buildHologram(wire);
      this.scene.add(this.hologram);
    }
    this.paintDirty = true;
    this.viewDirty = true;
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
    link.download = "orbit-qr.png";
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

  setChrome(top: number, bottom: number) {
    const nextTop = Math.max(0, top);
    const nextBottom = Math.max(0, bottom);
    if (nextTop === this.chromeTop && nextBottom === this.chromeBottom) return;
    this.chromeTop = nextTop;
    this.chromeBottom = nextBottom;
    this.viewDirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointermove", this.onGaze);
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
      this.system.visible = false;
      this.halo.visible = false;
      this.stars.visible = false;
      if (this.portrait) this.portrait.visible = false;
      if (this.hologram) this.hologram.visible = false;
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
    this.system.scale.setScalar(clamp(this.model.grid / 30, 0.95, 1.4));
    this.halo.scale.setScalar(clamp(this.model.grid / 33, 0.85, 1.25));
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
    this.spinSystem(dt);
    if (!this.reducedMotion) this.halo.rotation.y += dt * 0.05;
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
    this.paintHologram();
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
        let hidden = fade < 0.001;
        const tile = block.kind === "path" || block.kind === "grass" || block.kind === "finder";
        let xz = unit * fade;
        let ySize = block.height;
        let y = block.layer * unit + ySize / 2;
        let ox = 0;
        let oz = 0;
        if (tile) {
          const raised = this.theme === "night" ? 0.14 + (block.shade + 1) * 0.12 : block.shade > 0.45 ? 0.26 : 0.11;
          xz = lerp(this.theme === "night" ? 0.9 : 0.8, 1, flatten);
          ySize = lerp(raised, 0.16, flatten);
          y = ySize / 2;
        } else if (block.kind === "skirt") {
          const rock = this.theme === "night";
          if (rock && block.layer > 0) {
            hidden = true;
          } else if (rock) {
            xz = 0.62 * fade;
            ySize = block.height * 0.4;
            y = ySize / 2;
          } else {
            const bloom = block.shade > 0.2;
            xz = (bloom ? 0.36 : 0.24) * fade;
            ySize = block.height * (block.layer > 0 ? 0.9 : 0.62) * fade;
            y = ySize / 2;
          }
        } else if (block.kind === "canopy") {
          if (this.theme === "night" && !block.cap) {
            xz = 0.9 * fade;
            ySize = (0.14 + (block.shade + 1) * 0.1) * fade;
            y = ySize / 2;
          } else {
            xz = block.cap ? unit * flatten : 0;
            ySize = block.cap ? lerp(0.16, 0.9, flatten) : 0;
            y = block.cap ? 0.1 + ySize / 2 : -40;
          }
        } else if (this.theme === "night" && block.kind === "trunk") {
          xz = unit * flatten;
          ySize = lerp(0.16, 0.9, flatten);
          y = ySize / 2;
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
        const grass = block.kind === "skirt" && this.theme !== "night";
        this.dummy.rotation.set(
          grass ? block.shade * 0.85 : block.kind === "skirt" ? block.shade * 0.35 : 0,
          grass ? block.shade * 1.4 : 0,
          grass ? block.shade * 0.72 : block.kind === "skirt" ? block.shade * 0.45 : 0,
        );
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
          this.theme,
        );
        this.color.setRGB(this.rgb[0] / 255, this.rgb[1] / 255, this.rgb[2] / 255, THREE.SRGBColorSpace);
        bucket.mesh.setColorAt(index, this.color);
      });
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
      const glass = this.theme === "night" && t < 0.98;
      const material = bucket.mesh.material as THREE.MeshBasicMaterial;
      if (material.transparent !== glass) {
        material.transparent = glass;
        material.needsUpdate = true;
      }
      material.opacity = glass ? lerp(0.7, 1, flatten) : 1;
      material.depthWrite = !glass;
    }
  }

  private updateBackdrop(t: number) {
    const fade = smoothstep(0.5, 1, t);
    if (this.theme === "night") {
      this.scene.background = null;
      this.renderer.setClearColor(this.nightSky, fade);
    } else {
      const sky = this.cream;
      const flat = this.white;
      this.background.copy(sky).lerp(flat, fade);
      this.scene.background = this.background;
      this.renderer.setClearColor(this.background, 1);
    }
    const alive = this.model !== null;
    const night = this.theme === "night";
    this.platform.visible = false;
    this.shadow.visible = alive && t < 0.8;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = (night ? 0.22 : 1) * (1 - smoothstep(0.15, 0.75, t));
    this.petals.visible = alive && t < 0.9;
  }

  private paintPetals(dt: number, t: number) {
    const grid = this.model?.grid ?? 21;
    const radius = grid * 0.32;
    const fade = 1 - smoothstep(0.02, 0.4, t);
    if (this.portrait || this.hologram) {
      this.petals.visible = false;
      return;
    }
    const night = this.theme === "night";
    this.color.set(night ? "#e7eeff" : petalHex(this.season, this.tint));
    (this.petals.material as THREE.MeshBasicMaterial).color.copy(this.color);
    const time = this.clock.elapsedTime;
    const winter = this.season === "winter";
    this.petalState.forEach((petal, index) => {
      if (night) {
        petal.x += Math.cos(petal.phase) * petal.drift * dt * 0.22;
        petal.z += Math.sin(petal.phase) * petal.drift * dt * 0.22;
        petal.y += Math.sin(time * 0.4 + petal.phase) * dt * 0.12;
        if (Math.hypot(petal.x, petal.z) > radius * 1.35 || petal.y > 22 || petal.y < 0.4) this.resetPetal(petal, radius, true);
      } else {
        petal.y -= petal.speed * dt;
        petal.x += Math.sin(time * petal.drift + petal.phase) * dt * 0.18;
        if (petal.y < 0.2) this.resetPetal(petal, radius, true);
      }
      const size = (night ? 0.28 : winter ? 0.55 : 1) * fade;
      this.dummy.position.set(petal.x, petal.y, petal.z);
      this.dummy.scale.set(size, night || winter ? size : size * 0.7, size);
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
    const night = this.theme === "night";
    petal.y = night ? 1.5 + Math.random() * 12 : fromTop ? 16 + Math.random() * 3 : 0.4 + Math.random() * 10;
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

    const night = this.theme === "night";
    const sway = !this.pointer && !this.reducedMotion ? 1 - smoothstep(0, 0.3, t) : 0;
    const az = lerp(this.orbitAz + this.gazeX * 0.05 * sway, 0, smoothstep(0.15, 0.92, t));
    const nightEl = (34 * Math.PI) / 180;
    const dayEl = (32 * Math.PI) / 180;
    const el = lerp((night ? nightEl : dayEl) - this.gazeY * 0.025 * sway, Math.PI / 2 - 0.012, t);
    const fov = lerp(night ? 28 : 30, 7, t);
    const aspect = this.width / Math.max(1, this.height);
    const topFrac = clamp(this.chromeTop / this.height, 0, 0.42);
    const botFrac = clamp(this.chromeBottom / this.height, 0, 0.62);
    const free = Math.max(0.3, 1 - topFrac - botFrac);
    const narrow = aspect < 1;
    const targetH = free * (narrow ? 0.72 : night ? 0.58 : 0.5);
    const targetW = narrow ? 0.72 : night ? 0.48 : 0.5;
    const framedH = Math.sin(night ? nightEl : dayEl) / (2 * targetH);
    const framedW = 1.12 / (2 * targetW * aspect);
    const framed = this.portraitHeight > 0 ? 0.72 : Math.max(framedH, framedW);
    const halfWant = lerp(grid * framed, grid * 0.5, t);
    const dist = halfWant / Math.tan((fov * Math.PI) / 360);
    const lift = (botFrac - topFrac) * halfWant;
    const pose = this.portraitHeight > 0 ? this.portraitHeight * 0.46 : -lift + (night ? 0 : grid * 0.18);
    const lookY = lerp(pose, 0, t);
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
      const light = 0.94 + (shade * 0.5 + 0.5) * 0.06;
      this.color.setRGB(light, light * 0.98, light);
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

  private buildSystem() {
    this.turntable.add(this.system);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffc14a });
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 22), sunMat);
    this.sun.position.y = 3.4;
    this.system.add(this.sun);
    const sunLight = new THREE.PointLight(0xffc56a, 2.6, 46, 1.4);
    sunLight.position.y = 3.4;
    this.system.add(sunLight);
    this.system.add(new THREE.AmbientLight(0x9eb0d4, 0.7));
    this.sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xffd27a,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.sunGlow.position.y = 3.4;
    this.sunGlow.scale.set(9.2, 9.2, 1);
    this.sunGlow.userData.baseOpacity = 0.9;
    this.system.add(this.sunGlow);

    const bodies: { name: string; radius: number; size: number; color: number; speed: number; tilt: number; phase: number; map?: THREE.Texture; ring?: boolean }[] = [
      { name: "mercury", radius: 4.6, size: 0.38, color: 0xc4b8a8, speed: 0.34, tilt: 0.08, phase: 0.4 },
      { name: "venus", radius: 6.4, size: 0.58, color: 0xe7c98a, speed: 0.24, tilt: -0.06, phase: 2.4 },
      { name: "earth", radius: 8.5, size: 0.68, color: 0x3f86d6, speed: 0.16, tilt: 0.12, phase: 4.5, map: earthTexture() },
      { name: "mars", radius: 10.5, size: 0.48, color: 0xc2654a, speed: 0.12, tilt: 0.05, phase: 1.2 },
      { name: "jupiter", radius: 13.4, size: 1.28, color: 0xd8b48a, speed: 0.07, tilt: -0.08, phase: 0.85, map: jupiterTexture() },
      { name: "saturn", radius: 16.6, size: 1.05, color: 0xe6d2a4, speed: 0.045, tilt: 0.28, phase: 2.55, ring: true },
    ];
    for (const body of bodies) {
      const pivot = new THREE.Group();
      pivot.position.y = 3.4;
      pivot.rotation.x = body.tilt;
      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(body.size, 28, 18),
        new THREE.MeshBasicMaterial({ color: body.color, map: body.map }),
      );
      planet.position.x = body.radius;
      pivot.add(planet);
      if (body.name === "earth") {
        this.moonPivot = new THREE.Group();
        this.moonPivot.position.x = body.radius;
        const moon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: 0xd9dde6 }));
        moon.position.set(1.35, 0.25, 0);
        this.moonPivot.add(moon);
        pivot.add(this.moonPivot);
      }
      if (body.ring) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(body.size * 1.4, body.size * 2.15, 48),
          new THREE.MeshBasicMaterial({ color: 0xe7c98a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
        );
        ring.rotation.x = Math.PI / 2.35;
        ring.userData.baseOpacity = 0.9;
        planet.add(ring);
      }
      const path = new THREE.Mesh(
        new THREE.RingGeometry(body.radius - 0.045, body.radius + 0.045, 96),
        new THREE.MeshBasicMaterial({ color: 0xc5d4ef, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthWrite: false }),
      );
      path.rotation.x = -Math.PI / 2;
      path.userData.baseOpacity = 0.42;
      pivot.add(path);
      this.system.add(pivot);
      this.orbits.push({ pivot, speed: body.speed, phase: body.phase });
    }
    this.system.visible = false;
  }

  private buildHalo() {
    this.turntable.add(this.halo);
    const plinth = new THREE.Mesh(
      new THREE.TorusGeometry(3.6, 0.2, 12, 72),
      new THREE.MeshBasicMaterial({ color: 0xf6efe4 }),
    );
    plinth.rotation.x = Math.PI / 2;
    plinth.position.y = 0.22;
    plinth.userData.baseOpacity = 1;
    this.halo.add(plinth);
    const rings = [14.5, 18.5, 23.5];
    for (const radius of rings) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.05, radius + 0.05, 140),
        new THREE.MeshBasicMaterial({
          color: 0xe2c27a,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.userData.baseOpacity = 0.72;
      this.halo.add(ring);
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.28, radius + 0.28, 80),
        new THREE.MeshBasicMaterial({
          color: 0xffe3a8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.userData.baseOpacity = 0.16;
      this.halo.add(glow);
    }
    const pearls: { radius: number; size: number; phase: number; lift: number; color: number }[] = [
      { radius: 14.5, size: 0.42, phase: 0.4, lift: 2.4, color: 0xfff7ea },
      { radius: 18.5, size: 0.7, phase: 2.2, lift: 3.6, color: 0xf8d7a4 },
      { radius: 23.5, size: 0.55, phase: 4.1, lift: 2.8, color: 0xfffdf8 },
    ];
    for (const pearl of pearls) {
      const pivot = new THREE.Group();
      pivot.rotation.y = pearl.phase;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(pearl.size, 20, 14),
        new THREE.MeshBasicMaterial({ color: pearl.color }),
      );
      sphere.position.set(pearl.radius, pearl.lift, 0);
      sphere.userData.baseOpacity = 1;
      const gleam = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: 0xffe6b0,
          transparent: true,
          opacity: 0.65,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      gleam.scale.set(pearl.size * 4.2, pearl.size * 4.2, 1);
      gleam.userData.baseOpacity = 0.65;
      sphere.add(gleam);
      pivot.add(sphere);
      this.halo.add(pivot);
    }
    this.halo.visible = false;
  }

  private buildBokeh() {
    this.persp.add(this.bokeh);
    const map = petalTexture();
    const spots: [number, number, number, number][] = [
      [-6.4, -3.2, -14, 4.4],
      [6.6, -2.4, -13, 3.6],
      [-5.2, 3.4, -16, 3.2],
      [5.8, 3.8, -15, 3.8],
      [0.4, -4.2, -11, 4.8],
    ];
    for (const [x, y, z, scale] of spots) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map,
          color: 0xf7b7c8,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
        }),
      );
      sprite.position.set(x, y, z);
      sprite.scale.set(scale, scale * 0.72, 1);
      sprite.userData.baseOpacity = 0.42;
      this.bokeh.add(sprite);
    }
    this.bokeh.visible = false;
  }

  private fadeGroup(group: THREE.Object3D, show: number) {
    group.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat || Array.isArray(mat) || !("opacity" in mat)) return;
      const basic = mat as THREE.MeshBasicMaterial;
      if (obj.userData.baseOpacity === undefined) obj.userData.baseOpacity = basic.opacity;
      basic.transparent = true;
      basic.opacity = (obj.userData.baseOpacity as number) * show;
    });
  }

  private fadeSystem(show: number) {
    this.fadeGroup(this.system, show);
  }

  private spinSystem(dt: number) {
    if (this.theme !== "night" || !this.model) return;
    const time = this.reducedMotion ? 0 : this.clock.elapsedTime;
    for (const orbit of this.orbits) orbit.pivot.rotation.y = orbit.phase + time * orbit.speed;
    if (this.moonPivot) this.moonPivot.rotation.y = time * 1.8;
    const pulse = 1 + Math.sin(time * 1.7) * 0.045;
    this.sun.scale.setScalar(this.reducedMotion ? 1 : pulse);
    this.sunGlow.scale.set(9.2 * (this.reducedMotion ? 1 : pulse), 9.2 * (this.reducedMotion ? 1 : pulse), 1);
    this.sky.rotation.y += dt * (this.reducedMotion ? 0 : 0.012);
  }

  private clearHologram() {
    if (!this.hologram) return;
    this.scene.remove(this.hologram);
    this.hologram.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material || Array.isArray(material)) return;
      const mapped = material as THREE.MeshBasicMaterial;
      if (mapped.map && mapped.map !== this.hologramTexture) mapped.map.dispose();
      material.dispose();
    });
    this.hologramTexture?.dispose();
    this.hologram = null;
    this.hologramUniforms = null;
    this.hologramFigure = null;
    this.hologramDeck = null;
    this.hologramFades = [];
    this.hologramTexture = null;
  }

  private buildHologram(plate: Hologram) {
    const texture = hologramTexture(plate);
    this.hologramTexture = texture;
    const uniforms: HoloUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uMap: { value: texture },
      uTexel: { value: new THREE.Vector2(1 / plate.width, 1 / plate.height) },
    };
    this.hologramUniforms = uniforms;
    const aspect = plate.width / plate.height;
    let worldH = 13.2;
    let worldW = worldH * aspect;
    if (worldW > 11) {
      worldW = 11;
      worldH = worldW / aspect;
    }
    const baseY = 2.4;
    const group = new THREE.Group();
    const figure = new THREE.Group();
    const deck = new THREE.Group();
    this.hologramFigure = figure;
    this.hologramDeck = deck;
    figure.position.y = 0;
    deck.position.y = 1.7;

    const radius = Math.max(2.6, worldW * 0.4);
    deck.add(this.holoRing(radius * 0.42, radius * 0.48, 0.28));
    deck.add(this.holoRing(radius * 0.68, radius * 0.76, 0.55));
    deck.add(this.holoRing(radius * 0.9, radius * 0.98, 0.85));
    for (let i = 0; i < 16; i++) {
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(i % 4 === 0 ? 0.55 : 0.28, 0.035, 0.035),
        this.holoFadeMaterial(0x9af6ff, i % 4 === 0 ? 0.7 : 0.35),
      );
      const angle = (i / 16) * Math.PI * 2;
      tick.position.set(Math.cos(angle) * radius, 0.02, Math.sin(angle) * radius);
      tick.rotation.y = -angle;
      deck.add(tick);
    }

    for (const x of [-worldW * 0.34, worldW * 0.08, worldW * 0.36]) {
      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, worldH * 0.92),
        this.holoFadeMaterial(0xffffff, 0.22, beamTexture()),
      );
      beam.position.set(x, baseY + worldH * 0.55, -0.55);
      figure.add(beam);
    }

    const bloom = new THREE.Mesh(new THREE.PlaneGeometry(worldW * 1.06, worldH * 1.06), plateMaterial(uniforms, true));
    bloom.position.set(0, baseY + worldH / 2, -0.04);
    const body = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), plateMaterial(uniforms, false));
    body.position.set(0, baseY + worldH / 2, 0);
    figure.add(bloom, body);

    const scatter = hologramScatter(plate, worldW, worldH, baseY);
    if (scatter) {
      const material = new THREE.PointsMaterial({
        size: 0.11,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      material.userData.base = 0.85;
      this.hologramFades.push(material);
      const bits = new THREE.Points(scatter, material);
      bits.frustumCulled = false;
      figure.add(bits);
    }

    const motes = hologramMotes(worldW, worldH);
    const moteMat = moteMaterial(uniforms);
    const motePoints = new THREE.Points(motes, moteMat);
    motePoints.frustumCulled = false;
    figure.add(motePoints);

    group.add(deck, figure);
    group.userData.span = worldH;
    group.visible = false;
    return group;
  }

  private holoRing(inner: number, outer: number, base: number) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 80), this.holoFadeMaterial(0x7ef6ff, base));
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  private holoFadeMaterial(color: number, base: number, map?: THREE.Texture) {
    const material = new THREE.MeshBasicMaterial({
      color,
      map,
      transparent: true,
      opacity: base,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    material.userData.base = base;
    this.hologramFades.push(material);
    return material;
  }

  private paintHologram() {
    if (!this.hologram || !this.hologramUniforms || !this.hologramFigure || !this.hologramDeck) return;
    const show = 1 - smoothstep(0.04, 0.62, this.eased);
    const visible = this.theme === "night" && this.model !== null && show > 0.02;
    this.hologram.visible = visible;
    this.hologramUniforms.uTime.value = this.clock.elapsedTime;
    this.hologramUniforms.uOpacity.value = show;
    for (const material of this.hologramFades) {
      material.opacity = show * (material.userData.base as number);
    }
    const grid = this.model?.grid ?? 33;
    const span = (this.hologram.userData.span as number) || 13.2;
    this.hologram.scale.setScalar(Math.min(16, grid * 0.48) / span);
    if (!visible) return;
    this.hologramFigure.rotation.y = Math.atan2(this.persp.position.x, this.persp.position.z);
    this.hologramDeck.rotation.y = this.clock.elapsedTime * 0.22;
  }

  private paintFoliage(t: number) {
    const show = 1 - smoothstep(0.04, 0.62, t);
    const visible = this.model !== null && show > 0.02;
    const night = this.theme === "night";
    const posed = this.portrait !== null || this.hologram !== null;
    const hologramOn = night && this.hologram !== null;
    this.wood.visible = !night && visible && !posed;
    this.blossoms.visible = !night && visible && !posed;
    this.halo.visible = !night && visible && !posed;
    this.bokeh.visible = !night && this.model !== null && t < 0.85;
    this.system.visible = night && visible && !posed;
    this.sky.visible = night && this.model !== null && t < 0.8;
    if (this.portrait) {
      const material = this.portrait.material as THREE.MeshBasicMaterial;
      material.transparent = show < 0.98;
      material.opacity = show;
      material.depthWrite = show > 0.9;
      this.portrait.visible = visible && !hologramOn;
    }
    if (this.hologram) this.hologram.visible = hologramOn && visible;
    (this.stars.material as THREE.PointsMaterial).opacity = show;
    this.fadeSystem(show);
    this.fadeGroup(this.halo, show);
    this.fadeGroup(this.bokeh, show);
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

  private onGaze = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.gazeX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.gazeY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
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

function petalTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  context.clearRect(0, 0, 64, 64);
  context.fillStyle = "rgba(255,255,255,0.95)";
  context.beginPath();
  context.ellipse(32, 34, 16, 22, -0.5, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 0.55;
  context.beginPath();
  context.ellipse(28, 30, 8, 12, -0.4, 0, Math.PI * 2);
  context.fill();
  texture.needsUpdate = true;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255, 244, 210, 0.95)");
  gradient.addColorStop(0.28, "rgba(255, 186, 72, 0.45)");
  gradient.addColorStop(1, "rgba(255, 160, 40, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  texture.needsUpdate = true;
  return texture;
}

function earthTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  context.fillStyle = "#2f78c8";
  context.fillRect(0, 0, 64, 32);
  context.fillStyle = "#3e9a55";
  context.beginPath();
  context.ellipse(16, 14, 8, 5, 0.4, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.ellipse(40, 18, 7, 4, -0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#eaf4ff";
  context.fillRect(0, 0, 64, 3);
  context.fillRect(0, 29, 64, 3);
  texture.needsUpdate = true;
  return texture;
}

function jupiterTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  const bands = ["#e6d2ae", "#c8966a", "#f3e6c8", "#b98458", "#edd7b0", "#d7a36a"];
  bands.forEach((band, index) => {
    context.fillStyle = band;
    context.fillRect(0, index * 5, 64, 6);
  });
  context.fillStyle = "#c45a4a";
  context.beginPath();
  context.ellipse(40, 20, 6, 4, 0, 0, Math.PI * 2);
  context.fill();
  texture.needsUpdate = true;
  return texture;
}

function starField() {
  const count = 520;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const reach = 18 + Math.random() * 70;
    const angle = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * reach;
    positions[i * 3 + 1] = -4 + Math.random() * 56;
    positions[i * 3 + 2] = Math.sin(angle) * reach * (0.5 + Math.random() * 0.8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xe7eeff, size: 1.35, sizeAttenuation: false, transparent: true, opacity: 1, depthWrite: false }),
  );
}

function warmStars() {
  const count = 36;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const reach = 24 + Math.random() * 50;
    const angle = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * reach;
    positions[i * 3 + 1] = 6 + Math.random() * 30;
    positions[i * 3 + 2] = Math.sin(angle) * reach;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xffd2a8, size: 2.1, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false }),
  );
}

function nebula() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (context) {
    const left = context.createRadialGradient(90, 130, 8, 90, 130, 110);
    left.addColorStop(0, "rgba(150, 186, 230, 0.45)");
    left.addColorStop(1, "rgba(16, 35, 61, 0)");
    context.fillStyle = left;
    context.fillRect(0, 0, 256, 256);
    const right = context.createRadialGradient(180, 110, 6, 180, 110, 90);
    right.addColorStop(0, "rgba(90, 130, 190, 0.28)");
    right.addColorStop(1, "rgba(10, 20, 38, 0)");
    context.fillStyle = right;
    context.fillRect(0, 0, 256, 256);
    texture.needsUpdate = true;
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  sprite.position.set(0, 16, -8);
  sprite.scale.set(78, 42, 1);
  return sprite;
}

function rockTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  context.filter = "blur(2px)";
  context.fillStyle = "rgba(12, 10, 14, 0.82)";
  context.beginPath();
  context.ellipse(32, 34, 22, 16, 0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(28, 24, 30, 0.55)";
  context.beginPath();
  context.ellipse(24, 28, 8, 6, -0.4, 0, Math.PI * 2);
  context.fill();
  texture.needsUpdate = true;
  return texture;
}

function foregroundRocks() {
  const group = new THREE.Group();
  const map = rockTexture();
  const spots: [number, number, number, number][] = [
    [-38, 5, 24, 11],
    [40, 7, 20, 9],
    [-30, 18, -6, 7],
    [32, 3, -14, 8],
    [8, 22, 30, 6],
  ];
  for (const [x, y, z, scale] of spots) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map, color: 0x14110f, transparent: true, opacity: 0.78, depthWrite: false }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale * 0.7, 1);
    group.add(sprite);
  }
  return group;
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

type HoloUniforms = {
  uTime: { value: number };
  uOpacity: { value: number };
  uMap: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
};

const PLATE_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PLATE_FRAG = `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uBloom;

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 uv = vUv;
    float slice = floor(uv.y * 64.0);
    float tick = floor(uTime * 7.0);
    float n = fract(sin(slice * 91.7 + tick * 13.1) * 43758.5);
    float glitch = step(0.9, n);
    uv.x += (n - 0.5) * 0.045 * glitch;

    float shift = 0.0025 + glitch * 0.008;
    vec4 texel = texture2D(uMap, uv);
    vec3 src = vec3(
      texture2D(uMap, uv + vec2(shift, 0.0)).r,
      texel.g,
      texture2D(uMap, uv - vec2(shift, 0.0)).b
    );
    float a = texel.a;
    float lum = luma(src);
    float lL = luma(texture2D(uMap, uv + vec2(-uTexel.x * 2.0, 0.0)).rgb);
    float lR = luma(texture2D(uMap, uv + vec2(uTexel.x * 2.0, 0.0)).rgb);
    float lU = luma(texture2D(uMap, uv + vec2(0.0, uTexel.y * 2.0)).rgb);
    float lD = luma(texture2D(uMap, uv + vec2(0.0, -uTexel.y * 2.0)).rgb);
    float edge = clamp((abs(lL - lum) + abs(lR - lum) + abs(lU - lum) + abs(lD - lum)) * 2.2, 0.0, 1.0);
    float aL = texture2D(uMap, uv + vec2(-uTexel.x * 3.0, 0.0)).a;
    float aR = texture2D(uMap, uv + vec2(uTexel.x * 3.0, 0.0)).a;
    float aU = texture2D(uMap, uv + vec2(0.0, uTexel.y * 3.0)).a;
    float aD = texture2D(uMap, uv + vec2(0.0, -uTexel.y * 3.0)).a;
    float rim = clamp((abs(aL - a) + abs(aR - a) + abs(aU - a) + abs(aD - a)) * 1.4, 0.0, 1.0);
    edge = max(edge, rim);

    float scan = 0.72 + 0.28 * sin(uv.y * 180.0);
    float sweep = smoothstep(0.045, 0.0, abs(fract(uv.y - uTime * 0.14) - 0.5));
    float torso = smoothstep(0.2, 0.62, 1.0 - uv.y);
    float strands = 0.72 + 0.28 * sin(uv.x * 140.0 + uv.y * 28.0);
    float mag = step(0.94, n);

    vec3 tint = vec3(0.28, 0.8, 1.0);
    vec3 holo = mix(src, tint, 0.66);
    holo *= 0.32 + lum * 1.25;
    holo *= mix(1.0, strands, torso * lum);
    holo += vec3(0.35, 0.95, 1.0) * edge * 1.05;
    holo += vec3(0.55, 0.95, 1.0) * sweep * 0.4;
    holo = mix(holo, vec3(1.0, 0.32, 0.82), mag * 0.8);

    float empty = step(a, 0.05) + step(lum, 0.045);
    if (uBloom > 0.5) {
      float alpha = (edge * 0.9 + lum * 0.05) * scan * uOpacity;
      if (alpha < 0.04 || (empty > 0.5 && edge < 0.25)) discard;
      gl_FragColor = vec4(vec3(0.4, 0.92, 1.0) * (0.55 + edge), alpha);
      return;
    }

    if (empty > 0.5 && edge < 0.22) discard;
    float alpha = a * (0.42 + lum * 0.4 + edge * 0.55) * scan;
    alpha = clamp(alpha, 0.0, 0.88) * uOpacity;
    gl_FragColor = vec4(holo, alpha);
  }
`;

const MOTE_VERT = `
  attribute float aSeed;
  varying float vSeed;
  uniform float uTime;
  void main() {
    vSeed = aSeed;
    vec3 p = position;
    p.y = mod(position.y - 0.4 + uTime * (0.28 + aSeed * 0.7), 14.0) + 0.4;
    p.x += sin(uTime * 0.8 + aSeed * 12.0) * 0.18;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(160.0 / max(1.0, -mv.z), 1.1, 3.2);
  }
`;

const MOTE_FRAG = `
  varying float vSeed;
  uniform float uOpacity;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);
    if (dist > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, dist);
    vec3 color = mix(vec3(0.4, 0.9, 1.0), vec3(1.0, 0.35, 0.82), step(0.72, vSeed));
    gl_FragColor = vec4(color, glow * uOpacity * 0.85);
  }
`;

function plateMaterial(uniforms: HoloUniforms, bloom: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uOpacity: uniforms.uOpacity,
      uMap: uniforms.uMap,
      uTexel: uniforms.uTexel,
      uBloom: { value: bloom ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: bloom ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: PLATE_VERT,
    fragmentShader: PLATE_FRAG,
  });
}

function moteMaterial(uniforms: HoloUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uOpacity: uniforms.uOpacity,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
  });
}

function hologramTexture(plate: Hologram) {
  const canvas = document.createElement("canvas");
  canvas.width = plate.width;
  canvas.height = plate.height;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (!context) return texture;
  context.putImageData(new ImageData(new Uint8ClampedArray(plate.pixels), plate.width, plate.height), 0, 0);
  texture.needsUpdate = true;
  return texture;
}

function hologramScatter(plate: Hologram, worldW: number, worldH: number, baseY: number) {
  const stride = Math.max(2, Math.floor(Math.max(plate.width, plate.height) / 42));
  const positions: number[] = [];
  const colors: number[] = [];
  for (let y = 0; y < plate.height; y += stride) {
    for (let x = 0; x < plate.width; x += stride) {
      const index = (y * plate.width + x) * 4;
      const alpha = plate.pixels[index + 3];
      if (alpha < 24) continue;
      const lum = (plate.pixels[index] + plate.pixels[index + 1] + plate.pixels[index + 2]) / (3 * 255);
      if (lum < 0.05) continue;
      const nx = (x / Math.max(1, plate.width - 1) - 0.5) * worldW;
      const ny = (1 - y / Math.max(1, plate.height - 1)) * worldH + baseY;
      const jx = ((x * 13 + y * 7) % 9) / 9 - 0.5;
      positions.push(nx + jx * 0.22, ny, 0.18 + lum * 0.28);
      if ((x + y) % 7 === 0) colors.push(1, 0.35, 0.85);
      else colors.push(0.45 + lum * 0.2, 0.88, 1);
    }
  }
  if (positions.length < 9) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function hologramMotes(worldW: number, worldH: number) {
  const positions: number[] = [];
  const seeds: number[] = [];
  const span = Math.max(8, Math.round(worldH * 10));
  for (let i = 0; i < 90; i++) {
    const angle = (i * 2.399) % (Math.PI * 2);
    const radius = 0.4 + (i % 11) * 0.22 + worldW * 0.08;
    positions.push(Math.cos(angle) * radius, 0.4 + ((i * 17) % span) / 10, Math.sin(angle) * 0.35);
    seeds.push((i % 10) / 10);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  return geometry;
}

function beamTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, "rgba(150, 230, 255, 0)");
  gradient.addColorStop(0.4, "rgba(170, 240, 255, 0.95)");
  gradient.addColorStop(1, "rgba(150, 230, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 16, 128);
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
