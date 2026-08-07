// Marker Tree of Life — Image Target WebAR, 8th Wall Engine (open source) + three.js
// Same scene as ../tree-of-life (tree, hill, rocks, bushes, gnats), but
// anchored to a physical marker image instead of a SLAM-placed floor spot.
// Reuses ../tree-of-life/assets/ directly rather than duplicating ~86MB of
// nature-pack models.
//
// Image Target API confirmed via XR8.XrController.configure({imageTargetData})
// and processCpuResult.reality.detectedImages — see 8thwall.org API docs for
// XrController.configure() and the image-target-cli README. There is no
// official three.js Image Targets example project (only A-Frame/Studio have
// one), so the camera-pipeline-module wiring below follows the same verified
// pattern as ../tree-of-life/src/main.js (SLAM), adapted for image tracking.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
window.THREE = THREE; // XR8's pipeline modules expect a global THREE

const TARGET_JSON_PATH = 'image-targets/george.json'; // generated via image-target-cli
const ASSETS_BASE = '../tree-of-life/assets/'; // reuse Tree of Life's assets, no duplication

const WORLD_SCALE = 4; // matches ../tree-of-life for a consistent look

// The tree/hill scene was built "Y-up" (see ../tree-of-life). A PLANAR image
// target's local Y axis runs along the image's own plane, not away from it,
// so without correction the tree grows sideways through the marker instead
// of standing up off it. This rotates just the content (not the tracked
// anchorGroup transform) so local +Y becomes "away from the marker surface".
// -PI/2 came out upside-down (confirmed on-device), so this is +PI/2.
const CONTENT_TILT = Math.PI / 2;

const MAX_GNATS = 16;
const GNAT_HIT_RADIUS = 0.14 * WORLD_SCALE;

let scene, camera, renderer;
let anchorGroup = null; // repositioned each frame to the detected marker's pose
let contentGroup = null; // fixed orientation correction, see CONTENT_TILT below
let treeGroup = null;
let found = false;
let gnats = [];
let score = 0;
let lastUpdateTime = null;

const scoreUi = document.getElementById('score-ui');
const scoreValue = document.getElementById('score-value');
const markerHint = document.getElementById('marker-hint');
const loadingScreen = document.getElementById('loading-screen');
const loadingMsg = document.getElementById('loading-msg');

function addScore(n) {
  score += n;
  scoreValue.textContent = String(score);
}

// ── Tree geometry (identical to ../tree-of-life, but positions are now
// LOCAL to anchorGroup — (0,0,0) is the marker's own position, not an
// arbitrary offset from a SLAM-recentered world origin) ──────────────────
const TREE_SIZE = 0.3 * WORLD_SCALE;
const TARGET_TREE_HEIGHT = 0.6 * WORLD_SCALE;
const GROUND_POS = new THREE.Vector3(0, 0, 0); // the marker's own position

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
TREE_LOCAL_POS.y = hillHeightAt(0);
const GNAT_ORBIT_CENTER = TREE_LOCAL_POS.clone().add(new THREE.Vector3(0, TARGET_TREE_HEIGHT * 0.85, 0));

function buildPlaceholderTree() {
  const group = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(TREE_SIZE, TREE_SIZE, TREE_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2f6e3f })
  );
  cube.position.copy(TREE_LOCAL_POS);
  cube.position.y += TREE_SIZE / 2;
  cube.userData.isPlaceholderCube = true;
  group.add(cube);
  return group;
}

function loadRealTreeModel(group) {
  new GLTFLoader().load(
    `${ASSETS_BASE}tree.glb`,
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y || 1;
      model.scale.setScalar(TARGET_TREE_HEIGHT / height);

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
    contentGroup.add(gnat); // must move with the marker + share the tilt correction
    gnats.push(gnat);
  }
}

function killGnat(gnat) {
  const idx = gnats.indexOf(gnat);
  if (idx === -1) return;
  gnats.splice(idx, 1);
  gnat.parent.remove(gnat);
  addScore(1);
}

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

function onScreenTap(e) {
  if (!found) return;
  const touch = e.touches ? e.touches[0] : e;
  raycaster.setFromCamera(tapCoordsToNdc(touch.clientX, touch.clientY), camera);
  const hits = raycaster.intersectObjects(gnats, true);
  if (hits.length > 0) {
    const hit = hits[0].object;
    const gnat = hit.userData.isGnat ? hit : hit.parent;
    killGnat(gnat);
  }
}

// ── Image target tracking ─────────────────────────────────────────
// Polled via processCpuResult.reality.detectedImages each onUpdate, rather
// than relying on an unverified event-listener registration API — this
// mirrors the documented pattern for enableWorldPoints/enableLighting
// (also delivered via processCpuResult.reality.*). Assumes a single
// configured target; first entry in detectedImages is used directly.
function updateFromDetectedImages(detectedImages, dt, elapsed) {
  const detection = detectedImages && detectedImages[0];

  if (detection) {
    anchorGroup.position.set(detection.position.x, detection.position.y, detection.position.z);
    anchorGroup.quaternion.set(
      detection.rotation.x, detection.rotation.y, detection.rotation.z, detection.rotation.w
    );
    if (typeof detection.scale === 'number') anchorGroup.scale.setScalar(detection.scale);

    if (!found) {
      found = true;
      anchorGroup.visible = true;
      markerHint.classList.add('hidden');
      scoreUi.classList.remove('hidden');
      if (gnats.length === 0) spawnGnats();
    }
    updateGnats(dt, elapsed);
  } else if (found) {
    found = false;
    anchorGroup.visible = false;
    markerHint.classList.remove('hidden');
    scoreUi.classList.add('hidden');
  }
}

// ── 8th Wall pipeline module ─────────────────────────────────────
const markerTreeOfLifePipelineModule = () => ({
  name: 'marker-tree-of-life',

  onStart: ({ canvas }) => {
    const { scene: xrScene, camera: xrCamera, renderer: xrRenderer } = XR8.Threejs.xrScene();
    scene = xrScene;
    camera = xrCamera;
    renderer = xrRenderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(0.5, 1, 0.3);
    scene.add(dirLight);

    anchorGroup = new THREE.Group();
    anchorGroup.visible = false;
    scene.add(anchorGroup);

    contentGroup = new THREE.Group();
    contentGroup.rotation.x = CONTENT_TILT;
    anchorGroup.add(contentGroup);

    treeGroup = buildPlaceholderTree();
    contentGroup.add(treeGroup);
    loadRealTreeModel(treeGroup);

    treeGroup.add(buildHill());
    const s = WORLD_SCALE;
    loadDecoration(treeGroup, `${ASSETS_BASE}nature/Rock Medium.glb`, 0.12 * s, 0.18 * s, 0.12 * s, 0.4);
    loadDecoration(treeGroup, `${ASSETS_BASE}nature/Rock Medium-JQxF95498B.glb`, 0.1 * s, -0.15 * s, 0.2 * s, 2.1);
    loadDecoration(treeGroup, `${ASSETS_BASE}nature/Bush.glb`, 0.2 * s, 0.22 * s, -0.15 * s, 1.2);
    loadDecoration(treeGroup, `${ASSETS_BASE}nature/Bush with Flowers.glb`, 0.22 * s, -0.2 * s, -0.1 * s, 3.0);

    canvas.addEventListener('touchmove', (e) => e.preventDefault());
    canvas.addEventListener('touchstart', onScreenTap, { passive: true });
    canvas.addEventListener('click', onScreenTap);

    loadingScreen.classList.add('hidden');
    markerHint.classList.remove('hidden');
  },

  onUpdate: ({ processCpuResult }) => {
    const now = performance.now();
    const dt = lastUpdateTime === null ? 0 : Math.min(0.05, (now - lastUpdateTime) / 1000);
    lastUpdateTime = now;

    const detectedImages = processCpuResult.reality && processCpuResult.reality.detectedImages;
    updateFromDetectedImages(detectedImages, dt, now / 1000);
  },
});

async function onxrloaded() {
  let imageTargetData;
  try {
    const res = await fetch(TARGET_JSON_PATH);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    imageTargetData = [await res.json()];
  } catch (err) {
    console.error(
      `Could not load ${TARGET_JSON_PATH} — run "npx @8thwall/image-target-cli@latest" ` +
      '(or use 8th Wall Desktop\'s Image Targets panel) against your marker image, ' +
      'then drop the output into ./image-targets/ and update TARGET_JSON_PATH in main.js.',
      err
    );
    loadingMsg.textContent = 'Marker target not configured yet — see console for setup steps.';
    return;
  }

  XR8.XrController.configure({
    imageTargetData,
    disableWorldTracking: true, // pure marker tracking — no floor SLAM needed
  });

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    LandingPage.pipelineModule(),
    XRExtras.FullWindowCanvas.pipelineModule(),
    XRExtras.Loading.pipelineModule(),
    XRExtras.RuntimeError.pipelineModule(),
    markerTreeOfLifePipelineModule(),
  ]);

  const canvas = document.getElementById('camerafeed');
  XR8.run({ canvas });
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);
