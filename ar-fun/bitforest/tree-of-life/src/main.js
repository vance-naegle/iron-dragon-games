// Tree of Life — SLAM WebAR, 8th Wall + three.js
// Scene: a Tree of Life is placed on a tapped surface. Gnats orbit the
// canopy; tapping a gnat kills it and increments the score.

const MAX_GNATS = 16;
const GNAT_HIT_RADIUS = 0.14; // invisible hit-sphere, bigger than the visible mesh

let scene, camera, renderer;
let treeGroup = null;
let placed = false;
let gnats = [];
let score = 0;

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
const GNAT_ORBIT_CENTER = new THREE.Vector3(0, TREE_SIZE * 1.3, 0);

function buildPlaceholderTree() {
  const group = new THREE.Group();

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(TREE_SIZE, TREE_SIZE, TREE_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2f6e3f })
  );
  cube.position.y = TREE_SIZE / 2;
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

function spawnGnats(anchor) {
  const canopyCenter = GNAT_ORBIT_CENTER;
  for (let i = 0; i < MAX_GNATS; i++) {
    const gnat = buildGnat();
    gnat.position.copy(canopyCenter).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.6
    ));
    gnat.userData.target = canopyCenter.clone();
    gnat.userData.bobPhase = Math.random() * Math.PI * 2;
    gnat.userData.retargetTimer = 1 + Math.random() * 2;
    anchor.add(gnat);
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
  const canopyCenter = GNAT_ORBIT_CENTER;
  for (const gnat of gnats) {
    gnat.userData.retargetTimer -= dt;
    if (gnat.userData.retargetTimer <= 0) {
      gnat.userData.target = canopyCenter.clone().add(new THREE.Vector3(
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
function onTap(x, y) {
  if (!placed) return;
  const coords = new THREE.Vector2(
    (x / window.innerWidth) * 2 - 1,
    -(y / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(coords, camera);
  const hits = raycaster.intersectObjects(gnats, true);
  if (hits.length > 0) {
    let hit = hits[0].object;
    // hit may be the invisible hit-sphere child — resolve to the gnat itself
    const gnat = hit.userData.isGnat ? hit : hit.parent;
    killGnat(gnat);
  }
}

// ── Placement ────────────────────────────────────────────────────
// TODO: verify against current 8th Wall docs — this uses a single-tap
// placement anchored in world space via XR8's SLAM tracking. If 8th Wall's
// SDK exposes an explicit surface hit-test call (XR8.XrController.hitTest
// or similar) at integration time, prefer that over the naive projection
// below for better surface-accurate placement.
function placeTree(x, y) {
  if (placed) return;
  const coords = new THREE.Vector2(
    (x / window.innerWidth) * 2 - 1,
    -(y / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(coords, camera);
  const dir = raycaster.ray.direction.clone();
  const dist = 1.2; // meters in front of camera — placeholder until real hit-test lands
  const point = camera.position.clone().add(dir.multiplyScalar(dist));

  treeGroup = buildPlaceholderTree();
  treeGroup.position.copy(point);
  scene.add(treeGroup);
  spawnGnats(treeGroup);

  placed = true;
  placeHint.classList.add('hidden');
  scoreUi.classList.remove('hidden');
}

function onScreenTap(e) {
  const touch = e.touches ? e.touches[0] : e;
  if (!placed) placeTree(touch.clientX, touch.clientY);
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
    // TODO: swap to XR8's xr-light equivalent for real-time environment
    // matching once wiring against the live SDK — biggest realism win is
    // ground/contact shadows under the tree, per spec notes.

    loadingScreen.classList.add('hidden');
    placeHint.classList.remove('hidden');

    canvas.addEventListener('touchstart', onScreenTap, { passive: true });
    canvas.addEventListener('click', onScreenTap);
  },

  onUpdate: ({ processCpuResult }) => {
    const cameraTransform = processCpuResult.reality?.rotation ? processCpuResult.reality : null;
    if (!cameraTransform) return;
    const dt = Math.min(0.05, (performance.now() - (onUpdate._last || performance.now())) / 1000);
    onUpdate._last = performance.now();
    if (placed) updateGnats(dt, performance.now() / 1000);
  },
});

function onxrloaded() {
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    XRExtras.AlmostThere.pipelineModule(),
    XRExtras.FullWindowCanvas.pipelineModule(),
    XRExtras.Loading.pipelineModule(),
    XRExtras.RuntimeError.pipelineModule(),
    treeOfLifePipelineModule(),
  ]);
}

if (window.XR8) { onxrloaded(); }
else { window.addEventListener('xrloaded', onxrloaded); }
