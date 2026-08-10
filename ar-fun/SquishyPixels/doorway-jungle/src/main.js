// Doorway Jungle — SLAM WebAR, 8th Wall Engine (open source) + three.js
// A doorway is placed where the user taps. Looking through it reveals a
// jungle scene "on the other side" — a classic AR portal illusion.
//
// Portal technique verified against 8th Wall's own example
// (github.com/8thwall/web/tree/master/examples/aframe/portal, the
// "xrextras-hider-material" component): the trick is NOT a stencil buffer —
// it's a plain THREE.MeshStandardMaterial with colorWrite=false. That mesh
// still writes to the depth buffer (so it occludes things behind it) but
// draws no color, so the camera feed shows through wherever it sits. A wall
// shape with a doorway-shaped hole cut out of it (via THREE.Shape + a hole
// Path) hides the jungle everywhere except inside the doorway silhouette.
//
// Placement pattern (SLAM + recenter()) and camera pipeline setup mirror
// ../../bitforest/tree-of-life/src/main.js, which is confirmed working
// on-device. Jungle assets are reused from that experience's CC0 nature
// pack rather than duplicated.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
window.THREE = THREE; // XR8's pipeline modules expect a global THREE

const ASSETS_BASE = '../../bitforest/tree-of-life/assets/nature/'; // reuse Tree of Life's assets

let scene, camera, renderer;
let doorGroup = null;
let placed = false;

const placeHint = document.getElementById('place-hint');
const loadingScreen = document.getElementById('loading-screen');
const recenterBtn = document.getElementById('recenter-btn');

// ── Doorway geometry ─────────────────────────────────────────────
// All sizes below are real-world meters — see the scale:'absolute' config
// in onxrloaded(). With the default 'responsive' scale mode (what this
// project used before), 8th Wall doesn't guarantee metric accuracy and
// can re-estimate scale differently on each recenter() — that was the
// "shrinking / hobbit portal" effect after using the re-center button.
// 'absolute' mode fixes scale to real meters once, so recentering only
// ever affects position/facing, never size.
const DOOR_HEIGHT = 7 * 0.3048; // 7 feet, in meters
const SCALE = DOOR_HEIGHT / 2.0; // keeps everything else's prior proportions relative to the old 2.0m door height
const DOOR_WIDTH = 0.9 * SCALE;
const FRAME_THICKNESS = 0.08 * SCALE;
const FRAME_DEPTH = 0.06 * SCALE;
const GROUND_POS = new THREE.Vector3(0, 0, -1.0 * SCALE); // ground position, in front of world origin

// Room the jungle content sits inside. The doorway/hider wall (below)
// already blocks every direct sightline from outside except through its
// hole, so these enclosing walls are reachable ONLY by rays that pass
// through that same hole — whether the viewer is peeking through it from
// outside, or has physically walked past it and is standing inside. That
// means the walls don't need any invisible-from-outside trick themselves;
// plain opaque (DoubleSide, for safety against normal-direction mistakes)
// material is correct and sufficient. Without them, looking sideways/up/
// back while standing inside had nothing to block the real camera feed.
const ROOM_WIDTH = 3.4 * SCALE;
const ROOM_HEIGHT = 3.2 * SCALE;
const ROOM_DEPTH = 4.0 * SCALE;

// The hider block (below) occupies roughly z:[-0.30, +0.05] — a shallow
// "doorway hallway." The room's own solid walls start where that hallway
// ends (ROOM_FRONT_Z), not at the doorway plane itself (z=0). Overlapping
// the two caused the room's near wall edges to fight with the hider's
// invisible caps for the same space, showing up as the wall right at the
// doorway looking transparent from inside.
const HALLWAY_DEPTH = 0.4 * SCALE;
const ROOM_FRONT_Z = -HALLWAY_DEPTH;
const ROOM_BACK_Z = ROOM_FRONT_Z - ROOM_DEPTH;
const ROOM_CENTER_Z = (ROOM_FRONT_Z + ROOM_BACK_Z) / 2;

function buildDoorFrame() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x4a2d1c, roughness: 0.85 });

  const jambGeo = new THREE.BoxGeometry(FRAME_THICKNESS, DOOR_HEIGHT + FRAME_THICKNESS, FRAME_DEPTH);
  const leftJamb = new THREE.Mesh(jambGeo, material);
  leftJamb.position.set(-(DOOR_WIDTH / 2 + FRAME_THICKNESS / 2), (DOOR_HEIGHT + FRAME_THICKNESS) / 2, 0);
  group.add(leftJamb);

  const rightJamb = new THREE.Mesh(jambGeo, material);
  rightJamb.position.set(DOOR_WIDTH / 2 + FRAME_THICKNESS / 2, (DOOR_HEIGHT + FRAME_THICKNESS) / 2, 0);
  group.add(rightJamb);

  const lintelGeo = new THREE.BoxGeometry(DOOR_WIDTH + FRAME_THICKNESS * 2, FRAME_THICKNESS, FRAME_DEPTH);
  const lintel = new THREE.Mesh(lintelGeo, material);
  lintel.position.set(0, DOOR_HEIGHT + FRAME_THICKNESS / 2, 0);
  group.add(lintel);

  return group;
}

// The "hider" — see file header. A wall-sized block with a doorway-shaped
// hole through it, invisible but depth-writing, so it occludes the jungle
// everywhere except through the doorway opening.
//
// Must be at least as large as the room (ROOM_WIDTH/ROOM_HEIGHT) on every
// side, or there's an uncovered gap between this shape's edge and the
// room's walls/ceiling — which showed up as visibly seeing the room from
// outside, and out of it from inside, near the doorway's edges. The margin
// keeps it comfortably oversized so that stays true even if the room's
// size changes later.
//
// It also needs real DEPTH, not a paper-thin plane: a zero-thickness plane
// leaves a razor-thin seam against the room's walls (which start right at
// z=0), and at grazing/oblique viewing angles a sightline can slip through
// that seam without hitting either surface — the "thin black line" and
// "see through on both sides from inside" reports. Extruding the same
// shape+hole into a solid block removes the seam entirely.
function buildHiderWall() {
  const wallWidth = ROOM_WIDTH + 1.0 * SCALE;
  const wallHeight = ROOM_HEIGHT + 1.0 * SCALE;
  const hiderDepth = HALLWAY_DEPTH - 0.05 * SCALE; // stays short of ROOM_FRONT_Z, leaving a small buffer
  const groundY = -0.01 * SCALE; // slightly below y=0 so this block's bottom face
  // isn't exactly coplanar with the ground plane mesh — two coincident
  // surfaces at the same height z-fight (flicker) against each other.

  const shape = new THREE.Shape();
  shape.moveTo(-wallWidth / 2, groundY);
  shape.lineTo(wallWidth / 2, groundY);
  shape.lineTo(wallWidth / 2, wallHeight);
  shape.lineTo(-wallWidth / 2, wallHeight);
  shape.lineTo(-wallWidth / 2, groundY);

  const hole = new THREE.Path();
  hole.moveTo(-DOOR_WIDTH / 2, 0);
  hole.lineTo(DOOR_WIDTH / 2, 0);
  hole.lineTo(DOOR_WIDTH / 2, DOOR_HEIGHT);
  hole.lineTo(-DOOR_WIDTH / 2, DOOR_HEIGHT);
  hole.lineTo(-DOOR_WIDTH / 2, 0);
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: hiderDepth, bevelEnabled: false });
  // ExtrudeGeometry puts the two end caps (front+back) in material group 0
  // and all the extruded side walls — including the hole's inner "reveal"
  // — in group 1. The caps are what need to be invisible for the portal
  // trick; the sides are physical wall thickness and should look solid,
  // not see-through (that showed up as the door's reveal looking
  // transparent from an angle).
  const capMaterial = new THREE.MeshStandardMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const sideMaterial = new THREE.MeshStandardMaterial({ color: 0x2f1c10, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(geometry, [capMaterial, sideMaterial]);
  // Extrudes from local z=0 to z=+hiderDepth; shift so it spans from just
  // in front of the frame to well past the room's near boundary (z=0).
  wall.position.z = 0.05 * SCALE - hiderDepth;
  return wall;
}

function loadJungleProp(group, path, targetHeight, x, z, rotationY = 0) {
  new GLTFLoader().load(
    `${ASSETS_BASE}${path}`,
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y || 1;
      model.scale.setScalar(targetHeight / height);

      const scaledBox = new THREE.Box3().setFromObject(model);
      model.position.set(x, -scaledBox.min.y, z);
      model.rotation.y = rotationY;
      group.add(model);
    },
    undefined,
    (err) => console.error(`Jungle prop failed to load (${path}):`, err)
  );
}

function buildJungleRoom() {
  const group = new THREE.Group();
  const wallMat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), wallMat(0x1f4d24));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, ROOM_CENTER_Z);
  group.add(ground);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), wallMat(0x0d2b12));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, ROOM_HEIGHT, ROOM_CENTER_Z);
  group.add(ceiling);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_HEIGHT), wallMat(0x1a3d1f));
  backWall.position.set(0, ROOM_HEIGHT / 2, ROOM_BACK_Z);
  group.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_HEIGHT), wallMat(0x1a3d1f));
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, ROOM_CENTER_Z);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_HEIGHT), wallMat(0x1a3d1f));
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, ROOM_CENTER_Z);
  group.add(rightWall);

  // The room's own doorway-facing wall — what you actually see from
  // INSIDE looking back toward the entrance, everywhere except through
  // the hole. Without this, that direction had nothing but the hider
  // block (which only ever shows the real camera feed, never room
  // content, regardless of which side it's viewed from) — so looking
  // toward the door from inside looked straight through to the real
  // room. This is a normal opaque wall, matching the others, positioned
  // at the room's actual front boundary — well behind the hider block,
  // so it stays correctly hidden from outside.
  const doorwayWallShape = new THREE.Shape();
  doorwayWallShape.moveTo(-ROOM_WIDTH / 2, 0);
  doorwayWallShape.lineTo(ROOM_WIDTH / 2, 0);
  doorwayWallShape.lineTo(ROOM_WIDTH / 2, ROOM_HEIGHT);
  doorwayWallShape.lineTo(-ROOM_WIDTH / 2, ROOM_HEIGHT);
  doorwayWallShape.lineTo(-ROOM_WIDTH / 2, 0);
  const doorwayHole = new THREE.Path();
  doorwayHole.moveTo(-DOOR_WIDTH / 2, 0);
  doorwayHole.lineTo(DOOR_WIDTH / 2, 0);
  doorwayHole.lineTo(DOOR_WIDTH / 2, DOOR_HEIGHT);
  doorwayHole.lineTo(-DOOR_WIDTH / 2, DOOR_HEIGHT);
  doorwayHole.lineTo(-DOOR_WIDTH / 2, 0);
  doorwayWallShape.holes.push(doorwayHole);
  const doorwayWall = new THREE.Mesh(new THREE.ShapeGeometry(doorwayWallShape), wallMat(0x1a3d1f));
  doorwayWall.position.z = ROOM_FRONT_Z;
  group.add(doorwayWall);

  return group;
}

// ── Pre-placement scan grid ────────────────────────────────────────
// Same technique as ../../bitforest/tree-of-life: a placement *preview*,
// not real surface detection (the open-source engine doesn't document a
// plane-detection API — see that file for details). Follows the tracked
// camera so the user can see roughly where the doorway will land, at the
// same ground offset it's actually placed at, before committing to a tap.
const SCAN_GRID_DISTANCE = 1.0 * SCALE; // matches GROUND_POS.z
let scanGrid = null;

function buildScanGrid() {
  const grid = new THREE.GridHelper(1.2 * SCALE, 12, 0x6ef, 0x2a5570);
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

function buildJungle(group) {
  group.add(buildJungleRoom());

  loadJungleProp(group, 'Twisted Tree.glb', 2.6 * SCALE, -0.5 * SCALE, -1.5 * SCALE - HALLWAY_DEPTH, 0.6);
  loadJungleProp(group, 'Twisted Tree-7PDBpElkQr.glb', 2.3 * SCALE, 0.7 * SCALE, -2.6 * SCALE - HALLWAY_DEPTH, 2.4);
  loadJungleProp(group, 'Bush.glb', 0.5 * SCALE, -0.9 * SCALE, -0.7 * SCALE - HALLWAY_DEPTH, 1.1);
  loadJungleProp(group, 'Fern.glb', 0.4 * SCALE, 0.5 * SCALE, -0.6 * SCALE - HALLWAY_DEPTH, 0.3);
  loadJungleProp(group, 'Plant Big.glb', 0.6 * SCALE, -0.3 * SCALE, -1.9 * SCALE - HALLWAY_DEPTH, 3.0);
  loadJungleProp(group, 'Mushroom.glb', 0.25 * SCALE, 0.3 * SCALE, -1.1 * SCALE - HALLWAY_DEPTH, 0);
}

// ── Placement ────────────────────────────────────────────────────
// Same XR8.XrController.recenter() pattern as ../../bitforest/tree-of-life —
// confirmed working. See that file for why (no documented plane-detection
// hit-test API for the open-source engine as of this writing).
function placeDoorway() {
  if (placed) return;
  XR8.XrController.recenter();

  doorGroup.visible = true;
  scanGrid.visible = false;
  placed = true;
  placeHint.classList.add('hidden');
  recenterBtn.classList.remove('hidden');
}

function onScreenTap() {
  if (!placed) placeDoorway();
}

// XR8.XrController.recenter() resets the WHOLE tracked pose (position +
// orientation) to wherever the camera currently is — including its
// height. Since doorGroup sits at a fixed offset from that origin,
// pressing this while holding the phone at a different height than the
// original placement made the doorway visibly jump to a new floor
// height each time, on top of just re-centering it horizontally. Capture
// the camera's height in the OLD reference frame right before
// recentering, then shift doorGroup by the same amount in the NEW frame
// so its real-world height stays put — only position/facing re-center,
// not the anchor height.
recenterBtn.addEventListener('click', () => {
  if (!placed) return;
  const yBeforeRecenter = camera.position.y;
  XR8.XrController.recenter();
  doorGroup.position.y = GROUND_POS.y - yBeforeRecenter;
});

// ── 8th Wall pipeline module ─────────────────────────────────────
const doorwayJunglePipelineModule = () => ({
  name: 'doorway-jungle',

  onStart: ({ canvas }) => {
    const { scene: xrScene, camera: xrCamera, renderer: xrRenderer } = XR8.Threejs.xrScene();
    scene = xrScene;
    camera = xrCamera;
    renderer = xrRenderer;

    scene.fog = new THREE.Fog(0x0b2a12, 1.2 * SCALE, 6 * SCALE);

    scene.add(new THREE.AmbientLight(0x8ad88a, 0.8));
    const dirLight = new THREE.DirectionalLight(0xdff0c0, 0.7);
    dirLight.position.set(0.5, 1, 0.3);
    scene.add(dirLight);

    doorGroup = new THREE.Group();
    doorGroup.position.copy(GROUND_POS);
    doorGroup.visible = false;
    scene.add(doorGroup);

    // Dedicated interior light — the ambient/directional pair above lights
    // the whole scene evenly, but the enclosed room reads darker than the
    // open diorama did. This point light sits near the room's ceiling to
    // brighten the interior specifically without blowing out the doorway
    // frame or anything outside it.
    const roomLight = new THREE.PointLight(0xeafbd8, 1.4, ROOM_DEPTH * 1.5, 2);
    roomLight.position.set(0, ROOM_HEIGHT - 0.3 * SCALE, ROOM_CENTER_Z);
    doorGroup.add(roomLight);

    doorGroup.add(buildDoorFrame());
    doorGroup.add(buildHiderWall());
    buildJungle(doorGroup);

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
    if (!placed) updateScanGrid(performance.now() / 1000);
  },
});

function onxrloaded() {
  // 'absolute' returns camera/content position in real meters, fixed once
  // scale is estimated — unlike the default 'responsive' mode, which
  // isn't metrically guaranteed and can re-estimate scale differently on
  // each recenter(). Must be set before XR8.XrController.pipelineModule()
  // and XR8.run() per XR8.XrController.configure()'s docs.
  XR8.XrController.configure({ scale: 'absolute' });

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),      // Draws the camera feed.
    XR8.Threejs.pipelineModule(),                // Creates a ThreeJS AR Scene.
    XR8.XrController.pipelineModule(),           // Enables SLAM tracking.
    LandingPage.pipelineModule(),                // Detects unsupported browsers and gives hints.
    XRExtras.FullWindowCanvas.pipelineModule(),  // Modifies the canvas to fill the window.
    XRExtras.Loading.pipelineModule(),           // Manages the loading screen on startup.
    XRExtras.RuntimeError.pipelineModule(),      // Shows an error image on runtime error.
    doorwayJunglePipelineModule(),               // Our doorway + jungle portal.
  ]);

  const canvas = document.getElementById('camerafeed');
  XR8.run({ canvas });
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);
