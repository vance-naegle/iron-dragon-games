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
const DOOR_WIDTH = 0.9;
const DOOR_HEIGHT = 2.0;
const FRAME_THICKNESS = 0.08;
const FRAME_DEPTH = 0.06;
const GROUND_POS = new THREE.Vector3(0, 0, -1.0); // ground position, in front of world origin

// Room the jungle content sits inside. The doorway/hider wall (below)
// already blocks every direct sightline from outside except through its
// hole, so these enclosing walls are reachable ONLY by rays that pass
// through that same hole — whether the viewer is peeking through it from
// outside, or has physically walked past it and is standing inside. That
// means the walls don't need any invisible-from-outside trick themselves;
// plain opaque (DoubleSide, for safety against normal-direction mistakes)
// material is correct and sufficient. Without them, looking sideways/up/
// back while standing inside had nothing to block the real camera feed.
const ROOM_WIDTH = 3.4;
const ROOM_HEIGHT = 3.2;
const ROOM_DEPTH = 4.0;

// The hider block (below) occupies roughly z:[-0.30, +0.05] — a shallow
// "doorway hallway." The room's own solid walls start where that hallway
// ends (ROOM_FRONT_Z), not at the doorway plane itself (z=0). Overlapping
// the two caused the room's near wall edges to fight with the hider's
// invisible caps for the same space, showing up as the wall right at the
// doorway looking transparent from inside.
const HALLWAY_DEPTH = 0.4;
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
  const wallWidth = ROOM_WIDTH + 1.0;
  const wallHeight = ROOM_HEIGHT + 1.0;
  const hiderDepth = HALLWAY_DEPTH - 0.05; // stays short of ROOM_FRONT_Z, leaving a small buffer
  const groundY = -0.01; // slightly below y=0 so this block's bottom face
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
  wall.position.z = 0.05 - hiderDepth;
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

function buildJungle(group) {
  group.add(buildJungleRoom());

  loadJungleProp(group, 'Twisted Tree.glb', 2.6, -0.5, -1.5 - HALLWAY_DEPTH, 0.6);
  loadJungleProp(group, 'Twisted Tree-7PDBpElkQr.glb', 2.3, 0.7, -2.6 - HALLWAY_DEPTH, 2.4);
  loadJungleProp(group, 'Bush.glb', 0.5, -0.9, -0.7 - HALLWAY_DEPTH, 1.1);
  loadJungleProp(group, 'Fern.glb', 0.4, 0.5, -0.6 - HALLWAY_DEPTH, 0.3);
  loadJungleProp(group, 'Plant Big.glb', 0.6, -0.3, -1.9 - HALLWAY_DEPTH, 3.0);
  loadJungleProp(group, 'Mushroom.glb', 0.25, 0.3, -1.1 - HALLWAY_DEPTH, 0);
}

// ── Placement ────────────────────────────────────────────────────
// Same XR8.XrController.recenter() pattern as ../../bitforest/tree-of-life —
// confirmed working. See that file for why (no documented plane-detection
// hit-test API for the open-source engine as of this writing).
function placeDoorway() {
  if (placed) return;
  XR8.XrController.recenter();

  doorGroup.visible = true;
  placed = true;
  placeHint.classList.add('hidden');
  recenterBtn.classList.remove('hidden');
}

function onScreenTap() {
  if (!placed) placeDoorway();
}

recenterBtn.addEventListener('click', () => {
  if (!placed) return;
  XR8.XrController.recenter();
});

// ── 8th Wall pipeline module ─────────────────────────────────────
const doorwayJunglePipelineModule = () => ({
  name: 'doorway-jungle',

  onStart: ({ canvas }) => {
    const { scene: xrScene, camera: xrCamera, renderer: xrRenderer } = XR8.Threejs.xrScene();
    scene = xrScene;
    camera = xrCamera;
    renderer = xrRenderer;

    scene.fog = new THREE.Fog(0x0b2a12, 1.2, 6);

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
    roomLight.position.set(0, ROOM_HEIGHT - 0.3, ROOM_CENTER_Z);
    doorGroup.add(roomLight);

    doorGroup.add(buildDoorFrame());
    doorGroup.add(buildHiderWall());
    buildJungle(doorGroup);

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
    doorwayJunglePipelineModule(),               // Our doorway + jungle portal.
  ]);

  const canvas = document.getElementById('camerafeed');
  XR8.run({ canvas });
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);
