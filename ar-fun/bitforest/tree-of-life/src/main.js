// Tree of Life — SLAM WebAR, 8th Wall Engine (open source) + three.js
// Scene: a Tree of Life is placed where the user taps. Gnats orbit the
// canopy; tapping a gnat kills it and increments the score.
//
// Integration pattern verified against the official current example:
// https://github.com/8thwall/threejs-world-effects-example

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
window.THREE = THREE; // XR8's pipeline modules expect a global THREE

const WORLD_SCALE = 4; // bumps tree/gnat sizes up without moving placement distance

const MAX_GNATS = 16;
const GNAT_HIT_RADIUS = 0.14 * WORLD_SCALE; // invisible hit-sphere, bigger than the visible mesh

let scene, camera, renderer;
let treeGroup = null;
let placed = false;
let gnats = [];
let score = 0;
let lastUpdateTime = null;

const scoreUi = document.getElementById('score-ui');
const scoreValue = document.getElementById('score-value');
const placeHint = document.getElementById('place-hint');
const loadingScreen = document.getElementById('loading-screen');
const recenterBtn = document.getElementById('recenter-btn');

function addScore(n) {
  score += n;
  scoreValue.textContent = String(score);
}

// ── Tree geometry ──────────────────────────────────────────────────
// treeGroup sits at a fixed offset from the (recentered) world origin, on
// the ground (y=0 locally). A gray-box cube shows immediately as a
// fallback; the real Quaternius glTF (CC0, assets/tree.glb) swaps in once
// it finishes loading, auto-scaled to TARGET_TREE_HEIGHT regardless of the
// model's native scale. GNAT_ORBIT_CENTER is the shared canopy anchor both
// the fallback cube and gnat flight logic use.
const TREE_SIZE = 0.3 * WORLD_SCALE; // fallback cube edge length, meters
const TARGET_TREE_HEIGHT = 0.6 * WORLD_SCALE; // real model height after auto-scale, meters
const GROUND_POS = new THREE.Vector3(0, 0, -0.6); // true ground (y=0), in front of world origin

// ── Hill mound ───────────────────────────────────────────────────
// No terrain/hill model exists in the nature pack, so the mound the tree
// stands on is procedural: a flattened dome (top hemisphere of a sphere,
// squashed in Y). hillHeightAt(r) gives the mound's surface height at
// horizontal distance r from its center — used to sit the tree, rocks,
// and bushes flush on its sloped surface instead of floating/clipping.
const HILL_RADIUS = 0.35 * WORLD_SCALE;
const HILL_HEIGHT = 0.09 * WORLD_SCALE;

function hillHeightAt(r) {
  const t = Math.max(0, 1 - (r * r) / (HILL_RADIUS * HILL_RADIUS));
  return HILL_HEIGHT * Math.sqrt(t);
}

function buildHill() {
  const dome = new THREE.SphereGeometry(HILL_RADIUS, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, HILL_HEIGHT / HILL_RADIUS, 1);
  const hill = new THREE.Mesh(dome, new THREE.MeshStandardMaterial({ color: 0x3a6b3a }));
  hill.position.copy(GROUND_POS);
  return hill;
}

function loadDecoration(group, path, targetHeight, offsetX, offsetZ, rotationY = 0) {
  new GLTFLoader().load(
    path,
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y || 1;
      model.scale.setScalar(targetHeight / height);

      const scaledBox = new THREE.Box3().setFromObject(model);
      const r = Math.hypot(offsetX, offsetZ);
      model.position.set(
        GROUND_POS.x + offsetX,
        GROUND_POS.y + hillHeightAt(r) - scaledBox.min.y,
        GROUND_POS.z + offsetZ
      );
      model.rotation.y = rotationY;
      group.add(model);
    },
    undefined,
    (err) => console.error(`Decoration failed to load (${path}):`, err)
  );
}

const TREE_LOCAL_POS = GROUND_POS.clone();
TREE_LOCAL_POS.y = hillHeightAt(0); // tree sits at the hill's apex
const GNAT_ORBIT_CENTER = TREE_LOCAL_POS.clone().add(new THREE.Vector3(0, TARGET_TREE_HEIGHT * 0.85, 0));

function buildPlaceholderTree() {
  const group = new THREE.Group();

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(TREE_SIZE, TREE_SIZE, TREE_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2f6e3f })
  );
  cube.position.copy(TREE_LOCAL_POS);
  cube.position.y += TREE_SIZE / 2; // rest on the ground
  cube.userData.isPlaceholderCube = true;
  group.add(cube);

  return group;
}

function loadRealTreeModel(group) {
  new GLTFLoader().load(
    'assets/tree.glb',
    (gltf) => {
      const model = gltf.scene;

      // Auto-scale to TARGET_TREE_HEIGHT regardless of the source model's
      // native scale, then sit it flush on the ground.
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y || 1;
      const scale = TARGET_TREE_HEIGHT / height;
      model.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(model);
      model.position.copy(TREE_LOCAL_POS);
      model.position.y -= scaledBox.min.y;

      group.add(model);

      const cube = group.children.find((c) => c.userData.isPlaceholderCube);
      if (cube) group.remove(cube);
    },
    undefined,
    (err) => console.error('Tree model failed to load, keeping gray-box cube:', err)
  );
}

const GNAT_SIZE = 0.03 * WORLD_SCALE;
const GNAT_WANDER_SPREAD = new THREE.Vector3(0.6, 0.4, 0.6).multiplyScalar(WORLD_SCALE);
const GNAT_BOB_AMPLITUDE = 0.001 * WORLD_SCALE;

function buildGnat() {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(GNAT_SIZE, GNAT_SIZE, GNAT_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x111111 })
  );
  // invisible, larger hit target — easier to tap on mobile than the tiny visible body
  const hitSphere = new THREE.Mesh(
    new THREE.SphereGeometry(GNAT_HIT_RADIUS, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  mesh.add(hitSphere);
  hitSphere.userData.isGnatHitTarget = true;
  mesh.userData.isGnat = true;
  return mesh;
}

function spawnGnats() {
  for (let i = 0; i < MAX_GNATS; i++) {
    const gnat = buildGnat();
    gnat.position.copy(GNAT_ORBIT_CENTER).add(new THREE.Vector3(
      (Math.random() - 0.5) * GNAT_WANDER_SPREAD.x,
      (Math.random() - 0.5) * GNAT_WANDER_SPREAD.y,
      (Math.random() - 0.5) * GNAT_WANDER_SPREAD.z
    ));
    gnat.userData.target = GNAT_ORBIT_CENTER.clone();
    gnat.userData.bobPhase = Math.random() * Math.PI * 2;
    gnat.userData.retargetTimer = 1 + Math.random() * 2;
    scene.add(gnat);
    gnats.push(gnat);
  }
}

function killGnat(gnat) {
  const idx = gnats.indexOf(gnat);
  if (idx === -1) return;
  gnats.splice(idx, 1);
  gnat.parent.remove(gnat);
  addScore(1);
  // TODO: pop/particle fx on kill
}

// ── Gnat flight: sine-wave bob + wander/steer toward random points near canopy ──
function updateGnats(dt, elapsed) {
  for (const gnat of gnats) {
    gnat.userData.retargetTimer -= dt;
    if (gnat.userData.retargetTimer <= 0) {
      gnat.userData.target = GNAT_ORBIT_CENTER.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * GNAT_WANDER_SPREAD.x,
        (Math.random() - 0.5) * GNAT_WANDER_SPREAD.y,
        (Math.random() - 0.5) * GNAT_WANDER_SPREAD.z
      ));
      gnat.userData.retargetTimer = 1 + Math.random() * 2;
    }
    gnat.position.lerp(gnat.userData.target, 1 - Math.pow(0.001, dt));
    gnat.position.y += Math.sin(elapsed * 4 + gnat.userData.bobPhase) * GNAT_BOB_AMPLITUDE;
  }
}

// ── Tap-to-kill ──────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
function tapCoordsToNdc(x, y) {
  return new THREE.Vector2(
    (x / window.innerWidth) * 2 - 1,
    -(y / window.innerHeight) * 2 + 1
  );
}

function onTap(x, y) {
  raycaster.setFromCamera(tapCoordsToNdc(x, y), camera);
  const hits = raycaster.intersectObjects(gnats, true);
  if (hits.length > 0) {
    const hit = hits[0].object;
    // hit may be the invisible hit-sphere child — resolve to the gnat itself
    const gnat = hit.userData.isGnat ? hit : hit.parent;
    killGnat(gnat);
  }
}

// ── Pre-placement scan grid ────────────────────────────────────────
// NOTE: this is a placement *preview*, not real surface/plane detection —
// the open-source engine doesn't document a plane-detection or feature-point
// API as of this writing (its CoachingOverlay module is for a different
// feature, Absolute Scale). The grid just follows the tracked camera and
// sits at the same ground offset the tree will be placed at, so it's an
// honest "roughly here" cue rather than a validity indicator.
const SCAN_GRID_DISTANCE = 0.6; // matches TREE_LOCAL_POS.z
let scanGrid = null;

function buildScanGrid() {
  const grid = new THREE.GridHelper(1.2, 12, 0x6ef, 0x2a5570);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  return grid;
}

function updateScanGrid(elapsed) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();

  scanGrid.position.set(
    camera.position.x + forward.x * SCAN_GRID_DISTANCE,
    0,
    camera.position.z + forward.z * SCAN_GRID_DISTANCE
  );
  scanGrid.material.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(elapsed * 3));
}

// ── Placement ────────────────────────────────────────────────────
// The current open-source engine's documented pattern for "place content
// where the user is" is XR8.XrController.recenter(): it resets the SLAM
// world origin to the device's current position/orientation. The tree
// sits at a fixed offset from that origin (TREE_LOCAL_POS), so recentering
// on the first tap effectively drops it in front of wherever the user
// tapped. (There's no separate plane-detection hit-test call documented
// for the open-source engine as of this writing — if 8th Wall adds one,
// swap it in here for surface-accurate placement.)
function placeTree() {
  if (placed) return;
  XR8.XrController.recenter();

  treeGroup.visible = true;
  scanGrid.visible = false;
  spawnGnats();

  placed = true;
  placeHint.classList.add('hidden');
  scoreUi.classList.remove('hidden');
  recenterBtn.classList.remove('hidden');
}

function onScreenTap(e) {
  const touch = e.touches ? e.touches[0] : e;
  if (!placed) placeTree();
  else onTap(touch.clientX, touch.clientY);
}

// Lets the player reset tracking to their current view mid-session if the
// floor-based SLAM drifts (per 8th Wall's own World Tracking Issues docs),
// without having to reload the page. Content stays at the same fixed
// offsets from the world origin, so it simply re-anchors in front of
// wherever the player is now — same mechanism as the initial placement tap.
recenterBtn.addEventListener('click', () => {
  if (!placed) return;
  XR8.XrController.recenter();
});

// ── 8th Wall pipeline module ─────────────────────────────────────
const treeOfLifePipelineModule = () => ({
  name: 'tree-of-life',

  onStart: ({ canvas }) => {
    const { scene: xrScene, camera: xrCamera, renderer: xrRenderer } = XR8.Threejs.xrScene();
    scene = xrScene;
    camera = xrCamera;
    renderer = xrRenderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(0.5, 1, 0.3);
    scene.add(dirLight);
    // TODO: ground/contact shadows under the tree are the highest-impact
    // realism win per spec notes — add once real geometry lands.

    // Tree exists from the start but stays hidden at a fixed local offset
    // until the user taps to place it (see placeTree()).
    treeGroup = buildPlaceholderTree();
    treeGroup.visible = false;
    scene.add(treeGroup);
    loadRealTreeModel(treeGroup);

    treeGroup.add(buildHill());
    const s = WORLD_SCALE;
    loadDecoration(treeGroup, 'assets/nature/Rock Medium.glb', 0.12 * s, 0.18 * s, 0.12 * s, 0.4);
    loadDecoration(treeGroup, 'assets/nature/Rock Medium-JQxF95498B.glb', 0.1 * s, -0.15 * s, 0.2 * s, 2.1);
    loadDecoration(treeGroup, 'assets/nature/Bush.glb', 0.2 * s, 0.22 * s, -0.15 * s, 1.2);
    loadDecoration(treeGroup, 'assets/nature/Bush with Flowers.glb', 0.22 * s, -0.2 * s, -0.1 * s, 3.0);

    scanGrid = buildScanGrid();
    scene.add(scanGrid);

    camera.position.set(0, 1.4, 0);
    XR8.XrController.updateCameraProjectionMatrix({
      origin: camera.position,
      facing: camera.quaternion,
    });

    loadingScreen.classList.add('hidden');
    placeHint.classList.remove('hidden');

    canvas.addEventListener('touchmove', (e) => e.preventDefault());
    canvas.addEventListener('touchstart', onScreenTap, { passive: true });
    canvas.addEventListener('click', onScreenTap);
  },

  onUpdate: () => {
    const now = performance.now();
    const dt = lastUpdateTime === null ? 0 : Math.min(0.05, (now - lastUpdateTime) / 1000);
    lastUpdateTime = now;

    if (!placed) {
      updateScanGrid(now / 1000);
      return;
    }
    updateGnats(dt, now / 1000);
  },
});

function onxrloaded() {
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),      // Draws the camera feed.
    XR8.Threejs.pipelineModule(),                // Creates a ThreeJS AR Scene.
    XR8.XrController.pipelineModule(),           // Enables SLAM tracking.
    LandingPage.pipelineModule(),                // Detects unsupported browsers and gives hints.
    XRExtras.FullWindowCanvas.pipelineModule(),  // Modifies the canvas to fill the window.
    XRExtras.Loading.pipelineModule(),           // Manages the loading screen on startup.
    XRExtras.RuntimeError.pipelineModule(),      // Shows an error image on runtime error.
    treeOfLifePipelineModule(),                  // Our scene + gnats + placement.
  ]);

  const canvas = document.getElementById('camerafeed');
  XR8.run({ canvas });
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);
