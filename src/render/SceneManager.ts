import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const BOLT_SEGMENTS = 14;

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly clearSky: THREE.Texture;
  private readonly stormSky: THREE.Texture;

  private readonly cloud: THREE.Mesh;
  private readonly cloudMat: THREE.ShaderMaterial;
  private readonly lightningLight: THREE.DirectionalLight;
  private readonly bolt: THREE.LineSegments;
  private readonly boltGeo: THREE.BufferGeometry;
  private readonly boltPositions: Float32Array;

  private stormEnabled = false;
  private flash = 0;
  private flashTimer = 3;
  private boltTime = 0;
  private sceneSize = 2000;
  private sceneCenterH = 0;
  private cloudY = 600;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0b0e13, 1);

    this.scene = new THREE.Scene();
    this.clearSky = makeSkyGradient(['#6f9fd0', '#a9c8e6', '#d9e6f2']);
    this.stormSky = makeSkyGradient(['#1b2230', '#39434f', '#5a6470']);
    this.scene.background = this.clearSky;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 200000);
    this.camera.position.set(1500, 1400, 1500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x55514a, 1.0);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
    this.sun.position.set(-1, 1.4, -0.8).normalize();
    this.scene.add(this.sun, this.sun.target);

    this.lightningLight = new THREE.DirectionalLight(0xdfeaff, 0);
    this.lightningLight.position.set(0.2, 1, 0.1);
    this.scene.add(this.lightningLight, this.lightningLight.target);

    this.cloudMat = makeCloudMaterial();
    const cloudGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.cloud = new THREE.Mesh(cloudGeo, this.cloudMat);
    this.cloud.frustumCulled = false;
    this.cloud.renderOrder = -1;
    this.cloud.visible = false;
    this.scene.add(this.cloud);

    this.boltPositions = new Float32Array(BOLT_SEGMENTS * 2 * 3);
    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3));
    this.bolt = new THREE.LineSegments(
      this.boltGeo,
      new THREE.LineBasicMaterial({ color: 0xeaf2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 5;
    this.bolt.visible = false;
    this.scene.add(this.bolt);

    window.addEventListener('resize', this.onResize);
  }

  /** Frame the camera and lighting to a freshly built terrain. */
  fitToTerrain(sizeMeters: number, centerHeight: number): void {
    this.sceneSize = sizeMeters;
    this.sceneCenterH = centerHeight;
    const d = sizeMeters * 0.85;
    this.camera.position.set(d * 0.7, sizeMeters * 0.6 + 300, d * 0.7);
    this.camera.near = Math.max(1, sizeMeters * 0.008);
    this.camera.far = sizeMeters * 6;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, centerHeight, 0);
    this.controls.minDistance = sizeMeters * 0.08;
    this.controls.maxDistance = sizeMeters * 4;
    this.controls.update();

    const target = new THREE.Vector3(0, centerHeight, 0);
    this.sun.position.set(-1, 1.4, -0.8).multiplyScalar(sizeMeters).add(target);
    this.sun.target.position.copy(target);

    // Just above the camera (height ≈ sizeMeters*0.6) so the cloud ceiling shows
    // as a band along the horizon in the default view, not a slab over the ground.
    this.cloudY = centerHeight + sizeMeters * 0.75 + 300;
    this.cloud.position.set(0, this.cloudY, 0);
    this.cloud.scale.set(sizeMeters * 12, 1, sizeMeters * 12);
    this.lightningLight.position.set(0.2, 1, 0.1).multiplyScalar(sizeMeters).add(target);
    this.lightningLight.target.position.copy(target);

    this.applyStormState();
  }

  setStorm(enabled: boolean): void {
    this.stormEnabled = enabled;
    this.applyStormState();
  }

  private applyStormState(): void {
    const on = this.stormEnabled;
    const s = this.sceneSize;
    this.scene.background = on ? this.stormSky : this.clearSky;
    this.cloud.visible = on;
    this.hemi.intensity = on ? 0.5 : 1.0;
    this.hemi.color.set(on ? 0x9fb0c4 : 0xcfe3ff);
    this.sun.intensity = on ? 0.45 : 2.2;
    this.scene.fog = on
      ? new THREE.Fog(0x39434f, s * 0.5, s * 2.6)
      : new THREE.Fog(0xacc7e0, s * 1.2, s * 5);
    if (!on) {
      this.flash = 0;
      this.lightningLight.intensity = 0;
      this.bolt.visible = false;
      this.cloudMat.uniforms.uFlash.value = 0;
    }
  }

  /** Animate clouds and lightning. Called every frame. */
  updateStorm(dt: number): void {
    this.cloudMat.uniforms.uTime.value += dt;
    if (!this.stormEnabled) return;

    this.flash = Math.max(0, this.flash - dt * 7);
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) this.triggerFlash();
    this.boltTime -= dt;

    this.hemi.intensity = 0.5 + this.flash * 2.4;
    this.lightningLight.intensity = this.flash * 2.6;
    this.cloudMat.uniforms.uFlash.value = this.flash * 1.4;
    this.bolt.visible = this.boltTime > 0;
    (this.bolt.material as THREE.LineBasicMaterial).opacity = Math.min(1, this.boltTime * 6);
  }

  private triggerFlash(): void {
    this.flash = 1;
    const doubleStrike = Math.random() < 0.4;
    this.flashTimer = doubleStrike ? 0.11 : 2.5 + Math.random() * 6.5;
    if (Math.random() < 0.75) {
      this.makeBolt();
      this.boltTime = 0.18 + Math.random() * 0.14;
    }
  }

  private makeBolt(): void {
    const s = this.sceneSize;
    let x = (Math.random() - 0.5) * s * 0.6;
    let z = (Math.random() - 0.5) * s * 0.6;
    const pts: number[][] = [];
    for (let i = 0; i <= BOLT_SEGMENTS; i++) {
      const t = i / BOLT_SEGMENTS;
      pts.push([x, this.cloudY + (this.sceneCenterH - this.cloudY) * t, z]);
      x += (Math.random() - 0.5) * s * 0.05;
      z += (Math.random() - 0.5) * s * 0.05;
    }
    let o = 0;
    for (let i = 0; i < BOLT_SEGMENTS; i++) {
      for (const p of [pts[i], pts[i + 1]]) {
        this.boltPositions[o++] = p[0];
        this.boltPositions[o++] = p[1];
        this.boltPositions[o++] = p[2];
      }
    }
    this.boltGeo.attributes.position.needsUpdate = true;
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}

function makeSkyGradient(stops: [string, string, string]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.5, stops[1]);
  grad.addColorStop(1, stops[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFlash;
      varying vec2 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vP * 6.0 + vec2(uTime * 0.03, uTime * 0.015);
        float n = fbm(p + fbm(p * 0.5));
        float density = smoothstep(0.35, 0.85, n);
        vec3 dark = vec3(0.10, 0.11, 0.14);
        vec3 mid = vec3(0.34, 0.36, 0.42);
        vec3 col = mix(dark, mid, n);
        col += uFlash * vec3(0.85, 0.9, 1.0) * (0.4 + density);
        gl_FragColor = vec4(col, density * 0.95);
      }
    `,
  });
}
