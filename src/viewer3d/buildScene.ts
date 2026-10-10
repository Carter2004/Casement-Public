// buildScene.ts — Room -> Three.js scene graph. Re-derives NOTHING: every placement number
// comes from the same single sources the 2D views already render from, and every color comes
// from the stylesheet. This is what makes the 3D preview trustworthy — it can't drift from the
// 2D model because it reads the model, not a copy of it.

import * as THREE from "three";
import { STANDARD } from "../model/bands";
import {
  BACKSPLASHES,
  CABINET_FINISHES,
  COUNTER_MATERIALS,
  FLOOR_MATERIALS,
  WALL_PAINTS,
  resolveDoorStyle,
  resolveFinish,
  type DoorStyle,
} from "../model/finishes";
import { cabinetVerticalPlacement, kindDefinition } from "../model/kinds";
import { EPSILON, type Interval } from "../model/occupancy";
import { perimeterWalls, type Room, type Wall } from "../model/room";
import type { Cabinet } from "../model/cabinet";
import { computeBacksplashSpans } from "./backsplash";
import { computeWallPanels, type WallOpening, type WallPanel } from "./wallPanels";

/**
 * How far the counter slab overhangs the cabinet face, in inches. A 3D-presentation choice
 * (makes the slab read as a counter rather than a lid), NOT a cabinetry standard — it does not
 * belong in bands.ts, which is standards-only.
 */
const COUNTER_OVERHANG = 1;

/** Door-front geometry constants (cycle 014) — 3D-presentation choices, not cabinetry
 * standards, so (like COUNTER_OVERHANG) they stay plain constants here rather than in bands.ts. */
const DOOR_FRAME_THICKNESS = 2.5;
const DOOR_FRAME_PROTRUSION = 0.4;
const GLASS_PANE_DEPTH = 0.3;
const GLASS_INTERIOR_INSET = 1.5;
/** Open-shelf geometry constants (cycle 016 Part C2) — 3D-presentation choices, same rationale
 * as the door-frame constants above. */
const SHELF_THICKNESS = 0.75;
const SHELF_INSET = 1.5;

/** How far a backsplash panel protrudes off the wall, in inches — thin, like a real tile/slab
 * skin, not a cabinetry standard (see COUNTER_OVERHANG's own rationale above). */
const BACKSPLASH_THICKNESS = 0.5;

/**
 * Neutral white light. Lighting color/intensity is a rendering-technique choice, not part of
 * the 2D visual palette (the 2D views are flat-shaded and have no notion of "light color"), so
 * unlike surface colors it has no CSS variable to read and stays a plain constant here.
 */
const LIGHT_COLOR = 0xffffff;

/** Read a CSS custom property from the live stylesheet. The ONE place TS touches color values —
 * every hex/rgb literal lives in styles.css, not here. */
function cssColor(varName: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(value);
}

/** Build the full scene graph for the current room. Units: inches, mapped 1:1 to Three units. */
export function buildScene(room: Room): THREE.Scene {
  const scene = new THREE.Scene();
  // --canvas-bg (not --bg): the 3D backdrop is part of "the kitchen" render, pinned to its
  // pre-cycle-012 value independent of whatever --bg becomes for the chrome page background.
  scene.background = cssColor("--canvas-bg");

  scene.add(buildLighting());
  scene.add(buildFloor(room));
  for (const wall of room.walls) {
    // An island has no wall behind it — skip the dollhouse plane; its pieces + slabs still
    // render through the existing paths below (buildCabinetBox reads only start/dir/inward).
    if (wall.kind !== "island") scene.add(buildWall(room, wall));

    for (const cabinet of wall.cabinets) {
      // Openings are wall FEATURES cut into buildWall above — they render no solid box.
      if (!kindDefinition(cabinet.kind, cabinet.type).opening) {
        for (const piece of buildCabinetPieces(room, wall, cabinet)) scene.add(piece);
      }
      if (shouldRenderSlab(cabinet)) {
        scene.add(buildCounterSlab(room, wall, cabinet));
      }
    }
  }
  for (const wall of perimeterWalls(room)) {
    for (const panel of buildBacksplashPanels(room, wall)) scene.add(panel);
  }
  return scene;
}

/**
 * A slab renders only when the kind's counter behavior is 'slab' AND the piece's top sits at
 * or below standard counter height — a 96"-tall base-cabinet column (no tall-cabinet kind
 * exists yet, so users model integrated columns/pantries as an oversized base cabinet) must
 * NOT get a ceiling lid just because its band still says 'slab'. Standard bases (34.5" top)
 * and desk-height bases (28.5" top) are both comfortably under COUNTER_HEIGHT, so neither
 * changes; only pieces resized taller than a real counter lose the slab.
 */
function shouldRenderSlab(cabinet: Cabinet): boolean {
  if (kindDefinition(cabinet.kind, cabinet.type).counter !== "slab") return false;
  const { top } = cabinetVerticalPlacement(cabinet);
  return top <= STANDARD.COUNTER_HEIGHT + EPSILON;
}

function buildLighting(): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.AmbientLight(LIGHT_COLOR, 0.7));
  const directional = new THREE.DirectionalLight(LIGHT_COLOR, 0.6);
  directional.position.set(1, 1.5, 1);
  group.add(directional);
  return group;
}

/**
 * The floor as its true footprint polygon (cycle 017 — an L/U/clipped-corner shape, not just a
 * rectangle), via THREE's own built-in triangulator (zero new deps). Shape points are the plan
 * footprint's own (x, y) with y NEGATED: THREE.Shape lives in a local XY plane which this mesh
 * then lays flat via rotation.x = -90°, and that specific rotation maps local (x, y, 0) to world
 * (x, 0, -y) — negating y here up front cancels that flip, so world (x, z) ends up EXACTLY the
 * plan (x, y), no further offset needed (verified against the old PlaneGeometry+position.set
 * rectangle: both cover world X:[0,width], Z:[0,length]).
 */
function buildFloor(room: Room): THREE.Mesh {
  const shape = new THREE.Shape();
  room.footprint.forEach((v, i) => {
    if (i === 0) shape.moveTo(v.x, -v.y);
    else shape.lineTo(v.x, -v.y);
  });
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshLambertMaterial({
    color: cssColor(FLOOR_MATERIALS[room.style.floor].cssVar),
    side: THREE.DoubleSide,
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  return floor;
}

/**
 * A single-sided surface facing INTO the room (the dollhouse trick): solid seen from inside,
 * invisible from outside, so orbiting the exterior never blocks the view into the kitchen.
 * Openings (window/door/doorway pieces on this wall) are REAL cuts, not painted overlays: the
 * wall's [0,length] x [0,wallHeight] rectangle is sliced by computeWallPanels into the panels
 * that remain once every opening's own vertical range is removed, and each panel becomes its
 * own quad — a doorway is an actual gap you can see/walk through, a window an actual hole.
 *
 * Each panel's 4 world-space corners follow the SAME winding the single-quad case always used:
 * for corners ordered (low-x,low-y), (high-x,low-y), (high-x,high-y), (low-x,high-y) — i.e.
 * start-floor, end-floor, end-ceiling, start-ceiling generalized to a panel's own sub-rectangle
 * — the right-hand-rule normal works out to `length * (wall.dir × up)`, which is exactly
 * `length * wall.inward`. That proof depends only on wall.dir/up, not on a panel's own extent,
 * so it holds per-panel with no rotation/angle math (and no way to get the sign backwards).
 */
function buildWall(room: Room, wall: Wall): THREE.Mesh {
  const openings: WallOpening[] = wall.cabinets
    .filter((cabinet) => kindDefinition(cabinet.kind, cabinet.type).opening)
    .map((cabinet) => {
      const { bottom, top } = cabinetVerticalPlacement(cabinet);
      return { start: cabinet.xOffset, end: cabinet.xOffset + cabinet.width, bottom, top };
    });
  const panels = computeWallPanels(wall.length, room.wallHeight, openings);

  const positions: number[] = [];
  const indices: number[] = [];
  for (const panel of panels) {
    const base = positions.length / 3;
    for (const corner of panelCorners(wall, panel)) {
      positions.push(corner.x, corner.y, corner.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({
    color: cssColor(WALL_PAINTS[room.style.walls].cssVar),
    side: THREE.FrontSide,
  });
  return new THREE.Mesh(geometry, material);
}

/** A panel's 4 world-space corners, in the winding buildWall's header documents. */
function panelCorners(wall: Wall, panel: WallPanel): THREE.Vector3[] {
  const at = (alongWall: number, up: number) =>
    new THREE.Vector3(wall.start.x + wall.dir.x * alongWall, up, wall.start.y + wall.dir.y * alongWall);
  return [at(panel.x0, panel.y0), at(panel.x1, panel.y0), at(panel.x1, panel.y1), at(panel.x0, panel.y1)];
}

/** Every mesh for one cabinet: the box itself, plus door-front geometry when its resolved door
 * style calls for one (shaker/glass; `flat` and non-cabinet kinds add nothing — the plain box
 * already reads as a flat front). ONE cabinet, possibly several meshes; buildScene adds them all. */
function buildCabinetPieces(room: Room, wall: Wall, cabinet: Cabinet): THREE.Mesh[] {
  const box = buildCabinetBox(room, wall, cabinet);
  const doorStyle = resolveDoorStyle(room, cabinet);
  if (doorStyle === null || doorStyle === "flat") return [box];
  return [box, ...buildDoorFace(room, wall, cabinet, doorStyle)];
}

/** The color a cabinet renders as: its resolved curated finish (cabinet/filler kinds) if it has
 * one, else the existing per-kind color (appliances/fixtures keep their own — a fridge is
 * stainless, not Farmhouse-green). ONE color-resolution path, read by both the box and any door
 * geometry so a piece's frame always matches its own body. */
function cabinetColorVar(room: Room, cabinet: Cabinet): string {
  const finish = resolveFinish(room, cabinet);
  if (finish) return CABINET_FINISHES[finish].cssVar;
  return cabinet.kind === "cabinet"
    ? cabinet.type === "base"
      ? "--cabinet-base-fill"
      : "--cabinet-wall-fill"
    : `--cabinet-kind-${cabinet.kind}-fill`;
}

/** The cabinet box itself: footprint (X/Z) from the piece's own width/depth, height (Y) from
 * bands.ts, positioned/rotated onto its wall via wallLocalToWorld + wallRotationY (cycle 017 —
 * works at any wall angle; for the pre-017 default wall direction (1,0), rotationY is exactly 0
 * and this reproduces the old AABB-based box exactly). */
function buildCabinetBox(room: Room, wall: Wall, cabinet: Cabinet): THREE.Mesh {
  const { bottom, top } = cabinetVerticalPlacement(cabinet);
  const sizeX = cabinet.width;
  const sizeZ = cabinet.depth;
  const sizeY = top - bottom;

  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  const material = new THREE.MeshLambertMaterial({ color: cssColor(cabinetColorVar(room, cabinet)) });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(wallLocalToWorld(wall, cabinet.xOffset + sizeX / 2, sizeZ / 2, bottom + sizeY / 2));
  mesh.rotation.y = wallRotationY(wall);
  return mesh;
}

/** Map (along-wall inches, depth-from-wall inches, height-off-floor inches) to a world-space
 * point — the same construction cabinetFootprint uses, generalized with a depth term so
 * door-frame/backsplash geometry can be expressed in a piece's own local coordinates. Plan space
 * is (x, y) with y running "down" the room, mapped 1:1 to world (x, z) with no flip — this
 * itself needed no change for angled walls (wall.dir/inward already point any direction); only
 * the callers that used to ASSUME axis alignment (localBox, buildCabinetBox) did. */
function wallLocalToWorld(wall: Wall, alongWall: number, depthFromWall: number, up: number): THREE.Vector3 {
  return new THREE.Vector3(
    wall.start.x + wall.dir.x * alongWall + wall.inward.x * depthFromWall,
    up,
    wall.start.y + wall.dir.y * alongWall + wall.inward.y * depthFromWall,
  );
}

/** The Y-axis rotation (radians) that maps a mesh's local +X (along-wall) axis to `wall.dir` and
 * local +Z (depth) axis to `wall.inward` in world space. Derived algebraically from Three.js's
 * standard Y-rotation matrix (x' = x·cosθ + z·sinθ, z' = -x·sinθ + z·cosθ): solving x'=dir.x,
 * z'=dir.y for local (1,0) gives cosθ=dir.x, sinθ=-dir.y — and that SAME θ, applied to local
 * (0,1), independently works out to world (-dir.y, dir.x), which is exactly wall.inward by its
 * own "+90°" construction (room.ts). Zero for the pre-017 default wall direction (1,0), matching
 * every existing unrotated mesh exactly. */
function wallRotationY(wall: Wall): number {
  return Math.atan2(-wall.dir.y, wall.dir.x);
}

/** One box spanning a piece's local (along-wall, depth-from-wall, height) ranges, positioned at
 * its own center via wallLocalToWorld and rotated onto the wall via wallRotationY (cycle 017 —
 * works at any wall angle; byte-identical to the old corner-diff box for every axis-aligned
 * wall, since a Y-rotation by an exact multiple of 90° reproduces the same world-space box a
 * dimension-swap did, just via BoxGeometry(alongSize, vertSize, depthSize) + rotation instead of
 * BoxGeometry(dx, dy, dz) with no rotation — no vitest coverage depends on the literal geometry,
 * only on the visual result, which live verification confirms). */
function localBox(
  wall: Wall,
  alongRange: [number, number],
  depthRange: [number, number],
  vertRange: [number, number],
  material: THREE.Material,
): THREE.Mesh {
  const alongSize = Math.abs(alongRange[1] - alongRange[0]);
  const depthSize = Math.abs(depthRange[1] - depthRange[0]);
  const vertSize = Math.abs(vertRange[1] - vertRange[0]);
  const geometry = new THREE.BoxGeometry(alongSize, vertSize, depthSize);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(
    wallLocalToWorld(
      wall,
      (alongRange[0] + alongRange[1]) / 2,
      (depthRange[0] + depthRange[1]) / 2,
      (vertRange[0] + vertRange[1]) / 2,
    ),
  );
  mesh.rotation.y = wallRotationY(wall);
  return mesh;
}

/**
 * Door-front geometry for `shaker`/`glass`/`open` (cabinet kind only — resolveDoorStyle/
 * buildScene never call this for `flat` or a non-cabinet piece). Built entirely from simple
 * boxes via localBox/wallLocalToWorld (rotated onto the wall automatically, cycle 017) — no
 * textures, no asset pipeline, matching the plan's "simple geometry" constraint. `shaker` is a picture-frame
 * border proud of the box's own face; `glass` adds a darkened "interior" box and a translucent
 * pane in front of it; `open` (cycle 016) skips the frame ENTIRELY and dispatches to
 * buildOpenShelfFace instead — no door at all, just shelves.
 */
function buildDoorFace(room: Room, wall: Wall, cabinet: Cabinet, doorStyle: DoorStyle): THREE.Mesh[] {
  const { bottom, top } = cabinetVerticalPlacement(cabinet);
  const width = cabinet.width;
  const depth = cabinet.depth;
  const frameMaterial = new THREE.MeshLambertMaterial({ color: cssColor(cabinetColorVar(room, cabinet)) });

  if (doorStyle === "open") {
    return buildOpenShelfFace(wall, bottom, top, width, depth, frameMaterial);
  }

  const outerDepth: [number, number] = [depth, depth + DOOR_FRAME_PROTRUSION];

  const meshes: THREE.Mesh[] = [
    // Left stile, right stile, top rail, bottom rail — a picture-frame border on the door face.
    localBox(wall, [0, DOOR_FRAME_THICKNESS], outerDepth, [bottom, top], frameMaterial),
    localBox(wall, [width - DOOR_FRAME_THICKNESS, width], outerDepth, [bottom, top], frameMaterial),
    localBox(
      wall,
      [DOOR_FRAME_THICKNESS, width - DOOR_FRAME_THICKNESS],
      outerDepth,
      [top - DOOR_FRAME_THICKNESS, top],
      frameMaterial,
    ),
    localBox(
      wall,
      [DOOR_FRAME_THICKNESS, width - DOOR_FRAME_THICKNESS],
      outerDepth,
      [bottom, bottom + DOOR_FRAME_THICKNESS],
      frameMaterial,
    ),
  ];

  if (doorStyle === "glass") {
    const interiorMaterial = new THREE.MeshLambertMaterial({ color: cssColor("--finish-glass-interior") });
    meshes.push(
      localBox(
        wall,
        [DOOR_FRAME_THICKNESS, width - DOOR_FRAME_THICKNESS],
        [depth - GLASS_INTERIOR_INSET, depth],
        [bottom + DOOR_FRAME_THICKNESS, top - DOOR_FRAME_THICKNESS],
        interiorMaterial,
      ),
    );
    const glassMaterial = new THREE.MeshLambertMaterial({
      color: cssColor("--finish-glass-pane"),
      transparent: true,
      opacity: 0.45,
    });
    meshes.push(
      localBox(
        wall,
        [DOOR_FRAME_THICKNESS, width - DOOR_FRAME_THICKNESS],
        [depth, depth + GLASS_PANE_DEPTH],
        [bottom + DOOR_FRAME_THICKNESS, top - DOOR_FRAME_THICKNESS],
        glassMaterial,
      ),
    );
  }

  return meshes;
}

/**
 * Open-shelf face (cycle 016 Part C2): no door frame at all — a darkened interior box (the SAME
 * trick `glass`'s own interior uses) plus 1-2 horizontal shelf boards in the cabinet's own
 * finish color, reading as open shelving rather than a closed door. Two shelves for a tall-ish
 * opening, one for a standard-height upper — purely a presentation choice, not a real threshold.
 */
function buildOpenShelfFace(
  wall: Wall,
  bottom: number,
  top: number,
  width: number,
  depth: number,
  shelfMaterial: THREE.Material,
): THREE.Mesh[] {
  const interiorMaterial = new THREE.MeshLambertMaterial({ color: cssColor("--finish-glass-interior") });
  const meshes: THREE.Mesh[] = [
    localBox(wall, [0, width], [depth - SHELF_INSET, depth], [bottom, top], interiorMaterial),
  ];

  const shelfCount = top - bottom > 40 ? 2 : 1;
  for (let i = 1; i <= shelfCount; i++) {
    const shelfY = bottom + ((top - bottom) * i) / (shelfCount + 1);
    meshes.push(
      localBox(
        wall,
        [0, width],
        [0, depth - SHELF_INSET],
        [shelfY - SHELF_THICKNESS / 2, shelfY + SHELF_THICKNESS / 2],
        shelfMaterial,
      ),
    );
  }
  return meshes;
}

/**
 * Backsplash panels (cycle 014, NEW geometry): a thin material skin in the gap band, over each
 * perimeter wall's base-run extents, with any opening in that band (a window) punched through —
 * spans come from computeBacksplashSpans, a pure helper reusing occupancy's own interval
 * primitives (no re-derived interval math here).
 */
function buildBacksplashPanels(room: Room, wall: Wall): THREE.Mesh[] {
  const material = new THREE.MeshLambertMaterial({ color: cssColor(BACKSPLASHES[room.style.backsplash].cssVar) });
  return computeBacksplashSpans(wall).map((span: Interval) =>
    localBox(
      wall,
      [span.start, span.end],
      [0, BACKSPLASH_THICKNESS],
      [STANDARD.COUNTER_HEIGHT, STANDARD.WALL_CABINET_BOTTOM],
      material,
    ),
  );
}

/**
 * The countertop slab over a piece whose kind has counter:'slab' (fillers included — counters
 * run over them), spanning [pieceTop, pieceTop + COUNTERTOP_THICKNESS] — registry/piece-driven
 * rather than a fixed band height, so a desk-height base's slab hugs it instead of floating at
 * the standard 34.5–36" band, and a tall unit (fridge, wall-oven) never gets a slab at all
 * (buildScene only calls this when the kind's counter behavior is 'slab'). Overhangs the
 * cabinet face by COUNTER_OVERHANG. One slab per piece; flush neighbors read as a continuous
 * counter.
 */
function buildCounterSlab(room: Room, wall: Wall, cabinet: Cabinet): THREE.Mesh {
  const sizeX = cabinet.width;
  // Overhang grows only away from the wall (into the room), never back toward it — the local
  // depth range is [0, depth + overhang] (flush at the wall on the near side, same as every
  // plain piece), so its own center already sits past the cabinet's true half-depth by half the
  // overhang. Works at any wall angle (cycle 017): "away from the wall" IS the local depth axis,
  // which wallRotationY below maps onto wall.inward regardless of the wall's own direction.
  const sizeZ = cabinet.depth + COUNTER_OVERHANG;
  const sizeY = STANDARD.COUNTERTOP_THICKNESS;

  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  const material = new THREE.MeshLambertMaterial({ color: cssColor(COUNTER_MATERIALS[room.style.counter].cssVar) });
  const mesh = new THREE.Mesh(geometry, material);

  const { top: pieceTop } = cabinetVerticalPlacement(cabinet);
  mesh.position.copy(wallLocalToWorld(wall, cabinet.xOffset + sizeX / 2, sizeZ / 2, pieceTop + sizeY / 2));
  mesh.rotation.y = wallRotationY(wall);
  return mesh;
}
