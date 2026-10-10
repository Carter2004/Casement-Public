// persistence.test.ts — the minimum test net for the serialization/migration chain. Tests the
// PURE core (migrateIfNeeded, isValidPayload — string/object in, object/boolean out) rather
// than mocking a browser: per the test plan, if save()/load() aren't separable from
// localStorage, factor and test the pure part. One end-to-end test at the bottom DOES exercise
// the real save()/load() together, using a minimal in-memory localStorage shim (a plain
// getItem/setItem object) rather than any browser-emulation library — proof the public API
// composes correctly, on top of the unit-level coverage above it.

import { beforeEach, describe, expect, it } from "vitest";
import { isValidPayload, load, migrateIfNeeded, save } from "./persistence";
import { createCabinet } from "./cabinet";
import { roomStyleForPreset } from "./finishes";
import { createIsland, createRectangularRoom } from "./room";

function v1Payload() {
  return {
    version: 1,
    room: { width: 120, length: 144, wallHeight: 96 },
    cabinetsByWall: {
      "wall-0": [
        { type: "base", xOffset: 0, width: 36, height: 34.5, depth: 24 },
        { type: "base", xOffset: 36, width: 12, height: 34.5, depth: 24, filler: true },
        { type: "wall", xOffset: 0, width: 36, height: 30, depth: 12 },
      ],
      "wall-1": [],
      "wall-2": [],
      "wall-3": [],
    },
  };
}

function v2Payload() {
  return {
    version: 2,
    room: { width: 120, length: 144, wallHeight: 96 },
    cabinetsByWall: {
      "wall-0": [
        { kind: "cabinet", type: "base", xOffset: 0, width: 36, height: 34.5, depth: 24 },
        { kind: "filler", type: "base", xOffset: 36, width: 12, height: 34.5, depth: 24 },
        { kind: "fridge", type: "base", xOffset: 48, width: 36, height: 70, depth: 30 },
      ],
      "wall-1": [],
      "wall-2": [],
      "wall-3": [],
    },
  };
}

function v3IslandPayload() {
  return {
    version: 3,
    room: { width: 120, length: 144, wallHeight: 96 },
    cabinetsByWall: { "wall-0": [], "wall-1": [], "wall-2": [], "wall-3": [] },
    islands: [
      {
        x: 24,
        y: 60,
        orientation: "ew",
        length: 72,
        cabinets: [{ kind: "sink", type: "base", xOffset: 0, width: 36, height: 34.5, depth: 24 }],
      },
    ],
  };
}

/** cycle 014's v4 shape: a v3 payload plus room.style and (optionally) per-cabinet
 * finish/doorStyle overrides. */
function v4IslandPayload() {
  return {
    ...v3IslandPayload(),
    version: 4,
    room: { width: 120, length: 144, wallHeight: 96, style: roomStyleForPreset("classic-white") },
  };
}

const V5_FOOTPRINT = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
  { x: 120, y: 144 },
  { x: 0, y: 144 },
];

/** cycle 017's v5 shape: room.width/length replaced by a footprint, plus the optional
 * roomShape{key,params} form-truthfulness aid. */
function v5IslandPayload() {
  return {
    version: 5,
    room: { footprint: V5_FOOTPRINT, wallHeight: 96, style: roomStyleForPreset("classic-white") },
    roomShape: { key: "rectangle", params: { width: 120, length: 144 } },
    cabinetsByWall: { "wall-0": [], "wall-1": [], "wall-2": [], "wall-3": [] },
    islands: [
      {
        x: 24,
        y: 60,
        orientation: "ew",
        length: 72,
        cabinets: [{ kind: "sink", type: "base", xOffset: 0, width: 36, height: 34.5, depth: 24 }],
      },
    ],
  };
}

describe("stepwise migration", () => {
  it("migrates v1 -> v5 (chained through v2/v3/v4): filler:true becomes kind:'filler', a footprint replaces width/length, islands added", () => {
    const migrated = migrateIfNeeded(v1Payload()) as any;
    expect(migrated.version).toBe(5);
    expect(migrated.islands).toEqual([]);
    expect(migrated.room.footprint).toEqual(V5_FOOTPRINT);
    expect(migrated.roomShape).toEqual({ key: "rectangle", params: { width: 120, length: 144 } });
    expect(migrated.cabinetsByWall["wall-0"]).toEqual([
      { kind: "cabinet", type: "base", xOffset: 0, width: 36, height: 34.5, depth: 24 },
      { kind: "filler", type: "base", xOffset: 36, width: 12, height: 34.5, depth: 24 },
      { kind: "cabinet", type: "wall", xOffset: 0, width: 36, height: 30, depth: 12 },
    ]);
    expect(isValidPayload(migrated)).toBe(true);
  });

  it("migrates v2 -> v5 (chained through v3/v4): kinds pass through unchanged, islands:[] is added, a footprint replaces width/length", () => {
    const migrated = migrateIfNeeded(v2Payload()) as any;
    expect(migrated.version).toBe(5);
    expect(migrated.islands).toEqual([]);
    expect(migrated.room.footprint).toEqual(V5_FOOTPRINT);
    expect(migrated.cabinetsByWall["wall-0"]).toEqual(v2Payload().cabinetsByWall["wall-0"]);
    expect(isValidPayload(migrated)).toBe(true);
  });

  it("migrates v4 -> v5: width/length become a footprint, roomShape:{key:'rectangle',...} is added, no piece touched", () => {
    const migrated = migrateIfNeeded(v4IslandPayload()) as any;
    expect(migrated.version).toBe(5);
    expect(migrated.room.footprint).toEqual(V5_FOOTPRINT);
    expect(migrated.roomShape).toEqual({ key: "rectangle", params: { width: 120, length: 144 } });
    expect(migrated.room.style).toEqual(roomStyleForPreset("classic-white"));
    expect(migrated.islands).toEqual(v4IslandPayload().islands);
    expect(isValidPayload(migrated)).toBe(true);
  });

  it("a v5 payload passes through migrateIfNeeded unchanged", () => {
    const payload = v5IslandPayload();
    expect(migrateIfNeeded(payload)).toEqual(payload);
  });
});

describe("rejection classes", () => {
  it("rejects a malformed v1 payload (bad cabinet shape) rather than partially migrating it", () => {
    const bad = v1Payload();
    (bad.cabinetsByWall["wall-0"][0] as any).width = -5; // negative width, invalid
    expect(migrateIfNeeded(bad)).toBeNull();
  });

  it("rejects a malformed v4 payload (bad style) rather than partially migrating it to v5", () => {
    const bad = v4IslandPayload();
    (bad.room.style as any).preset = "espresso-kitchen";
    expect(migrateIfNeeded(bad)).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(isValidPayload("not an object")).toBe(false);
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload(42)).toBe(false);
  });

  it("rejects a v4-shaped payload directly (width/length instead of a footprint) — version mismatch alone rejects it", () => {
    expect(isValidPayload(v4IslandPayload())).toBe(false);
  });

  it("rejects negative/non-finite wallHeight", () => {
    const payload = v5IslandPayload();
    (payload.room as any).wallHeight = -10;
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects an unknown piece kind", () => {
    const payload = v5IslandPayload();
    (payload.islands[0].cabinets[0] as any).kind = "espresso-machine";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects a wall-band kind on an island (a hood can't live on an island)", () => {
    const payload = v5IslandPayload();
    payload.islands[0].cabinets[0] = {
      kind: "hood",
      type: "wall",
      xOffset: 0,
      width: 36,
      height: 18,
      depth: 20,
    } as any;
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects an opening on an island (a crafted payload can't smuggle a door onto a deck)", () => {
    const payload = v5IslandPayload();
    payload.islands[0].cabinets[0] = {
      kind: "door",
      type: "base",
      xOffset: 0,
      width: 36,
      height: 80,
      depth: 4,
    } as any;
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects an invalid island orientation", () => {
    const payload = v5IslandPayload();
    (payload.islands[0] as any).orientation = "diagonal";
    expect(isValidPayload(payload)).toBe(false);
  });
});

describe("malformed-footprint rejection (cycle 017)", () => {
  it("rejects a footprint with fewer than 3 vertices", () => {
    const payload = v5IslandPayload();
    (payload.room as any).footprint = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects a self-intersecting footprint (a bowtie)", () => {
    const payload = v5IslandPayload();
    (payload.room as any).footprint = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects a footprint with an edge shorter than MIN_EDGE_LENGTH", () => {
    const payload = v5IslandPayload();
    (payload.room as any).footprint = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 100 }, { x: 0, y: 100 }];
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects a non-array footprint", () => {
    const payload = v5IslandPayload();
    (payload.room as any).footprint = "not an array";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects cabinetsByWall referencing a wall index outside the loaded footprint's vertex count (wall-7 on a 4-vertex rectangle)", () => {
    const payload = v5IslandPayload();
    (payload.cabinetsByWall as any)["wall-7"] = [];
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects a malformed wall id key entirely (not the wall-N shape)", () => {
    const payload = v5IslandPayload();
    (payload.cabinetsByWall as any)["north-wall"] = [];
    expect(isValidPayload(payload)).toBe(false);
  });

  it("accepts a valid L-shaped footprint with matching wall-0..5 keys", () => {
    const payload = v5IslandPayload();
    (payload.room as any).footprint = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    (payload as any).cabinetsByWall = {
      "wall-0": [],
      "wall-1": [],
      "wall-2": [],
      "wall-3": [],
      "wall-4": [],
      "wall-5": [],
    };
    (payload as any).roomShape = { key: "l-shape", params: { width: 200, length: 200, notchWidth: 100, notchLength: 100 } };
    expect(isValidPayload(payload)).toBe(true);
  });
});

describe("roomShape rejection (cycle 017)", () => {
  it("rejects an unknown shape key", () => {
    const payload = v5IslandPayload();
    (payload.roomShape as any).key = "hexagon";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects a non-finite param value", () => {
    const payload = v5IslandPayload();
    (payload.roomShape as any).params = { width: NaN, length: 144 };
    expect(isValidPayload(payload)).toBe(false);
  });

  it("accepts a payload with no roomShape at all (optional — an older migrated save or a hand-crafted payload)", () => {
    const payload = v5IslandPayload();
    delete (payload as any).roomShape;
    expect(isValidPayload(payload)).toBe(true);
  });
});

describe("island round-trip shape", () => {
  it("a well-formed v3 payload with an island migrates and validates cleanly under v5", () => {
    // Direct isValidPayload no longer accepts a bare v3 (or v4) payload (cycle 017 bumped
    // SCHEMA_VERSION to 5) — the well-formed-payload-loads-cleanly guarantee this test encodes
    // now routes through migrateIfNeeded first, same as load() itself does (same posture cycle
    // 014's own equivalent test established when it bumped v3 -> v4).
    expect(isValidPayload(migrateIfNeeded(v3IslandPayload()))).toBe(true);
  });

  it("a well-formed v4 payload with an island migrates and validates cleanly under v5", () => {
    expect(isValidPayload(migrateIfNeeded(v4IslandPayload()))).toBe(true);
  });

  it("a well-formed v5 payload with an island validates cleanly", () => {
    expect(isValidPayload(v5IslandPayload())).toBe(true);
  });
});

describe("save/load end-to-end (minimal localStorage shim, not a browser mock)", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
  });

  it("round-trips a perimeter wall's doorway through save() then load() — no version bump needed", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.walls[0].cabinets.push(createCabinet("doorway", "base", 24));

    save(room, { key: "rectangle", params: { width: 120, length: 144 } });
    const restored = load();

    expect(restored).not.toBeNull();
    const doorway = restored!.room.walls[0].cabinets.find((c) => c.kind === "doorway");
    expect(doorway).toBeDefined();
    expect(doorway!.xOffset).toBe(24);
    expect(doorway!.width).toBe(48);
  });

  it("round-trips a room with an island through save() then load()", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.walls[0].cabinets.push(createCabinet("cabinet", "base", 0));

    const island = createIsland(room, 72, "ew");
    island.start = { x: 24, y: 60 };
    island.cabinets.push(createCabinet("sink", "base", 0));
    room.walls.push(island);

    save(room);
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.room.width).toBe(120);
    const restoredIsland = restored!.room.walls.find((w) => w.kind === "island");
    expect(restoredIsland).toBeDefined();
    expect(restoredIsland!.start).toEqual({ x: 24, y: 60 });
    expect(restoredIsland!.length).toBe(72);
    expect(restoredIsland!.cabinets).toHaveLength(1);
    expect(restoredIsland!.cabinets[0].kind).toBe("sink");
  });

  it("returns null for malformed JSON without throwing", () => {
    store["casement.design"] = "{not valid json";
    expect(load()).toBeNull();
  });

  it("round-trips room.style and a per-cabinet finish/doorStyle override through save() then load()", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.style = { ...room.style, preset: "farmhouse", cabinetFinish: "sage", floor: "dark-walnut" };
    const cabinet = createCabinet("cabinet", "base", 0);
    cabinet.finish = "navy";
    cabinet.doorStyle = "glass";
    room.walls[0].cabinets.push(cabinet);

    save(room);
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.room.style).toEqual(room.style);
    const restoredCabinet = restored!.room.walls[0].cabinets[0];
    expect(restoredCabinet.finish).toBe("navy");
    expect(restoredCabinet.doorStyle).toBe("glass");
  });

  it("a piece with no finish/doorStyle override round-trips as still absent (falls back to room default)", () => {
    const room = createRectangularRoom(120, 144, 96);
    room.walls[0].cabinets.push(createCabinet("cabinet", "base", 0));

    save(room);
    const restored = load();

    expect(restored!.room.walls[0].cabinets[0].finish).toBeUndefined();
    expect(restored!.room.walls[0].cabinets[0].doorStyle).toBeUndefined();
  });

  it("round-trips the roomShape reference (form truthfulness after reload)", () => {
    const room = createRectangularRoom(150, 130, 96);
    save(room, { key: "rectangle", params: { width: 150, length: 130 } });
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.roomShape).toEqual({ key: "rectangle", params: { width: 150, length: 130 } });
  });

  it("a restored rectangle room keeps its North/East/South/West labels, not the general path's 'Wall N'", () => {
    const room = createRectangularRoom(120, 144, 96);
    save(room, { key: "rectangle", params: { width: 120, length: 144 } });
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.room.walls.map((w) => w.label)).toEqual(["North", "East", "South", "West"]);
  });

  it("a save with no roomShape argument round-trips with roomShape: null", () => {
    const room = createRectangularRoom(120, 144, 96);
    save(room);
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.roomShape).toBeNull();
  });

  it("loads a bare v1-schema save all the way through to a usable v5 room (the full chain, end to end)", () => {
    store["casement.design"] = JSON.stringify(v1Payload());
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.room.width).toBe(120);
    expect(restored!.room.length).toBe(144);
    expect(restored!.roomShape).toEqual({ key: "rectangle", params: { width: 120, length: 144 } });
    expect(restored!.room.walls[0].cabinets).toHaveLength(3);
  });
});

describe("legacy-key rescue (cycle 018 [HIGH]: the rename orphaned every pre-rename design)", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
  });

  it("a legacy v4 design loads intact when the new key is empty, and ends up saved under the new key once re-saved (app.ts's existing post-load save())", () => {
    store["cabinet-studio.design"] = JSON.stringify(v4IslandPayload());
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.room.width).toBe(120);
    expect(restored!.room.length).toBe(144);
    expect(restored!.room.walls[0].cabinets).toEqual([]);
    expect(restored!.room.walls.find((w) => w.kind === "island")?.cabinets).toHaveLength(1);

    // The exact pattern app.ts's mountApp already runs after every successful load() —
    // proving the rescued design ends up under the new key via the SAME single write path,
    // no second one added for this case.
    save(restored!.room, restored!.roomShape);
    expect(store["casement.design"]).toBeDefined();
    const resaved = JSON.parse(store["casement.design"]);
    expect(resaved.version).toBe(5);
    // Left in place (locked decision) — a rollback safety net, harmless once self-retired.
    expect(store["cabinet-studio.design"]).toBeDefined();
  });

  it("legacy garbage (malformed JSON) with an empty new key falls through cleanly — null, no throw", () => {
    store["cabinet-studio.design"] = "{not valid json at all";
    expect(() => load()).not.toThrow();
    expect(load()).toBeNull();
  });

  it("legacy payload failing validation (bad style) with an empty new key also falls through cleanly", () => {
    const bad = v4IslandPayload();
    (bad.room.style as any).preset = "espresso-kitchen";
    store["cabinet-studio.design"] = JSON.stringify(bad);
    expect(load()).toBeNull();
  });

  it("when BOTH keys hold a valid design, the new key wins outright — the legacy key is never even read", () => {
    const room = createRectangularRoom(80, 90, 96);
    save(room, { key: "rectangle", params: { width: 80, length: 90 } }); // writes under casement.design
    store["cabinet-studio.design"] = JSON.stringify(v4IslandPayload()); // a DIFFERENT design (120x144)

    const restored = load();
    expect(restored).not.toBeNull();
    expect(restored!.room.width).toBe(80);
    expect(restored!.room.length).toBe(90);
  });

  it("a legacy v1 payload runs the FULL v1->v5 chain, same as under the new key", () => {
    store["cabinet-studio.design"] = JSON.stringify(v1Payload());
    const restored = load();

    expect(restored).not.toBeNull();
    expect(restored!.room.width).toBe(120);
    expect(restored!.room.length).toBe(144);
    expect(restored!.roomShape).toEqual({ key: "rectangle", params: { width: 120, length: 144 } });
    // The v1->v2 filler-flag transform ran: exactly one filler among the three pieces.
    expect(restored!.room.walls[0].cabinets.filter((c) => c.kind === "filler")).toHaveLength(1);
  });
});

describe("v3 -> v5 migration content (style defaulting, cycle 014, still exercised through the longer chain)", () => {
  it("gives every pre-finishes save the Classic White look, with no piece overrides", () => {
    const migrated = migrateIfNeeded(v3IslandPayload()) as any;
    expect(migrated.version).toBe(5);
    expect(migrated.room.style).toEqual(roomStyleForPreset("classic-white"));
    // v3 cabinets never had finish/doorStyle at all — migration doesn't invent any.
    expect(migrated.islands[0].cabinets[0].finish).toBeUndefined();
    expect(migrated.islands[0].cabinets[0].doorStyle).toBeUndefined();
  });

  it("chains a v1 payload all the way to v5 with the Classic White look", () => {
    const migrated = migrateIfNeeded(v1Payload()) as any;
    expect(migrated.version).toBe(5);
    expect(migrated.room.style).toEqual(roomStyleForPreset("classic-white"));
    expect(isValidPayload(migrated)).toBe(true);
  });
});

describe("v5 rejection: unknown style/finish keys", () => {
  it("rejects an unknown preset key", () => {
    const payload = v5IslandPayload();
    (payload.room.style as any).preset = "espresso-kitchen";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects an unknown room cabinetFinish key", () => {
    const payload = v5IslandPayload();
    (payload.room.style as any).cabinetFinish = "hot-pink";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects an unknown room doorStyle key", () => {
    const payload = v5IslandPayload();
    (payload.room.style as any).doorStyle = "louvered";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects an unknown counter/floor/wall/backsplash key", () => {
    const base = v5IslandPayload();
    expect(isValidPayload({ ...base, room: { ...base.room, style: { ...base.room.style, counter: "gold" } } })).toBe(
      false,
    );
    expect(isValidPayload({ ...base, room: { ...base.room, style: { ...base.room.style, floor: "lava" } } })).toBe(
      false,
    );
    expect(isValidPayload({ ...base, room: { ...base.room, style: { ...base.room.style, walls: "neon" } } })).toBe(
      false,
    );
    expect(
      isValidPayload({ ...base, room: { ...base.room, style: { ...base.room.style, backsplash: "chrome" } } }),
    ).toBe(false);
  });

  it("rejects an unknown per-cabinet finish override", () => {
    const payload = v5IslandPayload();
    (payload.islands[0].cabinets[0] as any).finish = "hot-pink";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("rejects an unknown per-cabinet doorStyle override", () => {
    const payload = v5IslandPayload();
    (payload.islands[0].cabinets[0] as any).doorStyle = "louvered";
    expect(isValidPayload(payload)).toBe(false);
  });

  it("still accepts a cabinet with no finish/doorStyle at all (both are optional)", () => {
    expect(isValidPayload(v5IslandPayload())).toBe(true);
  });
});
