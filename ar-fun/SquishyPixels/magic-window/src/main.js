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
// planes (renderer.localClippingEnabled + material.clippingPlanes), but
// NOT fixed axis-aligned bounds — those describe a rectangular TUNNEL
// through space, not a true perspective cone from the viewer's eye
// through the window. At an oblique angle, a sightline can enter that
// tunnel from the side without ever crossing the frame's on-screen
// silhouette, revealing room content that should be hidden. A large
// invisible "hider" occluder (Doorway Jungle's technique) was tried next,
// but a fixed-size panel can only ever approximate a frustum — there's
// always some angle it doesn't cover. The actual fix: recompute the 4
// side clip planes every frame from the camera's CURRENT position through
// each of the window's 4 corners (see updateClipPlanes()) — an exact
// perspective frustum, matching what a real window would show from any
// angle or distance, with no gap by construction.

import * as THREE from 'three';
import { MagicWindowAudio } from './audio.js';
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

// Set once inside buildRoom() when the tree is built, then read every
// frame in onUpdate to animate it — see the "Beat-synced bounce" block
// below updateFromDetectedImages().
let tree = null;
let treeBaseY = 0;
let treeBounceAmplitude = 0;

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
// Four SIDE planes form a true perspective frustum from the camera's
// CURRENT world position through each of the marker's 4 corners (also
// transformed to world space each frame) — not fixed axis-aligned bounds.
// A fifth plane, still a simple local-axis one, keeps content from poking
// out toward the viewer past local z=0 (the poster's own surface) —
// that's an unrelated, non-perspective constraint (there's no real-world
// depth occlusion here — without it, geometry that crept past z=0 would
// render as if floating in front of the actual poster instead of behind
// it), so it doesn't need the frustum treatment.
//
// THREE.Material.clippingPlanes are always WORLD-space — they don't
// automatically follow a moving/rotating object — so all of this is
// recomputed into worldClipPlanes every frame from the marker's current
// tracked pose (and the camera's current position, for the frustum part).
const worldClipPlanes = [0, 1, 2, 3, 4].map(() => new THREE.Plane());
const cornerTL = new THREE.Vector3();
const cornerTR = new THREE.Vector3();
const cornerBL = new THREE.Vector3();
const cornerBR = new THREE.Vector3();
const localZPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.02); // keep local z <= ~0.02

function updateClipPlanes(halfWidth, halfHeight) {
  cornerTL.set(-halfWidth, halfHeight, 0).applyMatrix4(anchorGroup.matrixWorld);
  cornerTR.set(halfWidth, halfHeight, 0).applyMatrix4(anchorGroup.matrixWorld);
  cornerBL.set(-halfWidth, -halfHeight, 0).applyMatrix4(anchorGroup.matrixWorld);
  cornerBR.set(halfWidth, -halfHeight, 0).applyMatrix4(anchorGroup.matrixWorld);
  const eye = camera.position;

  // Point order for setFromCoplanarPoints(a, b, c) matters — it determines
  // which side of the plane is "kept". Verified against a worked numeric
  // example (eye in front of a centered, unrotated window) so the window's
  // interior ends up on the kept side for all four planes, not the
  // exterior — getting this backwards would invert the whole effect.
  worldClipPlanes[0].setFromCoplanarPoints(eye, cornerBL, cornerTL); // left
  worldClipPlanes[1].setFromCoplanarPoints(eye, cornerTR, cornerBR); // right
  worldClipPlanes[2].setFromCoplanarPoints(eye, cornerBR, cornerBL); // bottom
  worldClipPlanes[3].setFromCoplanarPoints(eye, cornerTL, cornerTR); // top
  worldClipPlanes[4].copy(localZPlane).applyMatrix4(anchorGroup.matrixWorld);
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

  // Invisible, generously oversized tap target — same technique as
  // ../../bitforest/marker-tree-of-life's gnat hitSphere. The tree's
  // actual geometry (a thin trunk, a cone) is a small, fiddly target on a
  // phone screen; onScreenTap() raycasts the whole group recursively, so
  // this sphere alone is what makes tapping anywhere near the tree count.
  const hitTarget = new THREE.Mesh(
    new THREE.SphereGeometry(treeHeight * 0.55, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitTarget.position.y = treeHeight * 0.5;
  group.add(hitTarget);

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
// Width/height come in as the room's own opening half-extents — already
// slightly inset from the marker's true edge by ROOM_MARGIN (see
// onStart()) so the walls don't sit exactly on the clip boundary, which
// risked z-fighting/flicker against the clip plane itself. buildFrame()
// below is given that SAME inset value (not the raw marker edge), so the
// frame's material — not an empty gap — is what covers the space between
// the room's edge and the marker's true border.
const ROOM_MARGIN = 0.94 * 1.05; // ~0.987 — 5% bigger per on-device feedback: the room (and, since buildFrame() is given this same value, the frame's hole) sits closer to the marker's true edge, tucking further behind the frame's wood border and shrinking the visible seam between them. Still just under 1.0 to keep some buffer against the clip plane itself.
const ROOM_DEPTH = 1.3;
const ROOM_FRONT_Z = -0.05; // just behind the poster plane

function buildRoom(openingHalfWidth, openingHalfHeight) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95 }); // grey
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2f6e3f, roughness: 0.9 }); // green

  const roomWidth = openingHalfWidth * 2;
  const roomHeight = openingHalfHeight * 2;
  const floorY = -openingHalfHeight; // the window's bottom edge, not the marker's vertical center
  const ceilingY = openingHalfHeight; // the window's top edge
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

  const treeHeight = roomHeight * 0.85; // fills most of the room's height without touching the ceiling
  tree = buildTree(treeHeight); // module-level — onUpdate animates it to the music's beat
  tree.position.set(0, floorY, roomCenterZ);
  group.add(tree);
  treeBaseY = floorY;
  treeBounceAmplitude = treeHeight * 0.08; // ~8% of tree height — a lively but not absurd "boop", leaves ceiling clearance

  applyWindowClipping(group); // room + tree + light's position, NOT the frame — see buildFrame()
  return group;
}

// ── Frame ────────────────────────────────────────────────────────────
// The OUTER edge is sized off the room's own opening (openingHalfWidth/
// openingHalfHeight — the same margined value buildRoom() uses) via
// FRAME_THICKNESS, so it reads as sized to the physical poster and its
// position doesn't shift if the room's size is ever retuned. The INNER
// hole is deliberately smaller than that — by FRAME_HOLE_SHRINK — than the
// room's actual edge, on-device feedback after matching them exactly
// showed a persistent few-pixel seam of camera passthrough right at the
// boundary. Shrinking the hole makes the wood lip physically overlap onto
// the room's near edge, so solid frame material — not a knife-edge
// coincidence of two boundaries — is what covers that seam.
//
// Sits straddling local z=0 (the poster's own surface) so it reads as
// physically mounted on the wall, protruding slightly toward the viewer
// like a real frame would. Deliberately NOT clipped — it's what marks the
// boundary, not something the boundary should hide.
const FRAME_THICKNESS = 0.09;
const FRAME_DEPTH = 0.05;
const FRAME_HOLE_SHRINK = 0.95; // hole is 5% smaller than the room's opening — the overlap that hides the seam

function buildFrame(openingHalfWidth, openingHalfHeight) {
  const outerW = openingHalfWidth + FRAME_THICKNESS;
  const outerH = openingHalfHeight + FRAME_THICKNESS;
  const holeHalfWidth = openingHalfWidth * FRAME_HOLE_SHRINK;
  const holeHalfHeight = openingHalfHeight * FRAME_HOLE_SHRINK;

  const shape = new THREE.Shape();
  shape.moveTo(-outerW, -outerH);
  shape.lineTo(outerW, -outerH);
  shape.lineTo(outerW, outerH);
  shape.lineTo(-outerW, outerH);
  shape.lineTo(-outerW, -outerH);

  const hole = new THREE.Path();
  hole.moveTo(-holeHalfWidth, -holeHalfHeight);
  hole.lineTo(holeHalfWidth, -holeHalfHeight);
  hole.lineTo(holeHalfWidth, holeHalfHeight);
  hole.lineTo(-holeHalfWidth, holeHalfHeight);
  hole.lineTo(-holeHalfWidth, -holeHalfHeight);
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: FRAME_DEPTH, bevelEnabled: false });
  const material = new THREE.MeshStandardMaterial({ color: 0x4a2d1c, roughness: 0.7 }); // wood brown
  const frame = new THREE.Mesh(geometry, material);
  frame.position.z = -FRAME_DEPTH / 2; // straddles z=0 evenly
  return frame;
}

// ── Tap-to-trigger ───────────────────────────────────────────────────
// Same raycast pattern as ../../bitforest/marker-tree-of-life's
// tap-to-kill-gnats. Toggles play/pause each tap (via MagicWindowAudio.
// isPlaying()) rather than only ever starting — losing tracking still
// force-stops it independently (see updateFromDetectedImages()), so a
// re-found marker always starts paused again, needing a fresh tap. Only
// live while a marker is actually tracked — the tree mesh still
// technically exists in the scene graph (just hidden via
// anchorGroup.visible) when not found, and would otherwise still be a
// valid raycast target.
const tapRaycaster = new THREE.Raycaster();
function tapCoordsToNdc(x, y) {
  return new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
}

// A single physical tap fires BOTH 'touchstart' (immediately) and a
// synthetic 'click' (~300ms later) on mobile browsers — both are
// registered below so the tree responds instantly to touch while still
// working with a mouse in desktop testing. Without this guard, that one
// tap toggled play/pause twice in a row (on, then immediately back off),
// which read as "it needs a tap-and-hold" / "on and off with one tap".
const TAP_DEBOUNCE_MS = 500;
let lastTapHandledAt = -Infinity;

function onScreenTap(e) {
  if (!found || !tree) return;
  const now = performance.now();
  if (now - lastTapHandledAt < TAP_DEBOUNCE_MS) return;

  const touch = e.touches ? e.touches[0] : e;
  tapRaycaster.setFromCamera(tapCoordsToNdc(touch.clientX, touch.clientY), camera);
  if (tapRaycaster.intersectObject(tree, true).length > 0) {
    lastTapHandledAt = now;
    MagicWindowAudio.resume(); // this tap IS the user gesture — the most reliable possible place to unlock the AudioContext
    if (MagicWindowAudio.isPlaying()) MagicWindowAudio.stop();
    else MagicWindowAudio.start();
  }
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
    // large the room/tree geometry is built in marker-local units (see
    // buildRoom()/buildTree()) — not by scaling the anchor.
    if (typeof detection.scale === 'number') anchorGroup.scale.setScalar(detection.scale);
    anchorGroup.updateMatrixWorld(true); // force-refresh before reading it below — not automatic until the renderer's own traversal
    updateClipPlanes(dims.halfWidth, dims.halfHeight);

    if (!found) {
      found = true;
      anchorGroup.visible = true;
      markerHint.classList.add('hidden');
      // Audio/bounce no longer auto-start here — see onScreenTap(): tapping
      // the tree itself is what triggers MagicWindowAudio.start() now.
    }

    // Beat-synced bounce — see audio.js's getBounceEnvelope() for why this
    // stays locked to the beat regardless of frame rate. Applied every
    // frame while visible, on top of the tree's fixed floor position.
    if (tree) tree.position.y = treeBaseY + MagicWindowAudio.getBounceEnvelope() * treeBounceAmplitude;
  } else if (found) {
    found = false;
    foundName = null;
    hasSmoothedPose = false;
    anchorGroup.visible = false;
    markerHint.classList.remove('hidden');
    MagicWindowAudio.stop();
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
    // The room's opening is inset slightly from the marker's true edge —
    // see the ROOM_MARGIN comment above buildRoom(). buildFrame() is given
    // this SAME value so its hole lines up exactly with the room's edge,
    // not the raw (larger) marker edge.
    const openingHalfWidth = dims.halfWidth * ROOM_MARGIN;
    const openingHalfHeight = dims.halfHeight * ROOM_MARGIN;
    anchorGroup.add(buildRoom(openingHalfWidth, openingHalfHeight));
    anchorGroup.add(buildFrame(openingHalfWidth, openingHalfHeight));

    loadingScreen.classList.add('hidden');
    markerHint.classList.remove('hidden');

    canvas.addEventListener('touchstart', onScreenTap, { passive: true });
    canvas.addEventListener('click', onScreenTap);

    // Browsers (iOS Safari especially) only unlock an AudioContext from
    // within an actual user-gesture event handler. Tapping the tree
    // itself (onScreenTap, above) already does this reliably, but that
    // only fires once a marker is tracked — this is a fallback so the
    // very first tap anywhere on the page (even before a marker's found)
    // still gets the AudioContext unlocked ahead of time.
    const unlockAudio = () => {
      MagicWindowAudio.resume();
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('touchstart', unlockAudio, { passive: true });
    document.addEventListener('click', unlockAudio);
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
