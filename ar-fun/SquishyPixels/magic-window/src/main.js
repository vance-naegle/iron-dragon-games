// Magic Window — Image Target WebAR, 8th Wall Engine (open source) + three.js
// A marker/poster image acts as a window into a small box room, visible
// only within that poster's own rectangular bounds — nothing spills past
// its edges no matter the viewing angle or distance. A picture-frame
// border sits right at that boundary, so the poster reads as a framed
// photo of a real 3D space rather than a flat image.
//
// Image Target tracking pattern (XR8.XrController.configure({imageTargetData})
// + processCpuResult.reality.detectedImages) confirmed working via
// ../../bitforest/marker-tree-of-life/src/main.js.
//
// The "only visible through the window" effect uses THREE.js clipping
// planes (renderer.localClippingEnabled + material.clippingPlanes) rather
// than Doorway Jungle's hider-material box-with-a-hole. That technique
// exists to hide a room from every angle as you walk around AND through a
// physical doorway; a wall poster is only ever viewed from its front
// hemisphere, so flat clipping planes matching the poster's rectangle are
// simpler and need no extra occluder geometry.

import * as THREE from 'three';
window.THREE = THREE; // XR8's pipeline modules expect a global THREE

// Structured as a list (rather than one hardcoded target) so a second
// marker can come back easily later — a Glimmer logo marker was tried and
// removed here after it tracked poorly on-device; the mandala marker below
// tracked well. halfWidth/halfHeight are filled in from each target's own
// JSON at load time (see loadTargets()), since different posters can have
// different crop aspect ratios.
const TARGETS = [
  { name: 'magic-window', jsonPath: 'image-targets/magic-window.json' },
];
const targetDimensions = {}; // name -> { halfWidth, halfHeight }, populated in loadTargets()

let scene, camera, renderer;
let anchorGroup = null; // repositioned each frame to whichever marker is detected
let found = false;
let foundName = null; // which marker is currently driving anchorGroup — reset smoothing on change

const markerHint = document.getElementById('marker-hint');
const loadingScreen = document.getElementById('loading-screen');
const loadingMsg = document.getElementById('loading-msg');

// ── Pose smoothing ───────────────────────────────────────────────────
// Raw per-frame detection position/rotation is noisy (inherent to
// single-camera 6DoF pose estimation from a flat image) — on-device
// testing showed this as the placed content visibly "skating" around the
// marker rather than sitting still on it. Exponentially smoothing toward
// each new reading, instead of snapping straight to it, damps that out.
// Reset (skip smoothing for one frame) whenever tracking was just
// reacquired or switched to a different marker, so it doesn't visibly
// glide across the gap between two unrelated poses.
const POSE_SMOOTHING = 0.25; // lower = smoother/more lag, higher = snappier/more jitter
const smoothedPos = new THREE.Vector3();
const smoothedQuat = new THREE.Quaternion();
let hasSmoothedPose = false;

// ── Clipping planes ──────────────────────────────────────────────────
// Defined per-frame in the CURRENT marker's own local frame: a flat
// rectangle centered on the tracked image, lying in its XY plane, plus a
// fifth plane just past local z=0 so nothing pokes out toward the viewer
// past the poster's own surface (there's no real-world depth occlusion
// here — without this, geometry that crept past z=0 would render as if
// floating in front of the actual poster instead of behind it).
//
// THREE.Material.clippingPlanes are always WORLD-space — they don't
// automatically follow a moving/rotating object — so these get
// re-transformed into worldClipPlanes every frame via
// anchorGroup.matrixWorld once the marker's tracked pose is known.
const worldClipPlanes = [0, 1, 2, 3, 4].map(() => new THREE.Plane());

function updateClipPlanes(halfWidth, halfHeight) {
  const local = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), halfWidth),   // left edge
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), halfWidth),  // right edge
    new THREE.Plane(new THREE.Vector3(0, 1, 0), halfHeight),  // bottom edge
    new THREE.Plane(new THREE.Vector3(0, -1, 0), halfHeight), // top edge
    new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.02),       // keep local z <= ~0.02: don't poke toward the viewer
  ];
  for (let i = 0; i < local.length; i++) {
    worldClipPlanes[i].copy(local[i]).applyMatrix4(anchorGroup.matrixWorld);
  }
}

// Applied to every material inside the window scene.
function applyWindowClipping(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of materials) mat.clippingPlanes = worldClipPlanes;
  });
}

// ── Tree ─────────────────────────────────────────────────────────
// Simplified to two shapes (stump, foliage) with an unambiguous up/down —
// confirmed correctly oriented on-device with no tilt needed (see the
// AXIS CONVENTION note on buildRoom() below, which applies here too).
// treeHeight is driven by the actual room height (see buildRoom()) rather
// than a hardcoded guess, so it can never poke through a ceiling sized
// for a different marker.
function buildTree(treeHeight) {
  const group = new THREE.Group();
  const stumpHeight = treeHeight * 0.35;
  const stump = new THREE.Mesh(
    new THREE.CylinderGeometry(treeHeight * 0.05, treeHeight * 0.07, stumpHeight, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.85 }) // brown
  );
  stump.position.y = stumpHeight / 2;
  group.add(stump);

  const foliageHeight = treeHeight - stumpHeight;
  const foliage = new THREE.Mesh(
    new THREE.ConeGeometry(treeHeight * 0.3, foliageHeight, 8), // low segment count — "simplified cone" per feedback
    new THREE.MeshStandardMaterial({ color: 0x7cc576, roughness: 0.8 }) // lighter green than the floor
  );
  foliage.position.y = stumpHeight + foliageHeight / 2;
  group.add(foliage);

  return group;
}

// ── Room ─────────────────────────────────────────────────────────────
// Floor, ceiling, back wall, and two side walls — deliberately NO front
// wall, since that's the opening the poster itself is standing in for.
// Doorway Jungle needs real occlusion geometry for this because you can
// walk around and through it; here the clipping planes (declared above)
// already guarantee nothing outside the poster's rectangle is visible
// from any angle in front of it, so there's nothing for a front wall to
// even do.
//
// AXIS CONVENTION — confirmed correct on-device (tree stood upright, no
// jumbling): built Y-up with depth receding into local -Z, no tilt/
// rotation applied, unlike marker-tree-of-life's CONTENT_TILT. That marker
// was designed to lie FLAT on a table, so its "up" needed correcting to
// point away from the surface; this one is a poster mounted upright on a
// wall, where local Y already reads as real "up" — the same relationship
// Doorway Jungle's room has to its doorway.
//
// Width/height are derived from the marker's own clip halfWidth/halfHeight
// (not independent fixed constants) — a room bigger than the clip window
// was the previous bug: walls sitting outside the clip bounds get
// discarded entirely (not just cropped), which read as "transparent"
// walls and a missing ceiling, and a floor left at y=0 (the marker's
// vertical CENTER) rather than at -halfHeight (its bottom) put half the
// window's height above an empty gap instead of showing the room.
const ROOM_MARGIN = 0.94; // stay just inside the clip boundary — sitting exactly on it risks z-fighting/flicker against the clip plane itself
const ROOM_DEPTH = 1.3;
const ROOM_FRONT_Z = -0.05; // just behind the poster plane

function buildRoom(halfWidth, halfHeight) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95 }); // grey
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2f6e3f, roughness: 0.9 }); // green

  const roomWidth = halfWidth * 2 * ROOM_MARGIN;
  const roomHeight = halfHeight * 2 * ROOM_MARGIN;
  const floorY = -halfHeight * ROOM_MARGIN; // the window's bottom edge, not the marker's vertical center
  const ceilingY = halfHeight * ROOM_MARGIN; // the window's top edge
  const roomBackZ = ROOM_FRONT_Z - ROOM_DEPTH;
  const roomCenterZ = (ROOM_FRONT_Z + roomBackZ) / 2;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, ROOM_DEPTH), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY, roomCenterZ);
  group.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, ROOM_DEPTH), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, ceilingY, roomCenterZ);
  group.add(ceiling);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomHeight), wallMat);
  backWall.position.set(0, 0, roomBackZ); // vertically centered on y=0 by symmetry — floorY/ceilingY are already equal and opposite
  group.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, roomHeight), wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-roomWidth / 2, 0, roomCenterZ);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, roomHeight), wallMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(roomWidth / 2, 0, roomCenterZ);
  group.add(rightWall);

  const roomLight = new THREE.PointLight(0xfff2d8, 1.2, ROOM_DEPTH * 2.5, 2);
  roomLight.position.set(0, ceilingY - 0.1, roomCenterZ);
  group.add(roomLight);

  const tree = buildTree(roomHeight * 0.85); // fills most of the room's height without touching the ceiling
  tree.position.set(0, floorY, roomCenterZ);
  group.add(tree);

  applyWindowClipping(group); // room + tree + light's position, NOT the frame — see buildFrame()
  return group;
}

// ── Frame ────────────────────────────────────────────────────────────
// A picture-frame border sized exactly to the marker's own clip rectangle
// (same halfWidth/halfHeight the clip planes use), so its inner edge
// lines up perfectly with where the room content gets cut off. Sits
// straddling local z=0 (the poster's own surface) so it reads as
// physically mounted on the wall, protruding slightly toward the viewer
// like a real frame would. Deliberately NOT clipped — it's what marks the
// boundary, not something the boundary should hide.
const FRAME_THICKNESS = 0.06;
const FRAME_DEPTH = 0.05;

function buildFrame(halfWidth, halfHeight) {
  const outerW = halfWidth + FRAME_THICKNESS;
  const outerH = halfHeight + FRAME_THICKNESS;

  const shape = new THREE.Shape();
  shape.moveTo(-outerW, -outerH);
  shape.lineTo(outerW, -outerH);
  shape.lineTo(outerW, outerH);
  shape.lineTo(-outerW, outerH);
  shape.lineTo(-outerW, -outerH);

  const hole = new THREE.Path();
  hole.moveTo(-halfWidth, -halfHeight);
  hole.lineTo(halfWidth, -halfHeight);
  hole.lineTo(halfWidth, halfHeight);
  hole.lineTo(-halfWidth, halfHeight);
  hole.lineTo(-halfWidth, -halfHeight);
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: FRAME_DEPTH, bevelEnabled: false });
  const material = new THREE.MeshStandardMaterial({ color: 0x4a2d1c, roughness: 0.7 }); // wood brown
  const frame = new THREE.Mesh(geometry, material);
  frame.position.z = -FRAME_DEPTH / 2; // straddles z=0 evenly
  return frame;
}

// ── Image target tracking ─────────────────────────────────────────
// Polled via processCpuResult.reality.detectedImages each onUpdate, same
// pattern as ../../bitforest/marker-tree-of-life. If both markers are
// somehow in view at once, the first entry wins — there's no need to
// merge or pick a "better" one for this experience.
function updateFromDetectedImages(detectedImages) {
  const detection = detectedImages && detectedImages[0];

  if (detection) {
    const dims = targetDimensions[detection.name] || targetDimensions[TARGETS[0].name];

    if (!found || foundName !== detection.name) hasSmoothedPose = false; // don't glide between two different markers' poses
    foundName = detection.name;

    const targetPos = new THREE.Vector3(detection.position.x, detection.position.y, detection.position.z);
    const targetQuat = new THREE.Quaternion(
      detection.rotation.x, detection.rotation.y, detection.rotation.z, detection.rotation.w
    );
    if (!hasSmoothedPose) {
      smoothedPos.copy(targetPos);
      smoothedQuat.copy(targetQuat);
      hasSmoothedPose = true;
    } else {
      smoothedPos.lerp(targetPos, POSE_SMOOTHING);
      smoothedQuat.slerp(targetQuat, POSE_SMOOTHING);
    }
    anchorGroup.position.copy(smoothedPos);
    anchorGroup.quaternion.copy(smoothedQuat);
    // Deliberately NOT multiplied by any extra scale factor: this must
    // track the marker's true physical size exactly, since it's what the
    // clip-plane boundary below is sized against. Inflating it would grow
    // the "window" past the poster's real edges — content would spill
    // onto the surrounding wall instead of staying inside the print.
    // "Does content look big enough" is controlled separately, by how
    // large the tree/scene geometry is built in marker-local units (see
    // buildTestTree()) — not by scaling the anchor.
    if (typeof detection.scale === 'number') anchorGroup.scale.setScalar(detection.scale);
    anchorGroup.updateMatrixWorld(true); // force-refresh before reading it below — not automatic until the renderer's own traversal
    updateClipPlanes(dims.halfWidth, dims.halfHeight);

    if (!found) {
      found = true;
      anchorGroup.visible = true;
      markerHint.classList.add('hidden');
    }
  } else if (found) {
    found = false;
    foundName = null;
    hasSmoothedPose = false;
    anchorGroup.visible = false;
    markerHint.classList.remove('hidden');
  }
}

// ── 8th Wall pipeline module ─────────────────────────────────────
const magicWindowPipelineModule = () => ({
  name: 'magic-window',

  onStart: ({ canvas }) => {
    const { scene: xrScene, camera: xrCamera, renderer: xrRenderer } = XR8.Threejs.xrScene();
    scene = xrScene;
    camera = xrCamera;
    renderer = xrRenderer;
    renderer.localClippingEnabled = true; // required for material.clippingPlanes to have any effect

    scene.add(new THREE.AmbientLight(0x8ad88a, 0.9));
    const dirLight = new THREE.DirectionalLight(0xdff0c0, 0.7);
    dirLight.position.set(0.5, 1, 0.3);
    scene.add(dirLight);

    anchorGroup = new THREE.Group();
    anchorGroup.visible = false;
    scene.add(anchorGroup);

    const dims = targetDimensions[TARGETS[0].name];
    anchorGroup.add(buildRoom(dims.halfWidth, dims.halfHeight));
    anchorGroup.add(buildFrame(dims.halfWidth, dims.halfHeight));

    loadingScreen.classList.add('hidden');
    markerHint.classList.remove('hidden');
  },

  onUpdate: ({ processCpuResult }) => {
    const detectedImages = processCpuResult.reality && processCpuResult.reality.detectedImages;
    updateFromDetectedImages(detectedImages);
  },
});

// 8th Wall scales an image target's LARGER dimension to 1 (local) unit and
// the smaller dimension proportionally — confirmed via the 8th Wall forum
// ("the bigger of these two will always be 1"), since this isn't spelled
// out in the image-target-cli README itself. Reads each target's own
// `properties.width/height` (pixel dimensions of its processed crop) to
// compute that ratio per-marker, rather than hardcoding one aspect ratio
// for every poster.
async function loadTargets() {
  const imageTargetData = [];
  for (const { name, jsonPath } of TARGETS) {
    const res = await fetch(jsonPath);
    if (!res.ok) throw new Error(`${jsonPath}: ${res.status} ${res.statusText}`);
    const data = await res.json();
    imageTargetData.push(data);

    const { width, height } = data.properties;
    const larger = Math.max(width, height);
    targetDimensions[name] = { halfWidth: (width / larger) / 2, halfHeight: (height / larger) / 2 };
  }
  return imageTargetData;
}

async function onxrloaded() {
  let imageTargetData;
  try {
    imageTargetData = await loadTargets();
  } catch (err) {
    console.error('Could not load one or more image targets:', err);
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
    magicWindowPipelineModule(),
  ]);

  const canvas = document.getElementById('camerafeed');
  XR8.run({ canvas });
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);
