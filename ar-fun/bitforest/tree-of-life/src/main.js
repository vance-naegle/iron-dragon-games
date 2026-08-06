// Tree of Life — SLAM WebAR, 8th Wall Engine (open source) + three.js
// Scene: a Tree of Life is placed where the user taps. Gnats orbit the
// canopy; tapping a gnat kills it and increments the score.
//
// Integration pattern verified against the official current example:
// https://github.com/8thwall/threejs-world-effects-example

import * as THREE from 'three';
window.THREE = THREE; // XR8's pipeline modules expect a global THREE

const MAX_GNATS = 16;
const GNAT_HIT_RADIUS = 0.14; // invisible hit-sphere, bigger than the visible mesh

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

function addScore(n) {
  score += n;
  scoreValue.textContent = String(score);
}

// ── Gray-box placeholder geometry ──────────────────────────────────
// Plain cubes standing in for the real low-poly glTF/.glb tree+fruit and
// gnat models (Draco-compressed, rig-based if animated). Swap
// buildPlaceholderTree/buildGnat for glTF loaders once assets land in
// ../assets/ — GNAT_ORBIT_CENTER is the shared anchor point both use.
const TREE_SIZE = 0.3; // cube edge length, meters
const TREE_LOCAL_POS = new THREE.Vector3(0, TREE_SIZE / 2, -0.6); // in front of world origin
const GNAT_ORBIT_CENTER = TREE_LOCAL_POS.clone().add(new THREE.Vector3(0, TREE_SIZE * 1.3, 0));

function buildPlaceholderTree() {
  const group = new THREE.Group();

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(TREE_SIZE, TREE_SIZE, TREE_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2f6e3f })
  );
  cube.position.copy(TREE_LOCAL_POS);
  group.add(cube);

  return group;
}

function buildGnat() {
  const size = 0.03;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
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
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.6
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
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.6
      ));
      gnat.userData.retargetTimer = 1 + Math.random() * 2;
    }
    gnat.position.lerp(gnat.userData.target, 1 - Math.pow(0.001, dt));
    gnat.position.y += Math.sin(elapsed * 4 + gnat.userData.bobPhase) * 0.001;
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
  spawnGnats();

  placed = true;
  placeHint.classList.add('hidden');
  scoreUi.classList.remove('hidden');
}

function onScreenTap(e) {
  const touch = e.touches ? e.touches[0] : e;
  if (!placed) placeTree();
  else onTap(touch.clientX, touch.clientY);
}

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
    if (!placed) return;
    const now = performance.now();
    const dt = lastUpdateTime === null ? 0 : Math.min(0.05, (now - lastUpdateTime) / 1000);
    lastUpdateTime = now;
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
