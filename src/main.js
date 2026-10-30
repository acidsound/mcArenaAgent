import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $('#world');
const intro = $('#intro');
const gameUI = $('#game-ui');
const pauseOverlay = $('#pause-overlay');
const gameoverOverlay = $('#gameover-overlay');
const deployButton = $('#deploy-button');
const resumeButton = $('#resume-button');
const retryButton = $('#retry-button');
const pauseButton = $('#pause-button');
const soundToggle = $('#sound-toggle');
const fullscreenToggle = $('#fullscreen-toggle');
const xrSlot = $('#xr-slot');
const aimLabel = $('#aim-label');
const toast = $('#wave-toast');
const cityPips = $('#city-pips');
const launcherCards = $$('.battery-card');
const batteryNames = ['VANGUARD', 'MERIDIAN', 'ORBITAL'];
const initialAmmo = 8;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030810);
scene.fog = new THREE.FogExp2(0x061019, 0.0058);
const world = new THREE.Group();
scene.add(world);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 260);
camera.position.set(0, 14.5, 25.5);
camera.lookAt(0, 1.2, -8.5);
const cameraRig = new THREE.Group();
scene.add(cameraRig);
cameraRig.add(camera);
const desktopCameraPosition = camera.position.clone();
const desktopCameraQuaternion = camera.quaternion.clone();

const hemisphere = new THREE.HemisphereLight(0x9bd9d7, 0x071019, 1.05);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(0x7bded2, 1.9);
keyLight.position.set(-22, 35, -4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -45;
keyLight.shadow.camera.right = 45;
keyLight.shadow.camera.top = 45;
keyLight.shadow.camera.bottom = -30;
keyLight.shadow.bias = -0.0004;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xffa578, 0.67);
rimLight.position.set(26, 14, -24);
scene.add(rimLight);
const fieldGlow = new THREE.PointLight(0x42cfc4, 1.15, 52, 2);
fieldGlow.position.set(0, 8, -6);
scene.add(fieldGlow);

const glowTexture = makeGlowTexture();
const random = mulberry32(73109);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const xrAimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 14);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const upAxis = new THREE.Vector3(0, 1, 0);
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();

let mode = 'menu';
let paused = false;
let muted = false;
let score = 0;
let wave = 0;
let enemiesSpawned = 0;
let enemiesInWave = 0;
let spawnTimer = 0;
let waveClearTimer = 0;
let gameClock = 0;
let comboCount = 0;
let lastKillTime = -100;
let lastShotTime = -100;
let currentAim = new THREE.Vector3(0, 5, -10);
let aimVisible = false;
let autoBattery = 1;
let manualBattery = null;
let toastTimer = 0;
let hudTimer = 0;
let stars;
let terrainMaterial;
let aimMarker;
let xrControllerLines = [];

const cities = [];
const launchers = [];
const enemyMissiles = [];
const friendlyMissiles = [];
const explosions = [];
const sceneEffects = [];

const clock = new THREE.Clock();
let sound = null;

buildWorld();
buildCities();
buildLaunchers();
buildAimMarker();
setupXR();
setupUI();
updateHud(true);
updateClockReadout();

renderer.setAnimationLoop(animate);

function makeGlowTexture() {
  const size = 64;
  const canvas2d = document.createElement('canvas');
  canvas2d.width = size;
  canvas2d.height = size;
  const ctx = canvas2d.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.13, 'rgba(255,255,255,.9)');
  gradient.addColorStop(0.33, 'rgba(255,255,255,.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildWorld() {
  const terrainGeometry = new THREE.PlaneGeometry(180, 150, 1, 1);
  terrainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAccent: { value: new THREE.Color(0x36cbbd) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorld = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uAccent;
      varying vec3 vWorld;
      float gridLine(float value, float spacing, float width) {
        float f = abs(fract(value / spacing + 0.5) - 0.5) * spacing;
        return 1.0 - smoothstep(0.0, width, f);
      }
      void main() {
        vec2 p = vWorld.xz;
        float d = length(p - vec2(0.0, -7.0));
        float fade = 1.0 - smoothstep(28.0, 82.0, d);
        float fine = max(gridLine(p.x, 4.0, 0.035), gridLine(p.y, 4.0, 0.035));
        float major = max(gridLine(p.x, 16.0, 0.055), gridLine(p.y, 16.0, 0.055));
        float cross = max(gridLine(p.x, 1.0, 0.018), gridLine(p.y, 1.0, 0.018));
        float pulse = 0.5 + 0.5 * sin(uTime * 0.32 - d * 0.23);
        float radial = exp(-d * 0.055);
        vec3 color = vec3(0.0035, 0.011, 0.018);
        color += uAccent * fine * fade * 0.075;
        color += uAccent * major * fade * 0.135;
        color += uAccent * cross * fade * 0.018;
        color += uAccent * radial * (0.025 + pulse * 0.012);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthWrite: true,
  });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -0.54;
  terrain.receiveShadow = true;
  world.add(terrain);

  addGroundRing(17.5, 0.025, 0x1b7d80, 0.22, 0, -8);
  addGroundRing(28, 0.018, 0x11646b, 0.16, 0, -8);
  addGroundRing(4.3, 0.018, 0x227f7b, 0.18, 0, -8);

  const boundary = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-29, -0.49, 8),
      new THREE.Vector3(29, -0.49, 8),
      new THREE.Vector3(29, -0.49, -29),
      new THREE.Vector3(-29, -0.49, -29),
    ]),
    new THREE.LineBasicMaterial({ color: 0x2fb5ad, transparent: true, opacity: 0.24 }),
  );
  world.add(boundary);

  const starsGeometry = new THREE.BufferGeometry();
  const starPositions = [];
  const starSizes = [];
  for (let i = 0; i < 1050; i++) {
    starPositions.push((random() - 0.5) * 180, 11 + random() * 70, -105 + random() * 95);
    starSizes.push(0.35 + random() * 1.15);
  }
  starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xa4d8da,
    map: glowTexture,
    size: 0.42,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  stars = new THREE.Points(starsGeometry, starMaterial);
  world.add(stars);

  buildMoon();
  buildAurora();
  buildRadarBeacons();
}

function addGroundRing(radius, width, color, opacity, x, z) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - width, radius + width, 160), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, -0.495, z);
  world.add(ring);
  return ring;
}

function buildMoon() {
  const moonGroup = new THREE.Group();
  moonGroup.position.set(32, 29, -76);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(13.8, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x71828a, roughness: 1, metalness: 0.02, emissive: 0x111b20, emissiveIntensity: 0.26 }),
  );
  moon.castShadow = false;
  moon.receiveShadow = true;
  moonGroup.add(moon);

  const craterMaterial = new THREE.MeshStandardMaterial({ color: 0x566971, roughness: 1, metalness: 0, emissive: 0x080d10, emissiveIntensity: 0.16 });
  const craters = [
    [-4.7, 2.6, 11.8, 2.0], [2.7, 4.1, 12.7, 1.25], [5.5, -2.5, 11.8, 1.55],
    [-1.7, -4.4, 12.9, 1.1], [-6.2, -2, 10.9, 0.85], [2.4, -1.4, 13.4, 0.58],
  ];
  for (const [x, y, z, radius] of craters) {
    const crater = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), craterMaterial.clone());
    crater.position.set(x, y, z);
    crater.lookAt(0, 0, 0);
    moonGroup.add(crater);
  }
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(14.55, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x7dd8d0, transparent: true, opacity: 0.035, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  moonGroup.add(halo);
  world.add(moonGroup);
}

function buildAurora() {
  for (let band = 0; band < 3; band++) {
    const points = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      points.push(new THREE.Vector3(-54 + t * 95, 16 + Math.sin(t * Math.PI * 3 + band * 0.8) * (1.3 + band * 0.35), -52 - band * 3 + Math.cos(t * Math.PI * 2 + band) * 3));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(90)),
      new THREE.LineBasicMaterial({ color: band === 1 ? 0x73e7cf : 0x49b8c4, transparent: true, opacity: 0.055 - band * 0.008, blending: THREE.AdditiveBlending }),
    );
    world.add(line);
  }
}

function buildRadarBeacons() {
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const radius = 25.5;
    const x = Math.cos(angle) * radius;
    const z = -8 + Math.sin(angle) * radius * 0.72;
    const beacon = new THREE.Group();
    beacon.position.set(x, -0.38, z);
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.015, 5, 20),
      new THREE.MeshBasicMaterial({ color: 0x59d7ce, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending }),
    );
    hoop.rotation.x = Math.PI / 2;
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x65eed8, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending }));
    lamp.scale.set(0.75, 0.75, 0.75);
    lamp.position.y = 0.62;
    beacon.add(hoop, lamp);
    world.add(beacon);
    sceneEffects.push({ type: 'beacon', object: beacon, lamp, phase: i * 0.65 });
  }
}

function buildCities() {
  const positions = [-20, -12, -4, 4, 12, 20];
  const names = ['NORTHSTAR', 'VESTA', 'LUMEN', 'SOLACE', 'HAVEN', 'EASTGATE'];
  positions.forEach((x, index) => cities.push(makeCity(x, -15 + (index % 2 ? 0.45 : -0.3), index, names[index])));
  renderCityPips();
}

function makeCity(x, z, index, name) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  world.add(group);
  const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x0a1a22, roughness: 0.68, metalness: 0.52, emissive: 0x031b20, emissiveIntensity: 0.42 });
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.05, 0.35, 40), platformMaterial);
  platform.position.y = -0.33;
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  const shield = new THREE.Mesh(
    new THREE.TorusGeometry(2.56, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x51e5d2, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }),
  );
  shield.rotation.x = Math.PI / 2;
  shield.position.y = -0.105;
  group.add(shield);
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.95, 0.018, 5, 64),
    new THREE.MeshBasicMaterial({ color: 0x3f9f9d, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }),
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = -0.105;
  group.add(innerRing);

  const buildingsGroup = new THREE.Group();
  group.add(buildingsGroup);
  const buildingCount = 5 + (index % 2);
  const buildingMaterials = [];
  const windowMaterials = [];
  for (let b = 0; b < buildingCount; b++) {
    const angle = (b / buildingCount) * Math.PI * 2 + index * 0.3;
    const radius = b === 0 ? 0.15 : 0.55 + random() * 1.15;
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius * 0.75;
    const height = b === 0 ? 4.8 + random() * 1.4 : 1.7 + random() * 3.25;
    const width = b === 0 ? 0.92 : 0.66 + random() * 0.52;
    const depth = width * (0.8 + random() * 0.45);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: b === 0 ? 0x132a33 : 0x10232c,
      roughness: 0.62,
      metalness: 0.42,
      emissive: index % 2 ? 0x06262a : 0x081e29,
      emissiveIntensity: 0.48,
    });
    buildingMaterials.push(bodyMaterial);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterial);
    tower.position.set(px, height / 2 - 0.13, pz);
    tower.castShadow = true;
    tower.receiveShadow = true;
    buildingsGroup.add(tower);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.78, 0.07, depth * 0.78),
      new THREE.MeshBasicMaterial({ color: index % 2 ? 0x67e5d4 : 0x55b9d4, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending }),
    );
    roof.position.set(px, height - 0.08, pz);
    buildingsGroup.add(roof);

    const strips = Math.max(2, Math.floor(height / 0.8));
    for (let row = 0; row < strips; row++) {
      if (random() < 0.14) continue;
      const windowMaterial = new THREE.MeshBasicMaterial({ color: random() > 0.76 ? 0xf9bd73 : 0x48c9c2, transparent: true, opacity: 0.32 + random() * 0.42, blending: THREE.AdditiveBlending });
      windowMaterials.push(windowMaterial);
      const windowStrip = new THREE.Mesh(new THREE.BoxGeometry(width * (0.42 + random() * 0.3), 0.035, 0.018), windowMaterial);
      windowStrip.position.set(px, 0.32 + row * 0.62, pz + depth / 2 + 0.015);
      buildingsGroup.add(windowStrip);
      if (random() > 0.42) {
        const sideStrip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.035, depth * 0.44), windowMaterial);
        sideStrip.position.set(px + width / 2 + 0.014, 0.32 + row * 0.62, pz);
        buildingsGroup.add(sideStrip);
      }
    }
    if (b === 0) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.03, 0.9, 6),
        new THREE.MeshBasicMaterial({ color: 0x6ce8da, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending }),
      );
      antenna.position.set(px, height + 0.38, pz);
      buildingsGroup.add(antenna);
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x65f5dd, transparent: true, opacity: 0.88, depthWrite: false, blending: THREE.AdditiveBlending }));
      beacon.scale.set(1.15, 1.15, 1.15);
      beacon.position.set(px, height + 0.9, pz);
      buildingsGroup.add(beacon);
    }
  }

  const cityLight = new THREE.PointLight(0x48ded2, 1.15, 9, 2);
  cityLight.position.set(0, 2.5, 0);
  group.add(cityLight);
  const burnGroup = new THREE.Group();
  burnGroup.position.y = 1.1;
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff503f, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.scale.set(1.5, 2.1, 1.1);
  burnGroup.add(flame);
  const burnGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xff613d, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  burnGlow.scale.set(5.5, 5.5, 1);
  burnGlow.position.y = 1.5;
  burnGroup.add(burnGlow);
  burnGroup.visible = false;
  group.add(burnGroup);

  return { group, x, z, index, name, alive: true, shield, innerRing, buildingsGroup, cityLight, burnGroup, buildingMaterials, windowMaterials };
}

function buildLaunchers() {
  const positions = [-18, 0, 18];
  positions.forEach((x, index) => launchers.push(makeLauncher(x, 6.3, index)));
}

function makeLauncher(x, z, index) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  world.add(group);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.62, 1.78, 0.45, 32),
    new THREE.MeshStandardMaterial({ color: 0x0c1c25, roughness: 0.5, metalness: 0.62, emissive: 0x052328, emissiveIntensity: 0.5 }),
  );
  base.position.y = -0.25;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const padRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.46, 0.055, 8, 64),
    new THREE.MeshBasicMaterial({ color: index === 1 ? 0x70fff0 : 0x37c7c1, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending }),
  );
  padRing.rotation.x = Math.PI / 2;
  padRing.position.y = 0.0;
  group.add(padRing);

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.77, 1.03, 0.78, 8),
    new THREE.MeshStandardMaterial({ color: 0x1b3038, roughness: 0.42, metalness: 0.78, emissive: 0x08252a, emissiveIntensity: 0.58 }),
  );
  collar.position.y = 0.35;
  collar.castShadow = true;
  group.add(collar);

  const centralColumn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.72, 1.12, 10),
    new THREE.MeshStandardMaterial({ color: 0x152a33, roughness: 0.38, metalness: 0.72, emissive: 0x062b30, emissiveIntensity: 0.46 }),
  );
  centralColumn.position.y = 1.15;
  centralColumn.castShadow = true;
  group.add(centralColumn);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.3, 1.25, 10),
    new THREE.MeshStandardMaterial({ color: 0x30434a, roughness: 0.32, metalness: 0.8, emissive: 0x10363a, emissiveIntensity: 0.38 }),
  );
  barrel.position.set(0, 1.83, -0.06);
  barrel.rotation.x = -0.12;
  barrel.castShadow = true;
  group.add(barrel);

  const barrelMuzzle = new THREE.Mesh(
    new THREE.TorusGeometry(0.215, 0.035, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0x71f7e5, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }),
  );
  barrelMuzzle.position.set(0, 2.47, -0.14);
  group.add(barrelMuzzle);

  const sidePylons = [];
  for (let side = -1; side <= 1; side += 2) {
    const pylon = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.9, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x122a32, roughness: 0.45, metalness: 0.68, emissive: 0x0a3437, emissiveIntensity: 0.4 }),
    );
    pylon.position.set(side * 0.72, 0.37, 0.2);
    group.add(pylon);
    sidePylons.push(pylon);
  }

  const pods = [];
  for (let i = 0; i < initialAmmo; i++) {
    const angle = (i / initialAmmo) * Math.PI * 2;
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.39, 7),
      new THREE.MeshStandardMaterial({ color: 0x68eedc, roughness: 0.3, metalness: 0.35, emissive: 0x28bfae, emissiveIntensity: 0.75 }),
    );
    pod.position.set(Math.cos(angle) * 1.17, 0.2, Math.sin(angle) * 1.17);
    pod.rotation.z = Math.cos(angle) * -0.1;
    group.add(pod);
    pods.push(pod);
  }

  const centerLight = new THREE.PointLight(0x50edda, 0.75, 7, 2);
  centerLight.position.set(0, 0.5, 0);
  group.add(centerLight);

  const nameTag = new THREE.Group();
  const tagRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.23, 0.018, 5, 24),
    new THREE.MeshBasicMaterial({ color: 0x60f0dc, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending }),
  );
  tagRing.rotation.x = Math.PI / 2;
  tagRing.position.set(0, 2.65, 0);
  nameTag.add(tagRing);
  group.add(nameTag);

  const selectionRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.05, 0.025, 6, 70),
    new THREE.MeshBasicMaterial({ color: 0x62f6e0, transparent: true, opacity: 0.03, blending: THREE.AdditiveBlending }),
  );
  selectionRing.rotation.x = Math.PI / 2;
  selectionRing.position.y = -0.47;
  group.add(selectionRing);

  return { group, x, z, index, ammo: initialAmmo, pods, padRing, selectionRing, centerLight, launchPoint: new THREE.Vector3(x, 2.45, z - 0.12) };
}

function buildAimMarker() {
  aimMarker = new THREE.Group();
  aimMarker.visible = false;
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x76fff0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.025, 6, 48), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  aimMarker.add(ring);
  const secondRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.012, 5, 48),
    new THREE.MeshBasicMaterial({ color: 0x5be6d9, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  secondRing.rotation.x = Math.PI / 2;
  aimMarker.add(secondRing);
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xd9fff9, blending: THREE.AdditiveBlending }));
  aimMarker.add(center);
  const tickMaterial = new THREE.MeshBasicMaterial({ color: 0x83fff0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 4; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), tickMaterial);
    const angle = Math.PI * 0.5 * i;
    tick.position.set(Math.cos(angle) * 1.22, 0.02, Math.sin(angle) * 1.22);
    tick.rotation.y = -angle;
    aimMarker.add(tick);
  }
  const vertical = new THREE.Mesh(
    new THREE.RingGeometry(0.94, 0.96, 48, 1, Math.PI * 0.16, Math.PI * 0.28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  vertical.rotation.x = -Math.PI / 2;
  aimMarker.add(vertical);
  world.add(aimMarker);
}

function setupXR() {
  const xrButton = VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay'],
    domOverlay: { root: document.body },
  });
  xrButton.classList.add('xr-entry-button');
  xrButton.setAttribute('aria-label', 'Enter WebXR immersive mode');
  if (xrButton.tagName === 'A' && !('xr' in navigator)) {
    xrButton.removeAttribute('href');
    xrButton.textContent = 'VR UNAVAILABLE';
    xrButton.style.cursor = 'not-allowed';
    xrButton.style.pointerEvents = 'none';
  }
  xrSlot.appendChild(xrButton);

  const initialPosition = camera.position.clone();
  const initialQuaternion = camera.quaternion.clone();
  renderer.xr.addEventListener('sessionstart', () => {
    document.body.classList.add('in-xr');
    cameraRig.position.set(0, 0, 14);
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    cameraRig.updateMatrixWorld(true);
    sound.unlock();
  });
  renderer.xr.addEventListener('sessionend', () => {
    document.body.classList.remove('in-xr');
    cameraRig.position.set(0, 0, 0);
    camera.position.copy(initialPosition || desktopCameraPosition);
    camera.quaternion.copy(initialQuaternion || desktopCameraQuaternion);
    cameraRig.updateMatrixWorld(true);
  });

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -16)];
    const laser = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x6cf8e5, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    controller.add(laser);
    const controllerShell = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a3439, roughness: 0.34, metalness: 0.68, emissive: 0x0b3737, emissiveIntensity: 0.55 }),
    );
    handle.position.set(0, -0.095, 0.025);
    const emitter = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x7cfff0, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    emitter.position.set(0, 0.01, -0.055);
    const controllerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.009, 5, 22),
      new THREE.MeshBasicMaterial({ color: 0x63f6e0, transparent: true, opacity: 0.74, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    controllerRing.position.set(0, 0.01, -0.055);
    controllerShell.add(handle, emitter, controllerRing);
    controller.add(controllerShell);
    controller.addEventListener('selectstart', () => {
      if (mode === 'menu') {
        startGame();
        return;
      }
      if (mode !== 'playing' || paused) return;
      controllerFire(controller);
    });
    cameraRig.add(controller);
    xrControllerLines.push({ controller, laser });
  }
}

function setupUI() {
  deployButton.addEventListener('click', startGame);
  retryButton.addEventListener('click', startGame);
  resumeButton.addEventListener('click', () => setPaused(false));
  pauseButton.addEventListener('click', () => setPaused(!paused));

  launcherCards.forEach((card, index) => {
    card.addEventListener('click', () => {
      manualBattery = index;
      autoBattery = index;
      sound.ui();
      updateBatteryHud();
      updateLauncherHighlight();
    });
  });

  soundToggle.addEventListener('click', () => {
    muted = !muted;
    sound.setMuted(muted);
    soundToggle.querySelector('small').textContent = muted ? 'SFX OFF' : 'SFX ON';
    soundToggle.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    soundToggle.classList.toggle('is-muted', muted);
    if (!muted) { sound.unlock(); sound.ui(); }
  });

  fullscreenToggle.addEventListener('click', toggleFullscreen);
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('fullscreenchange', () => {
    fullscreenToggle.classList.toggle('active', Boolean(document.fullscreenElement));
  });

  renderCityPips();
  updateBatteryHud();
  updateLauncherHighlight();
}

function onPointerMove(event) {
  if (renderer.xr.isPresenting) return;
  if (mode !== 'playing' || paused) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const snapped = findThreatAlongRay(raycaster.ray);
  if (snapped) {
    currentAim.copy(snapped);
  } else {
    const screenY = THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const targetAltitude = THREE.MathUtils.lerp(12, 1.2, screenY);
    groundPlane.constant = -targetAltitude;
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)) currentAim.copy(hit);
  }
  normalizeAimPoint(currentAim);
  aimVisible = true;
  aimMarker.visible = true;
  aimMarker.position.set(currentAim.x, currentAim.y, currentAim.z);
  aimMarker.rotation.y = Math.sin(gameClock * 1.8) * 0.035;
  const targetBattery = manualBattery === null ? nearestBattery(currentAim.x) : manualBattery;
  autoBattery = targetBattery;
  aimLabel.style.left = `${Math.min(window.innerWidth - 190, Math.max(92, event.clientX + 24))}px`;
  aimLabel.style.top = `${Math.min(window.innerHeight - 65, Math.max(90, event.clientY - 38))}px`;
  aimLabel.classList.add('visible');
  $('#aim-battery-name').textContent = `BATTERY 0${targetBattery + 1}`;
  updateLauncherHighlight();
}

function onPointerDown(event) {
  if (event.button !== 0 || mode !== 'playing' || paused || renderer.xr.isPresenting) return;
  event.preventDefault();
  if (!aimVisible) onPointerMove(event);
  if (!aimVisible) return;
  sound.unlock();
  fireInterceptor(currentAim.clone());
}

function findThreatAlongRay(ray) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const missile of enemyMissiles) {
    const along = ray.direction.dot(tempVector.copy(missile.position).sub(ray.origin));
    if (along < 0) continue;
    const point = ray.origin.clone().addScaledVector(ray.direction, along);
    const distance = point.distanceTo(missile.position);
    if (distance < 1.05 && along < nearestDistance) {
      const velocity = missile.curve.getTangent(Math.min(0.99, missile.progress)).normalize().multiplyScalar(0.68);
      nearest = missile.position.clone().add(velocity);
      nearestDistance = along;
    }
  }
  return nearest;
}

function normalizeAimPoint(point) {
  point.x = THREE.MathUtils.clamp(point.x, -28, 28);
  point.y = THREE.MathUtils.clamp(point.y, 0.8, 15);
  point.z = THREE.MathUtils.clamp(point.z, -33, 10.5);
  return point;
}

function nearestBattery(x) {
  let best = 0;
  let distance = Infinity;
  launchers.forEach((launcher, index) => {
    const d = Math.abs(launcher.x - x);
    if (d < distance && launcher.ammo > 0) { best = index; distance = d; }
  });
  return best;
}

function controllerFire(controller) {
  controller.updateMatrixWorld(true);
  const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const ray = new THREE.Ray(origin, direction);
  const snapped = findThreatAlongRay(ray);
  if (snapped) {
    currentAim.copy(snapped);
  } else {
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(xrAimPlane, hit)) currentAim.copy(hit);
    else {
      const forwardDistance = Math.max(4, (-14 - origin.z) / (direction.z || -0.001));
      currentAim.copy(origin).addScaledVector(direction, forwardDistance);
    }
  }
  normalizeAimPoint(currentAim);
  aimVisible = true;
  aimMarker.visible = true;
  aimMarker.position.copy(currentAim);
  autoBattery = manualBattery === null ? nearestBattery(currentAim.x) : manualBattery;
  $('#aim-battery-name').textContent = `BATTERY 0${autoBattery + 1}`;
  fireInterceptor(currentAim.clone());
}

function startGame() {
  sound.unlock();
  sound.ui();
  clearTransientObjects();
  cities.forEach(restoreCity);
  launchers.forEach((launcher) => { launcher.ammo = initialAmmo; });
  score = 0;
  wave = 0;
  enemiesSpawned = 0;
  enemiesInWave = 0;
  spawnTimer = 0;
  waveClearTimer = 0;
  gameClock = 0;
  comboCount = 0;
  lastKillTime = -100;
  lastShotTime = -100;
  manualBattery = null;
  autoBattery = 1;
  aimVisible = false;
  aimMarker.visible = false;
  aimLabel.classList.remove('visible');
  mode = 'playing';
  paused = false;
  intro.hidden = true;
  gameUI.hidden = false;
  pauseOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  $('#system-status').textContent = 'SYSTEMS NOMINAL';
  $('#system-status').classList.remove('alerting');
  beginWave(1);
  updateHud(true);
  updateBatteryHud();
  updateLauncherHighlight();
}

function beginWave(nextWave) {
  wave = nextWave;
  enemiesSpawned = 0;
  enemiesInWave = Math.min(5 + wave * 2, 19);
  spawnTimer = 1.55;
  waveClearTimer = 0;
  launchers.forEach((launcher) => {
    launcher.ammo = Math.min(initialAmmo, launcher.ammo + (wave > 1 ? 3 : 0));
  });
  updateHud(true);
  updateBatteryHud();
  showToast(`WAVE ${String(wave).padStart(2, '0')}`, 'HOSTILE SIGNATURES DETECTED', 2700);
  addCombatLog(`WAVE ${String(wave).padStart(2, '0')} // TRACKS ACQUIRED`, 'warning');
  if (wave > 1) {
    score += wave * 150;
    updateHud();
  }
}

function fireInterceptor(target) {
  if (mode !== 'playing' || paused) return;
  const now = performance.now() / 1000;
  if (now - lastShotTime < 0.16) return;
  lastShotTime = now;

  let batteryIndex = manualBattery ?? autoBattery;
  if (!launchers[batteryIndex] || launchers[batteryIndex].ammo <= 0) {
    if (launchers.every((launcher) => launcher.ammo <= 0)) {
      addCombatLog('ALL BATTERIES DEPLETED', 'warning');
      sound.empty();
      return;
    }
    batteryIndex = nearestBattery(target.x);
    if (manualBattery !== null && batteryIndex !== manualBattery) manualBattery = null;
  }
  const launcher = launchers[batteryIndex];
  if (launcher.ammo <= 0) {
    addCombatLog('BATTERY EMPTY — SELECT ANOTHER', 'warning');
    sound.empty();
    return;
  }

  target = normalizeAimPoint(target);
  launcher.ammo -= 1;
  autoBattery = batteryIndex;
  updateBatteryHud();
  updateLauncherHighlight();

  const start = launcher.launchPoint.clone();
  const end = target.clone();
  const midpoint = start.clone().lerp(end, 0.5);
  const distance = start.distanceTo(end);
  midpoint.y = Math.max(start.y, end.y) + 5.3 + Math.min(3.5, distance * 0.065);
  midpoint.x += (end.x - start.x) * 0.055;
  const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
  const flightTime = THREE.MathUtils.clamp(distance / 24, 0.82, 1.65);
  const path = curve.getPoints(45);
  const trail = createTrail(path, 0x5ff5df, 0.54);
  const rocket = createRocket(0x82fff0, 0x36e8d4, 0.09, 0.38);
  rocket.position.copy(start);
  world.add(rocket);
  friendlyMissiles.push({ group: rocket, trail, curve, path, duration: flightTime, elapsed: 0, progress: 0, batteryIndex });
  sound.launch();
}

function spawnEnemy() {
  const livingCities = cities.filter((city) => city.alive);
  if (!livingCities.length) return;
  const targetCity = livingCities[Math.floor(random() * livingCities.length)];
  const startX = THREE.MathUtils.lerp(-24, 24, random());
  const startZ = THREE.MathUtils.lerp(-29, -10, random());
  const start = new THREE.Vector3(startX, 15.5 + random() * 7.5, startZ);
  const end = new THREE.Vector3(targetCity.x + (random() - 0.5) * 0.6, 0.4, targetCity.z);
  const control = start.clone().lerp(end, 0.51);
  control.y = 8.4 + random() * 4;
  control.x += (random() - 0.5) * 5;
  control.z += (random() - 0.5) * 4;
  const curve = new THREE.QuadraticBezierCurve3(start, control, end);
  const distance = curve.getLength();
  const duration = THREE.MathUtils.clamp(13.5 - wave * 0.45 + random() * 3.5, 7.2, 16.5);
  const path = curve.getPoints(56);
  const trail = createTrail(path, 0xff554f, 0.48);
  const rocket = createRocket(0xff8a70, 0xff493e, 0.105, 0.45);
  rocket.position.copy(start);
  world.add(rocket);
  const missile = { group: rocket, trail, curve, path, duration, elapsed: 0, progress: 0, position: start.clone(), targetCity, distance };
  enemyMissiles.push(missile);
  sound.lock();
  updateHud();
  if (enemyMissiles.length === 1) addCombatLog('HOSTILE TRACKS ENTERING THEATER', 'warning');
}

function createTrail(points, color, opacity) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setDrawRange(0, 1);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 4;
  world.add(line);
  return line;
}

function createRocket(coreColor, trailColor, radius, length) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length, 8),
    new THREE.MeshBasicMaterial({ color: coreColor, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  shell.position.y = length * 0.12;
  group.add(shell);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.84, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  group.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: trailColor, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.scale.set(radius * 12, radius * 12, 1);
  group.add(glow);
  const light = new THREE.PointLight(trailColor, 3.2, 6, 2);
  group.add(light);
  return group;
}

function createExplosion(position, color, maxRadius, canIntercept) {
  const group = new THREE.Group();
  group.position.copy(position);
  world.add(group);

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.17, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  group.add(shell);
  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshBasicMaterial({ color: color === 0x51f5df ? 0xc7fff8 : 0xffbb83, wireframe: true, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  group.add(wire);
  const ringA = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.018, 6, 52),
    new THREE.MeshBasicMaterial({ color: 0xf0fff8, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  ringA.rotation.x = Math.PI / 2;
  group.add(ringA);
  const ringB = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.014, 5, 52),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  ringB.rotation.set(Math.PI / 2.8, 0.3, 0.2);
  group.add(ringB);

  const sparkCount = 54;
  const sparkPositions = new Float32Array(sparkCount * 3);
  const directions = [];
  for (let i = 0; i < sparkCount; i++) {
    const vector = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
    directions.push({ vector, speed: 0.65 + random() * 0.85 });
  }
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparks = new THREE.Points(
    sparkGeometry,
    new THREE.PointsMaterial({ map: glowTexture, color: color === 0x51f5df ? 0xaafff5 : 0xffcc91, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.96, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  group.add(sparks);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: color === 0x51f5df ? 0x99fff5 : 0xff975f, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  coreGlow.scale.set(2.2, 2.2, 1);
  group.add(coreGlow);
  const light = new THREE.PointLight(color, 4.5, maxRadius * 3.2, 2);
  group.add(light);

  const explosion = { group, shell, wire, ringA, ringB, sparks, sparkGeometry, directions, coreGlow, light, color, maxRadius, canIntercept, elapsed: 0, duration: 1.28, radius: 0, hitSet: new Set() };
  explosions.push(explosion);
  sound.explode(canIntercept ? 1 : 0.65);
}

function updateFriendlyMissiles(dt) {
  for (let i = friendlyMissiles.length - 1; i >= 0; i--) {
    const missile = friendlyMissiles[i];
    missile.elapsed += dt;
    const t = Math.min(1, missile.elapsed / missile.duration);
    missile.progress = t;
    const position = missile.curve.getPoint(t);
    const tangent = missile.curve.getTangent(Math.max(0.001, Math.min(0.999, t))).normalize();
    missile.group.position.copy(position);
    missile.group.quaternion.setFromUnitVectors(upAxis, tangent);
    missile.trail.geometry.setDrawRange(0, Math.max(1, Math.floor(t * (missile.path.length - 1)) + 1));
    if (t >= 1) {
      createExplosion(position, 0x51f5df, 5.7 + Math.min(2, wave * 0.12), true);
      removeTransient(missile);
      friendlyMissiles.splice(i, 1);
    }
  }
}

function updateEnemyMissiles(dt) {
  for (let i = enemyMissiles.length - 1; i >= 0; i--) {
    const missile = enemyMissiles[i];
    missile.elapsed += dt;
    const t = Math.min(1, missile.elapsed / missile.duration);
    missile.progress = t;
    const position = missile.curve.getPoint(t);
    missile.position.copy(position);
    const tangent = missile.curve.getTangent(Math.max(0.001, Math.min(0.999, t))).normalize();
    missile.group.position.copy(position);
    missile.group.quaternion.setFromUnitVectors(upAxis, tangent);
    missile.trail.geometry.setDrawRange(0, Math.max(1, Math.floor(t * (missile.path.length - 1)) + 1));
    if (t >= 1) {
      const targetCity = missile.targetCity.alive ? missile.targetCity : cities.find((city) => city.alive);
      createExplosion(position, 0xff693f, 2.9, false);
      if (targetCity) destroyCity(targetCity);
      removeTransient(missile);
      enemyMissiles.splice(i, 1);
    }
  }
}

function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const blast = explosions[i];
    blast.elapsed += dt;
    const progress = Math.min(1, blast.elapsed / blast.duration);
    const grow = Math.min(1, progress / 0.28);
    const shrink = progress < 0.43 ? 1 : Math.max(0, 1 - (progress - 0.43) / 0.57);
    const radius = blast.maxRadius * grow * shrink;
    blast.radius = radius;
    const fade = Math.max(0, 1 - progress);
    blast.shell.scale.setScalar(radius);
    blast.shell.material.opacity = 0.14 * fade;
    blast.wire.scale.setScalar(radius * 0.97);
    blast.wire.rotation.set(progress * 0.7, progress * 0.8, progress * 0.25);
    blast.wire.material.opacity = 0.75 * fade;
    blast.ringA.scale.set(radius * (0.86 + Math.sin(progress * Math.PI * 5) * 0.04), radius * (0.86 + Math.sin(progress * Math.PI * 5) * 0.04), radius * (0.86 + Math.sin(progress * Math.PI * 5) * 0.04));
    blast.ringB.scale.setScalar(radius * 0.68);
    blast.ringA.rotation.z += dt * 0.8;
    blast.ringB.rotation.y += dt * 0.6;
    blast.ringA.material.opacity = 0.82 * fade;
    blast.ringB.material.opacity = 0.66 * fade;
    blast.coreGlow.scale.set(radius * 2.2 + 0.4, radius * 2.2 + 0.4, 1);
    blast.coreGlow.material.opacity = fade * (1 - progress * 0.35);
    blast.light.intensity = 5 * fade;
    blast.light.distance = blast.maxRadius * 3 * Math.max(0.25, fade);

    const attributes = blast.sparkGeometry.getAttribute('position');
    for (let p = 0; p < blast.directions.length; p++) {
      const seed = blast.directions[p];
      const sparkDistance = radius * seed.speed;
      attributes.setXYZ(p, seed.vector.x * sparkDistance, seed.vector.y * sparkDistance, seed.vector.z * sparkDistance);
    }
    attributes.needsUpdate = true;
    blast.sparks.material.opacity = fade;

    if (blast.canIntercept && progress > 0.07 && radius > 0.1) {
      for (let e = enemyMissiles.length - 1; e >= 0; e--) {
        const missile = enemyMissiles[e];
        if (blast.hitSet.has(missile)) continue;
        if (missile.position.distanceTo(blast.group.position) <= radius + 0.5) {
          blast.hitSet.add(missile);
          destroyEnemyMissile(e, missile);
        }
      }
    }

    if (progress >= 1) {
      removeExplosion(blast);
      explosions.splice(i, 1);
    }
  }
}

function destroyEnemyMissile(index, missile) {
  const position = missile.position.clone();
  createExplosion(position, 0x84f7e4, 1.7, false);
  removeTransient(missile);
  enemyMissiles.splice(index, 1);
  const now = gameClock;
  comboCount = now - lastKillTime < 4.8 ? comboCount + 1 : 1;
  lastKillTime = now;
  const award = 100 + (wave - 1) * 25 + (comboCount > 1 ? comboCount * 35 : 0);
  score += award;
  sound.confirm();
  updateHud();
  addCombatLog(`INTERCEPT CONFIRMED  +${String(award).padStart(3, '0')}`, 'good');
}

function destroyCity(city) {
  if (!city.alive) return;
  city.alive = false;
  city.buildingsGroup.visible = false;
  city.burnGroup.visible = true;
  city.shield.material.color.setHex(0xff6257);
  city.shield.material.opacity = 0.58;
  city.innerRing.material.color.setHex(0xb9443f);
  city.innerRing.material.opacity = 0.18;
  city.cityLight.color.setHex(0xff563f);
  city.cityLight.intensity = 1.6;
  sound.cityHit();
  renderCityPips();
  updateHud(true);
  addCombatLog(`${city.name} LOST // SHIELD COLLAPSE`, 'warning');
  if (cities.every((item) => !item.alive)) endGame();
}

function restoreCity(city) {
  city.alive = true;
  city.buildingsGroup.visible = true;
  city.burnGroup.visible = false;
  city.shield.material.color.setHex(0x51e5d2);
  city.shield.material.opacity = 0.7;
  city.innerRing.material.color.setHex(0x3f9f9d);
  city.innerRing.material.opacity = 0.35;
  city.cityLight.color.setHex(0x48ded2);
  city.cityLight.intensity = 1.15;
}

function renderCityPips() {
  cityPips.innerHTML = '';
  cities.forEach((city) => {
    const pip = document.createElement('span');
    pip.title = `${city.name}: ${city.alive ? 'secure' : 'lost'}`;
    if (!city.alive) pip.classList.add('lost');
    cityPips.appendChild(pip);
  });
  const alive = cities.filter((city) => city.alive).length;
  $('#cities-total').textContent = `${String(alive).padStart(2, '0')} / 06`;
}

function updateBatteryHud() {
  launcherCards.forEach((card, index) => {
    const launcher = launchers[index];
    const count = Math.max(0, launcher?.ammo ?? 0);
    card.querySelector('.ammo-count').textContent = String(count).padStart(2, '0');
    card.querySelector('.ammo-bar i').style.width = `${(count / initialAmmo) * 100}%`;
    card.classList.toggle('empty', count === 0);
    card.querySelector('.battery-state').textContent = count === 0 ? 'DEPLETED' : count <= 2 ? 'LOW AMMO' : 'READY';
    launcher?.pods.forEach((pod, podIndex) => {
      const loaded = podIndex < count;
      pod.visible = loaded;
      pod.material.emissiveIntensity = loaded ? 0.75 : 0;
    });
  });
}

function updateLauncherHighlight() {
  const selected = manualBattery ?? autoBattery;
  launchers.forEach((launcher, index) => {
    const active = index === selected;
    launcher.selectionRing.material.opacity = active ? 0.5 : 0.035;
    launcher.centerLight.intensity = active ? 1.55 : 0.55;
    launcherCards[index]?.classList.toggle('selected', active);
  });
}

function updateHud(force = false) {
  if (!force && hudTimer < 0.18) return;
  hudTimer = 0;
  $('#wave-number').textContent = String(wave || 1).padStart(2, '0');
  $('#score-value').textContent = String(score).padStart(6, '0');
  $('#threat-count').textContent = String(enemyMissiles.length).padStart(2, '0');
  const intelPanel = $('.intel-panel');
  intelPanel.classList.toggle('has-threats', enemyMissiles.length > 0);
  $('#threat-status').textContent = enemyMissiles.length > 0 ? 'HOSTILES INBOUND' : 'SECTOR CLEAR';
  $('#wave-state').textContent = enemiesSpawned < enemiesInWave ? 'TRACKING INBOUND' : enemyMissiles.length ? 'ENGAGEMENT ACTIVE' : 'SECTOR SECURED';
  $('#combo-value').textContent = comboCount > 1 ? `CHAIN x${String(comboCount).padStart(2, '0')}` : 'NO CHAIN';
  const systemStatus = $('#system-status');
  const active = enemyMissiles.length > 0;
  systemStatus.textContent = active ? 'HOSTILE SIGNATURES DETECTED' : 'SYSTEMS NOMINAL';
  systemStatus.classList.toggle('alerting', active);
  $('.top-status').classList.toggle('alerting', active);
  renderCityPips();
}

function updateGame(dt) {
  if (mode !== 'playing' || paused) return;
  gameClock += dt;
  hudTimer += dt;
  spawnTimer -= dt;
  if (enemiesSpawned < enemiesInWave && spawnTimer <= 0) {
    spawnEnemy();
    enemiesSpawned += 1;
    spawnTimer = Math.max(0.62, 1.95 - wave * 0.075) + random() * 0.5;
  }

  updateFriendlyMissiles(dt);
  updateEnemyMissiles(dt);
  updateExplosions(dt);
  updateHud();

  if (enemiesSpawned >= enemiesInWave && enemyMissiles.length === 0 && friendlyMissiles.length === 0 && explosions.every((blast) => blast.elapsed > 0.4)) {
    waveClearTimer += dt;
    if (waveClearTimer > 3.3) {
      score += 250 * wave;
      beginWave(wave + 1);
    }
  } else {
    waveClearTimer = 0;
  }
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (terrainMaterial) terrainMaterial.uniforms.uTime.value += dt;
  if (stars) stars.rotation.y += dt * 0.0018;
  updateGame(dt);
  updateSceneEffects(dt);
  updateToast(dt);
  for (const { controller, laser } of xrControllerLines) {
    const active = renderer.xr.isPresenting;
    laser.visible = active && mode === 'playing' && !paused;
  }
  renderer.render(scene, camera);
}

function updateSceneEffects(dt) {
  for (const effect of sceneEffects) {
    if (effect.type === 'beacon') {
      const pulse = 0.62 + Math.sin(gameClock * 2.2 + effect.phase) * 0.18;
      effect.lamp.material.opacity = pulse;
      effect.object.rotation.y += dt * 0.09;
    }
  }
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    if (!city.alive) {
      city.burnGroup.children[0].scale.y = 1.55 + Math.sin(gameClock * 4 + i) * 0.25;
      city.burnGroup.children[1].material.opacity = 0.65 + Math.sin(gameClock * 3 + i) * 0.2;
    } else {
      city.shield.material.opacity = 0.55 + Math.sin(gameClock * 1.35 + i) * 0.11;
    }
  }
  launchers.forEach((launcher, index) => {
    launcher.padRing.rotation.z += dt * (index % 2 ? -0.12 : 0.12);
    const active = index === (manualBattery ?? autoBattery);
    launcher.selectionRing.rotation.z += dt * (active ? 0.3 : 0.04);
  });
}

function updateToast(dt) {
  if (toastTimer <= 0) return;
  toastTimer -= dt;
  if (toastTimer <= 0) toast.classList.remove('show');
}

function showToast(title, copy, duration = 2200) {
  $('#toast-title').textContent = title;
  $('#toast-copy').textContent = copy;
  toast.classList.add('show');
  toastTimer = duration / 1000;
}

function addCombatLog(text, tone = '') {
  let feed = $('#combat-feed');
  if (!feed) {
    feed = document.createElement('div');
    feed.id = 'combat-feed';
    feed.className = 'combat-feed';
    gameUI.appendChild(feed);
  }
  const line = document.createElement('div');
  line.className = `combat-log ${tone}`;
  const time = `${String(Math.floor(gameClock / 60)).padStart(2, '0')}:${String(Math.floor(gameClock % 60)).padStart(2, '0')}`;
  line.innerHTML = `<span>${time}</span><strong>${escapeHtml(text)}</strong>`;
  feed.prepend(line);
  while (feed.children.length > 3) feed.lastElementChild.remove();
  window.setTimeout(() => line.classList.add('fade'), 7200);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setPaused(value) {
  if (mode !== 'playing') return;
  paused = value;
  pauseOverlay.hidden = !paused;
  if (paused) {
    aimMarker.visible = false;
    aimLabel.classList.remove('visible');
    sound.ui();
  } else {
    sound.ui();
  }
}

function endGame() {
  mode = 'gameover';
  paused = false;
  gameUI.hidden = true;
  pauseOverlay.hidden = true;
  $('#final-score').textContent = String(score).padStart(6, '0');
  $('#final-wave').textContent = String(wave).padStart(2, '0');
  gameoverOverlay.hidden = false;
  $('#system-status').textContent = 'NETWORK OFFLINE';
  $('#system-status').classList.add('alerting');
}

function clearTransientObjects() {
  for (const missile of [...friendlyMissiles, ...enemyMissiles]) removeTransient(missile);
  friendlyMissiles.length = 0;
  enemyMissiles.length = 0;
  for (const blast of [...explosions]) removeExplosion(blast);
  explosions.length = 0;
  const feed = $('#combat-feed');
  if (feed) feed.innerHTML = '';
  renderCityPips();
}

function removeTransient(object) {
  if (object.trail) {
    world.remove(object.trail);
    object.trail.geometry.dispose();
    object.trail.material.dispose();
  }
  if (object.group) {
    world.remove(object.group);
    disposeTree(object.group);
  }
}

function removeExplosion(blast) {
  world.remove(blast.group);
  disposeTree(blast.group);
}

function disposeTree(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  if (key === 'enter' && mode === 'menu') { startGame(); return; }
  if ((key === 'p' || key === 'escape') && mode === 'playing') { setPaused(!paused); return; }
  if (key === 'm') { soundToggle.click(); return; }
  if (key === 'f') { toggleFullscreen(); return; }
  if (key === ' ' && mode === 'playing' && !paused) {
    event.preventDefault();
    if (aimVisible) fireInterceptor(currentAim.clone());
    return;
  }
  if (['1', '2', '3'].includes(key) && mode === 'playing') {
    manualBattery = Number(key) - 1;
    autoBattery = manualBattery;
    updateBatteryHud();
    updateLauncherHighlight();
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

function updateClockReadout() {
  const now = new Date();
  const parts = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].map((value) => String(value).padStart(2, '0'));
  $('#clock-readout').textContent = `${parts.join(':')} UTC`;
  window.setTimeout(updateClockReadout, 1000);
}

class SoundFX {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
  }
  unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.28;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  setMuted(value) {
    this.muted = value;
    if (this.context && this.master) this.master.gain.setTargetAtTime(value ? 0 : 0.28, this.context.currentTime, 0.04);
  }
  tone({ frequency = 440, endFrequency = frequency, duration = 0.2, type = 'sine', volume = 0.3, delay = 0, filter = 7000 }) {
    this.unlock();
    if (!this.context || this.muted) return;
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(filter, now);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + Math.min(0.025, duration * 0.18));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
  noise({ duration = 0.35, volume = 0.3, filter = 1200, delay = 0 }) {
    this.unlock();
    if (!this.context || this.muted) return;
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(filter, now);
    lowpass.frequency.exponentialRampToValueAtTime(Math.max(80, filter * 0.22), now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }
  ui() {
    this.tone({ frequency: 580, endFrequency: 760, duration: 0.075, type: 'sine', volume: 0.13, filter: 2200 });
  }
  launch() {
    this.tone({ frequency: 155, endFrequency: 620, duration: 0.28, type: 'sawtooth', volume: 0.3, filter: 1500 });
    this.noise({ duration: 0.23, volume: 0.17, filter: 1050 });
  }
  lock() {
    this.tone({ frequency: 940, endFrequency: 450, duration: 0.12, type: 'triangle', volume: 0.09, filter: 1800 });
  }
  explode(strength = 1) {
    this.noise({ duration: 0.38, volume: 0.25 * strength, filter: 690 });
    this.tone({ frequency: 78, endFrequency: 38, duration: 0.42, type: 'sine', volume: 0.34 * strength, filter: 300 });
  }
  confirm() {
    this.tone({ frequency: 650, endFrequency: 1020, duration: 0.11, type: 'sine', volume: 0.16, filter: 2400 });
    this.tone({ frequency: 870, endFrequency: 1280, duration: 0.13, type: 'sine', volume: 0.11, delay: 0.07, filter: 2600 });
  }
  cityHit() {
    this.noise({ duration: 0.7, volume: 0.36, filter: 430 });
    this.tone({ frequency: 100, endFrequency: 31, duration: 0.78, type: 'sine', volume: 0.32, filter: 190 });
  }
  empty() {
    this.tone({ frequency: 175, endFrequency: 88, duration: 0.17, type: 'square', volume: 0.09, filter: 500 });
  }
}

sound = new SoundFX();

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
