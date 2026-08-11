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
const adjustPanel = document.getElementById('adjust-panel');
const debugReadout = document.getElementById('debug-readout');
const heightUpBtn = document.getElementById('height-up-btn');
const heightDownBtn = document.getElementById('height-down-btn');

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

// ── Pre-placement scan visualization ────────────────────────────────
// Unlike the earlier camera-following GridHelper (a fake placeholder that
// didn't reflect anything real), this renders 8th Wall's actual SLAM
// feature-point cloud — the same "world points" data the tracker itself
// uses to understand the room. Turned on via `enableWorldPoints: true` in
// XrController.configure() (see onxrloaded()); each frame it's read back
// from processCpuResult.reality.worldPoints. There's still no documented
// plane/mesh API in the open-source engine, so this is the closest thing
// to "show me what the scanner sees" available — real tracked points, not
// a synthesized surface.
//
// reality.worldPoints only reports points currently in view, not a
// persistent map — on-device testing showed dots vanishing on every pan,
// and the placement-readiness gate (below) flickering back to "scanning"
// as the in-view count dipped below its threshold each time the user
// panned (exactly the motion the "scan your space" hint asks for). Fixed
// by accumulating into our own persistent buffer instead of overwriting it
// every frame — points, once seen, stay in the cloud/readiness count
// regardless of where the camera currently points.
const MAX_WORLD_POINTS = 800; // ring-buffer cap once a scan has run a while
const POINT_DEDUP_DIST = 0.03 * SCALE; // ~3cm — skip points already close to an accumulated one
let worldPointsCloud = null;
let worldPointsGeometry = null;
let accumulatedPoints = []; // {x,y,z}[] — persists across frames, see above
let ringWriteIndex = 0; // once at MAX_WORLD_POINTS, recycle oldest slots
let loggedWorldPointSample = false; // one-time console.debug to confirm point shape on-device

// A soft round sprite for each point — THREE.Points draws hard-edged
// squares with no texture, which is what read as "pixelated" on-device.
function buildDotTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function buildWorldPointsCloud() {
  worldPointsGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_WORLD_POINTS * 3);
  worldPointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  worldPointsGeometry.setDrawRange(0, 0); // nothing until the first real points arrive

  // sizeAttenuation:false fixes size in screen-space pixels regardless of
  // distance — with attenuation on, SLAM points that land close to the
  // lens (common noise) blew up into huge blocky squares.
  const material = new THREE.PointsMaterial({
    color: 0x6ef,
    map: buildDotTexture(),
    size: 7,
    sizeAttenuation: false,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
    opacity: 0.9,
  });
  return new THREE.Points(worldPointsGeometry, material);
}

function isNearAccumulatedPoint(x, y, z) {
  const d2 = POINT_DEDUP_DIST * POINT_DEDUP_DIST;
  for (let i = 0; i < accumulatedPoints.length; i++) {
    const p = accumulatedPoints[i];
    const dx = p.x - x, dy = p.y - y, dz = p.z - z;
    if (dx * dx + dy * dy + dz * dz < d2) return true;
  }
  return false;
}

function updateWorldPointsCloud(points) {
  if (points && points.length) {
    if (!loggedWorldPointSample) {
      console.debug('[doorway-jungle] sample world point:', points[0]);
      loggedWorldPointSample = true;
    }
    for (let i = 0; i < points.length; i++) {
      // Defensive: docs describe worldPoints as {x,y,z}, but fall back to a
      // nested .position in case a given engine version wraps it differently.
      const src = points[i].position || points[i];
      if (typeof src.x !== 'number') continue;
      if (isNearAccumulatedPoint(src.x, src.y, src.z)) continue;

      if (accumulatedPoints.length < MAX_WORLD_POINTS) {
        accumulatedPoints.push({ x: src.x, y: src.y, z: src.z });
      } else {
        accumulatedPoints[ringWriteIndex] = { x: src.x, y: src.y, z: src.z };
        ringWriteIndex = (ringWriteIndex + 1) % MAX_WORLD_POINTS;
      }
    }
  }

  const positions = worldPointsGeometry.attributes.position.array;
  for (let i = 0; i < accumulatedPoints.length; i++) {
    positions[i * 3] = accumulatedPoints[i].x;
    positions[i * 3 + 1] = accumulatedPoints[i].y;
    positions[i * 3 + 2] = accumulatedPoints[i].z;
  }
  worldPointsGeometry.attributes.position.needsUpdate = true;
  worldPointsGeometry.setDrawRange(0, accumulatedPoints.length);
  latestWorldPointCount = accumulatedPoints.length;
}

// ── Placement readiness gate ────────────────────────────────────────
// Placing (recenter() + anchoring doorGroup) while tracking hasn't locked
// on yet bakes that bad initial estimate in permanently — the "frozen"
// content is only as good as the pose it was frozen to. This gates the
// tap behind a stability check instead of accepting it immediately.
//
// 8th Wall exposes processCpuResult.reality.trackingStatus/trackingReason,
// but its current docs site is a client-rendered SPA that couldn't be
// crawled to confirm the exact enum strings (see console.debug below to
// check on-device). Rather than gate on an unverified exact match — which
// could silently block placement forever if the guess is wrong — this
// combines it with a signal already confirmed working this session (world
// point count) and a minimum settle time, and only ever uses trackingStatus
// to make things WORSE (block a known-bad state), never to block on its own
// if the shape doesn't match what's expected.
const MIN_STABILIZE_MS = 2000;
const MIN_STABLE_POINTS = 30;
const BAD_TRACKING_TOKENS = ['LIMITED', 'NOT_TRACKING', 'INITIALIZING', 'RELOCALIZING'];

let xrStartTime = 0;
let latestWorldPointCount = 0;
let trackingReady = false;
let loggedTrackingStatusSample = false;

function isTrackingStatusBad(reality) {
  const raw = reality?.trackingStatus;
  if (!raw) return false; // unrecognized/absent shape — don't block on it
  if (!loggedTrackingStatusSample) {
    console.debug('[doorway-jungle] sample trackingStatus:', raw, 'trackingReason:', reality?.trackingReason);
    loggedTrackingStatusSample = true;
  }
  const status = (typeof raw === 'string' ? raw : raw.status || raw.reason || '').toString().toUpperCase();
  return BAD_TRACKING_TOKENS.some((bad) => status.includes(bad));
}

function updateTrackingReadiness(reality) {
  const settled = performance.now() - xrStartTime >= MIN_STABILIZE_MS;
  const enoughPoints = latestWorldPointCount >= MIN_STABLE_POINTS;
  const wasReady = trackingReady;
  trackingReady = settled && enoughPoints && globalFloorY !== null && !isTrackingStatusBad(reality);
  if (trackingReady !== wasReady) {
    placeHint.textContent = trackingReady ? 'Tap to open the doorway' : 'Slowly pan your phone around the room to scan it';
  }
}

// ── Floor preview plane ─────────────────────────────────────────────
// Individual scan dots are a few pixels each — genuinely hard to tap
// precisely on a phone, per on-device feedback. v1 of this fit one big
// plane to the ENTIRE room's accumulated points; on-device testing showed
// that's exactly the problem — a room-wide median mixes in points from
// furniture, walls-near-floor, whatever else happened to scan low, which
// don't represent the height of the specific spot you're aiming at.
//
// Now it's a small (~2ft square) region that follows wherever the camera
// is currently looking, refined from ONLY the points near that spot:
//  1. GLOBAL_FLOOR_Y: a room-wide median, kept only as a bootstrap value
//     (to get a rough first guess of "where's the floor" before any local
//     refinement exists) and as the readiness gate's "do we have any
//     floor estimate at all yet" signal.
//  2. localFloorHit(tapX, tapY): raycasts the given screen point against
//     that bootstrap plane to find an approximate spot, then re-estimates
//     height from only the accumulated points within LOCAL_RADIUS of it —
//     this is what actually determines placement height now.
// The small square mesh is purely the visual for (2), repositioned every
// frame pre-placement to track screen-center (wherever you're aiming).
const LOCAL_RADIUS = 0.3048; // meters (~1ft) — points farther than this from the aim point don't influence its height estimate
const RETICLE_SIZE = 0.6096; // meters (2ft) — the visual square's edge length

let floorPlane = null;
let floorPlaneGeometry = null;
let globalFloorY = null; // null until enough floor-candidate points exist anywhere

function buildFloorPlane() {
  floorPlaneGeometry = new THREE.PlaneGeometry(RETICLE_SIZE, RETICLE_SIZE);
  const material = new THREE.MeshBasicMaterial({
    color: 0x6ef,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(floorPlaneGeometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}

function updateGlobalFloorY() {
  if (accumulatedPoints.length < 8) {
    globalFloorY = null;
    return;
  }
  const floorCandidates = [];
  for (const p of accumulatedPoints) {
    if (p.y < camera.position.y - 0.3) floorCandidates.push(p.y);
  }
  if (floorCandidates.length < 5) {
    globalFloorY = null;
    return;
  }
  floorCandidates.sort((a, b) => a - b);
  globalFloorY = floorCandidates[Math.floor(floorCandidates.length / 2)]; // median
}

// Raycasts (tapX, tapY) against the bootstrap plane to find an approximate
// spot, then refines its height using only nearby accumulated points.
// Falls back to the coarse (unrefined) point if too few local points exist
// yet — still a real hit, just not locally corrected.
function localFloorHit(tapX, tapY) {
  if (globalFloorY === null) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(tapX * 2 - 1, -(tapY * 2 - 1)), camera);
  const bootstrapPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -globalFloorY);
  const approx = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(bootstrapPlane, approx)) return null;

  const r2 = LOCAL_RADIUS * LOCAL_RADIUS;
  const localYs = [];
  for (const p of accumulatedPoints) {
    const dx = p.x - approx.x, dz = p.z - approx.z;
    if (dx * dx + dz * dz > r2) continue;
    if (p.y < camera.position.y - 0.3) localYs.push(p.y);
  }
  if (localYs.length < 3) return approx; // not enough local data — coarse estimate as-is

  localYs.sort((a, b) => a - b);
  approx.y = localYs[Math.floor(localYs.length / 2)]; // local median
  return approx;
}

function updateFloorPlane() {
  updateGlobalFloorY();
  if (placed) {
    floorPlane.visible = false;
    return;
  }
  const reticle = localFloorHit(0.5, 0.5); // wherever the camera's currently aimed
  if (!reticle) {
    floorPlane.visible = false;
    return;
  }
  floorPlane.position.copy(reticle);
  floorPlane.visible = true;
}

function hitTestViaFloorPlane(tapX, tapY) {
  return localFloorHit(tapX, tapY);
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
// Two hit-test strategies, tried in order, both keyed off the tapped
// screen location (unlike the old approach, which ignored tap location
// entirely and placed at a constant offset from wherever the camera
// happened to be facing, assuming a fixed 1.4m camera-to-floor height —
// the direct cause of "I tap the cloud and it floats in the air").
//
//  1. XR8.XrController.hitTest(x, y, ['FEATURE_POINT']) — 8th Wall's own
//     documented raycast against its tracked feature points. On-device
//     testing showed this doesn't actually place anything, and the docs
//     describing it predate the Feb 2026 open-source migration, so it may
//     not exist (or may differ) in this engine build — wrapped so a
//     missing/throwing method can't silently swallow every tap.
//  2. A manual THREE.Raycaster hit against the world-points cloud that's
//     already confirmed rendering live on screen (buildWorldPointsCloud/
//     updateWorldPointsCloud above). This is standard, well-documented
//     three.js behavior with no dependency on any uncertain 8th Wall API,
//     so it's the reliable fallback whenever (1) comes back empty.
function anchorDoorAt(hit) {
  // Face the doorway back toward wherever the hit was taken from, so the
  // threshold opens toward the user — yaw only, ignoring any reported
  // surface rotation, so the frame stays upright even on an angled or
  // noisy point.
  const dx = camera.position.x - hit.x;
  const dz = camera.position.z - hit.z;
  doorGroup.position.set(hit.x, hit.y, hit.z);
  doorGroup.rotation.y = Math.atan2(dx, dz);
}

// ── Diagnostic readout ────────────────────────────────────────────
// Answers "is this really a 7ft door by default, or is something scaling
// it unexpectedly?" with a number instead of eyeballing it. Rendered
// height = DOOR_HEIGHT * current pinch scale. If a tape measure (or a
// real doorway alongside it) says the rendered size is wrong while scale
// still reads 1.000x (untouched), the discrepancy is in 8th Wall's own
// absolute-scale estimate, not in this file's math — and if you pinch
// until it visually matches something known, the scale value it settles
// on tells us how far off, and in which direction.
function updateDebugReadout() {
  const scale = doorGroup.scale.x;
  const renderedM = DOOR_HEIGHT * scale;
  debugReadout.textContent =
    `expected: 7.00 ft (${DOOR_HEIGHT.toFixed(2)} m)\n` +
    `scale:    ${scale.toFixed(3)}x\n` +
    `rendered: ${(renderedM / 0.3048).toFixed(2)} ft (${renderedM.toFixed(2)} m)`;
}

function hitTestViaXR8(tapX, tapY) {
  try {
    const results = XR8.XrController.hitTest?.(tapX, tapY, ['FEATURE_POINT']);
    if (!results || !results.length) return null;
    return results.reduce((best, r) => (!best || r.distance < best.distance ? r : best)).position;
  } catch (err) {
    console.error('[doorway-jungle] XR8.XrController.hitTest failed:', err);
    return null;
  }
}

// Bypasses worldPointsCloud.visible (false post-placement, for the
// Recenter button's use) since THREE.Raycaster skips invisible objects —
// flipped only for the instant of this synchronous call, so it never
// actually flashes on screen.
function hitTestViaPointCloud(tapX, tapY) {
  const wasVisible = worldPointsCloud.visible;
  worldPointsCloud.visible = true;
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.08 * SCALE };
  raycaster.setFromCamera(new THREE.Vector2(tapX * 2 - 1, -(tapY * 2 - 1)), camera);
  const hits = raycaster.intersectObject(worldPointsCloud);
  worldPointsCloud.visible = wasVisible;
  return hits.length ? hits[0].point : null;
}

function placeDoorway(tapX, tapY) {
  if (placed) return;
  XR8.XrController.recenter(); // clears accumulated drift right before anchoring
  const hit = hitTestViaFloorPlane(tapX, tapY) || hitTestViaXR8(tapX, tapY) || hitTestViaPointCloud(tapX, tapY);
  if (!hit) {
    placeHint.textContent = 'No surface detected there — tap directly on a lit scan dot';
    setTimeout(() => { if (!placed) placeHint.textContent = 'Tap to open the doorway'; }, 1500);
    return;
  }

  anchorDoorAt(hit);
  doorGroup.visible = true;
  worldPointsCloud.visible = false;
  placed = true;
  recenterBtn.classList.remove('hidden');
  adjustPanel.classList.remove('hidden');
  debugReadout.classList.remove('hidden');

  // Auto-placement (hit-test against a sparse, noisy point cloud) can't be
  // pixel/millimeter-perfect — these are the manual correction tools for
  // when it isn't. Briefly explain them, then get out of the way.
  placeHint.textContent = 'Pinch to resize • ▲▼ to adjust height';
  setTimeout(() => { if (placed) placeHint.classList.add('hidden'); }, 4000);
}

function onScreenTap(e) {
  if (placed || !trackingReady) return;
  const point = e.touches ? e.touches[0] : e;
  placeDoorway(point.clientX / window.innerWidth, point.clientY / window.innerHeight);
}

// Re-center now re-runs the same real hit-test used for initial placement
// (aimed at screen-center, i.e. wherever the phone is currently pointed),
// rather than nudging the old fixed-offset position — it's a fresh,
// accurate reading, not a correction applied on top of a stale one. Scale
// is left untouched — this only corrects position/facing drift.
recenterBtn.addEventListener('click', () => {
  if (!placed) return;
  XR8.XrController.recenter();
  const hit = hitTestViaFloorPlane(0.5, 0.5) || hitTestViaXR8(0.5, 0.5) || hitTestViaPointCloud(0.5, 0.5);
  if (hit) anchorDoorAt(hit);
});

// ── Manual correction: height nudge + pinch-to-scale ────────────────
// Auto-placement can't always get height/size exactly right (sparse point
// cloud, assumed-flat surfaces). These let the user fix it directly rather
// than fight the scanner. Both act on doorGroup as a whole, scaling/
// shifting everything it contains uniformly — content's local (0,0,0) is
// the doorway threshold (see PIVOT ALIGNMENT above), so scaling pivots
// around the point that was actually tapped to place it, not some
// arbitrary corner.
const HEIGHT_STEP = 0.03 * SCALE; // ~3cm per tap/repeat tick, in real meters
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
let heightRepeatTimer = null;

function nudgeHeight(dir) {
  if (!placed) return;
  doorGroup.position.y += dir * HEIGHT_STEP;
}

function bindHeightHold(btn, dir) {
  if (!btn) return; // defensive: a throw here would abort the rest of this
  // module's top-level execution, including the xrloaded listener at the
  // bottom of the file — never let a missing element take down the whole
  // page's ability to start AR at all.
  const start = (e) => {
    e.preventDefault();
    nudgeHeight(dir);
    clearInterval(heightRepeatTimer);
    heightRepeatTimer = setInterval(() => nudgeHeight(dir), 150);
  };
  const stop = () => {
    clearInterval(heightRepeatTimer);
    heightRepeatTimer = null;
  };
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
  btn.addEventListener('mousedown', start);
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
}

bindHeightHold(heightUpBtn, 1);
bindHeightHold(heightDownBtn, -1);

function touchDistance(t0, t1) {
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
}

// Tracks an in-progress two-finger pinch: the distance and doorGroup scale
// at gesture start, so scale updates are relative to where the pinch began
// rather than snapping to an absolute value each frame.
let pinchState = null;

function onCanvasTouchStart(e) {
  if (!placed) {
    if (e.touches.length === 1) onScreenTap(e);
    return;
  }
  if (e.touches.length === 2) {
    pinchState = { distance: touchDistance(e.touches[0], e.touches[1]), scale: doorGroup.scale.x };
  }
}

function onCanvasTouchMove(e) {
  e.preventDefault();
  if (placed && pinchState && e.touches.length === 2) {
    const ratio = touchDistance(e.touches[0], e.touches[1]) / pinchState.distance;
    doorGroup.scale.setScalar(Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchState.scale * ratio)));
  }
}

function onCanvasTouchEnd(e) {
  if (e.touches.length < 2) pinchState = null;
}

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

    // FROZEN CONTENT CONTRACT: doorGroup's transform is only ever set by
    // placeDoorway()/the Recenter handler below (both via real hit-test
    // results) — nothing in onUpdate() or anywhere else in this file
    // touches it. SLAM keeps running for the entire session, but only to
    // drive `camera`'s position/quaternion each frame (that update happens
    // automatically inside XR8.Threejs.pipelineModule(), outside our code)
    // and to serve hitTest() — the placed content itself never moves on
    // its own. Starts at the origin; irrelevant since it's invisible until
    // a real hit-test position is set at placement.
    doorGroup = new THREE.Group();
    doorGroup.visible = false;
    scene.add(doorGroup);

    // PIVOT ALIGNMENT: buildDoorFrame()/buildHiderWall() below are built
    // symmetric around z=0 (the frame is FRAME_DEPTH thick, spanning
    // ±FRAME_DEPTH/2), so z=0 in their own local space is the frame's
    // depth-CENTER, not its front (viewer-facing) face. `content` shifts
    // everything back by half that depth so doorGroup's own local (0,0,0)
    // — ground level, centered left-right — lands exactly on the front of
    // the doorway threshold, not somewhere inside the frame.
    const content = new THREE.Group();
    content.position.z = -FRAME_DEPTH / 2;
    doorGroup.add(content);

    // Dedicated interior light — the ambient/directional pair above lights
    // the whole scene evenly, but the enclosed room reads darker than the
    // open diorama did. This point light sits near the room's ceiling to
    // brighten the interior specifically without blowing out the doorway
    // frame or anything outside it.
    const roomLight = new THREE.PointLight(0xeafbd8, 1.4, ROOM_DEPTH * 1.5, 2);
    roomLight.position.set(0, ROOM_HEIGHT - 0.3 * SCALE, ROOM_CENTER_Z);
    content.add(roomLight);

    content.add(buildDoorFrame());
    content.add(buildHiderWall());
    buildJungle(content);

    worldPointsCloud = buildWorldPointsCloud();
    scene.add(worldPointsCloud);

    floorPlane = buildFloorPlane();
    scene.add(floorPlane);

    camera.position.set(0, 1.4, 0);
    XR8.XrController.updateCameraProjectionMatrix({
      origin: camera.position,
      facing: camera.quaternion,
    });

    xrStartTime = performance.now();
    loadingScreen.classList.add('hidden');
    placeHint.textContent = 'Slowly pan your phone around the room to scan it';
    placeHint.classList.remove('hidden');

    // Pre-placement: a single touch/click places the doorway. Post-
    // placement: a two-finger touch drives pinch-to-scale instead (see the
    // Manual correction section below) — onCanvasTouchStart branches on
    // `placed` to route between the two.
    canvas.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onCanvasTouchMove, { passive: false });
    canvas.addEventListener('touchend', onCanvasTouchEnd);
    canvas.addEventListener('click', onScreenTap);
  },

  // Runs every tracked frame, keeping the (invisible, post-placement)
  // world-point buffer current for hitTestViaPointCloud(). Never touches
  // doorGroup itself — see the FROZEN CONTENT CONTRACT comment above its
  // creation. SLAM tracking itself never stops; only our use of its
  // per-frame reality data changes after placement.
  onUpdate: ({ processCpuResult }) => {
    // Keeps running post-placement too (buffers only, worldPointsCloud/
    // floorPlane visuals stay hidden) — hitTestViaPointCloud()/
    // hitTestViaFloorPlane() need fresh data for the Recenter button, not
    // a stale snapshot from before you moved.
    updateWorldPointsCloud(processCpuResult?.reality?.worldPoints);
    updateFloorPlane();
    if (!placed) updateTrackingReadiness(processCpuResult?.reality);
    else updateDebugReadout();
  },
});

function onxrloaded() {
  // 'absolute' returns camera/content position in real meters, fixed once
  // scale is estimated — unlike the default 'responsive' mode, which
  // isn't metrically guaranteed and can re-estimate scale differently on
  // each recenter(). enableWorldPoints turns on the real SLAM feature-
  // point cloud (read back in onUpdate → processCpuResult.reality.
  // worldPoints) that drives the pre-placement scan visualization. Both
  // must be set before XR8.XrController.pipelineModule() and XR8.run()
  // per XR8.XrController.configure()'s docs.
  XR8.XrController.configure({ scale: 'absolute', enableWorldPoints: true });

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
