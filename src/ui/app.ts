// app.ts — builds the application shell (top bar, left catalog, center plan/elevation, right
// properties, bottom status bar) and wires up the views. Everything talks to the one store;
// this module owns no geometry and no duplicated state.

import { store } from "../model/store";
import { STANDARD } from "../model/bands";
import { PlanView } from "../views/planView";
import { ElevationView } from "../views/elevationView";
import { Filmstrip } from "../views/filmstrip";
import { Catalog } from "./catalog";
import { Properties } from "./properties";
import { showSavedWhisper, StatusBar } from "./statusbar";
import { createIcon } from "./icons";
import * as viewer3d from "../viewer3d/viewer3d";
import { load, save } from "../model/persistence";
import { BACKSPLASHES, CABINET_FINISHES, COUNTER_MATERIALS, FLOOR_MATERIALS, WALL_PAINTS } from "../model/finishes";
import { initKeymap, pageWall, wallAtOffset } from "./keymap";
import { defaultParamsFor, ROOM_SHAPES, type RoomShapeKey } from "../model/roomShapes";

// Sensible starting room for a first-time homeowner (inches). Not standard heights, so these
// UI defaults live here, not in bands.ts.
const DEFAULT_ROOM = { width: 120, length: 144, wallHeight: STANDARD.DEFAULT_WALL_HEIGHT };

// Dragging emits a store notify per pointermove (elevationView.ts), so autosave debounces
// rather than writing localStorage on every edit tick.
const AUTOSAVE_DEBOUNCE_MS = 300;

export function mountApp(root: HTMLElement): void {
  assertFinishVarsResolve();

  root.classList.add("app-shell");
  root.replaceChildren();

  root.appendChild(buildTopBar());

  const workspace = document.createElement("div");
  workspace.className = "workspace";
  const catalogHost = document.createElement("nav");
  workspace.appendChild(catalogHost);

  const main = document.createElement("main");
  main.className = "workspace__main";
  const planSurface = buildPanel(main, "panel--plan", "Plan view");
  const { surface: elevationSurface, filmstripHost } = buildElevationPanel(main);
  const propertiesSurface = buildPanel(main, "panel--properties", "Properties");
  workspace.appendChild(main);
  root.appendChild(workspace);

  const statusBarHost = document.createElement("footer");
  root.appendChild(statusBarHost);

  // Instantiate the pieces (each subscribes to the store itself).
  new Catalog(catalogHost);
  new PlanView(planSurface);
  new Filmstrip(filmstripHost);
  new ElevationView(elevationSurface);
  new Properties(propertiesSurface);
  new StatusBar(statusBarHost);

  // THE one command-key listener (cycle 015) — wired AFTER both views above, so their own
  // gesture-local Escape-abort handling (an extension of their existing Space-pan keydown
  // listener) registers first and always gets first refusal at the same keydown event; see
  // keymap.ts's module doc comment for why that ordering matters.
  initKeymap();

  // Restore the homeowner's last design if one was saved; otherwise seed a fresh, empty
  // default room. The room-setup form can resize (or, via Start over, replace) it any time.
  const saved = load();
  if (saved) {
    store.hydrate(saved.room, saved.roomShape);
    // Persist immediately (not just on the next edit): load() silently upgrades an older
    // schema version in memory (e.g. v1's filler flag -> kind:'filler'), but leaves the
    // on-disk copy untouched. Without this, a restored design that's never edited again
    // stays in the old on-disk shape indefinitely, and the same migration runs on every
    // future load. One explicit save here normalizes storage to the current schema right
    // after a successful restore, migrated or not.
    save(saved.room, saved.roomShape);
  } else {
    store.setRoom(DEFAULT_ROOM.width, DEFAULT_ROOM.length, DEFAULT_ROOM.wallHeight);
  }
  // Undo floor (cycle 015 audit #4): the hydrate/setRoom above just took its own checkpoint —
  // wipe both stacks now so a fresh page's Ctrl+Z is a no-op instead of popping that very
  // checkpoint and blanking the workspace (room: null).
  store.clearHistory();

  autosave();
}

/** Every store change silently persists the current room (+ its shape reference, cycle 017),
 * debounced so a drag's stream of pointermove-driven notifies doesn't hammer localStorage. Shows
 * the "Saved ✓" whisper (cycle 016 audit #A4) only after a write actually succeeds — a quota/
 * private-mode failure stays silent, exactly as it already did, and never claims a save that
 * didn't happen. */
function autosave(): void {
  let pending: number | undefined;
  store.subscribe(() => {
    const { room, roomShape } = store.getState();
    if (!room) return;
    if (pending !== undefined) clearTimeout(pending);
    pending = window.setTimeout(() => {
      if (save(room, roomShape)) showSavedWhisper();
    }, AUTOSAVE_DEBOUNCE_MS);
  });
}

/** One slim row: app name, compact room controls, and a right-aligned action cluster
 * (Undo/Redo icon buttons + the single accent-primary "See it in 3D" CTA). */
function buildTopBar(): HTMLElement {
  const topbar = document.createElement("header");
  topbar.className = "topbar";

  const title = document.createElement("h1");
  title.className = "topbar__title";
  title.textContent = "Casement";
  topbar.appendChild(title);

  topbar.appendChild(buildRoomForm());

  const spacer = document.createElement("div");
  spacer.className = "topbar__spacer";
  topbar.appendChild(spacer);

  const actions = document.createElement("div");
  actions.className = "topbar__actions";
  actions.appendChild(buildUndoRedoButtons());
  actions.appendChild(buildSee3dButton());
  topbar.appendChild(actions);

  return topbar;
}

/** Two icon buttons joining the shared .btn system (--quiet, since these live in the busy top
 * bar and shouldn't compete with the primary CTA). Disabled whenever their stack is empty;
 * re-evaluated on every store notify since undo()/redo() and every checkpointed edit route
 * through it. */
function buildUndoRedoButtons(): HTMLElement {
  const group = document.createElement("div");
  group.className = "topbar__undo-redo";

  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "btn btn--quiet";
  undo.title = "Undo (Ctrl+Z)";
  undo.setAttribute("aria-label", "Undo");
  undo.appendChild(createIcon("undo"));
  undo.addEventListener("click", () => store.undo());

  const redo = document.createElement("button");
  redo.type = "button";
  redo.className = "btn btn--quiet";
  redo.title = "Redo (Ctrl+Shift+Z)";
  redo.setAttribute("aria-label", "Redo");
  redo.appendChild(createIcon("redo"));
  redo.addEventListener("click", () => store.redo());

  const sync = () => {
    undo.disabled = !store.canUndo();
    redo.disabled = !store.canRedo();
  };
  store.subscribe(sync);
  sync();

  group.append(undo, redo);
  return group;
}

/**
 * Dev-only registry-resolution guard (cycle 015 audit #1): reads every finishes.ts registry
 * variable back from the LIVE parsed stylesheet via getComputedStyle and console.errors any
 * that resolve empty — a browser-time complement to finishCss.test.ts's static text check, for
 * whatever future class of "declared in TS, empty in the real CSS" bug a text parser wouldn't
 * anticipate. Stripped entirely from production builds (import.meta.env.DEV), zero runtime cost.
 */
function assertFinishVarsResolve(): void {
  if (!import.meta.env.DEV) return;
  const computed = getComputedStyle(document.documentElement);
  const registries = [CABINET_FINISHES, COUNTER_MATERIALS, FLOOR_MATERIALS, WALL_PAINTS, BACKSPLASHES];
  for (const registry of registries) {
    for (const entry of Object.values(registry)) {
      if (!computed.getPropertyValue(entry.cssVar).trim()) {
        console.error(`Finish CSS variable ${entry.cssVar} resolved empty — check styles.css`);
      }
    }
  }
}

function buildSee3dButton(): HTMLButtonElement {
  // A default room always exists after mountApp runs, so this is always enabled.
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--primary";
  button.append(createIcon("cube-3d"), document.createTextNode("See it in 3D"));
  button.addEventListener("click", () => viewer3d.open());
  return button;
}

/**
 * The room form (cycle 017): a shape picker (segmented .btn buttons, the SAME idiom
 * properties.ts's door-style trio uses — .properties__segmented/.properties__segmented-option,
 * aria-pressed, no new form controls) plus one number field per the active shape's own params
 * (rectangle: width/length; L-shape: + notch width/depth; etc.), built via the existing
 * numberField helper, and the shared Wall height field. Same "Resize room"/"Start over" pair as
 * before — Resize keeps cabinets (same-shape rebuild + reattach, confirmed if any would drop);
 * a SHAPE-PICKER click confirms separately ("Changing the room shape starts a new layout") and
 * is an immediate fresh start, not gated behind the submit button — same as properties.ts's own
 * segmented fields apply on click, not on a form submit.
 */
function buildRoomForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "room-form";

  const shapeButtons = new Map<RoomShapeKey, HTMLButtonElement>();
  const shapeGroupWrapper = document.createElement("label");
  shapeGroupWrapper.className = "room-form__field";
  const shapeCaption = document.createElement("span");
  shapeCaption.className = "room-form__label";
  shapeCaption.textContent = "Shape";
  shapeGroupWrapper.appendChild(shapeCaption);

  const shapeGroup = document.createElement("div");
  shapeGroup.className = "properties__segmented";
  for (const key of Object.keys(ROOM_SHAPES) as RoomShapeKey[]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--quiet properties__segmented-option";
    button.textContent = ROOM_SHAPES[key].label;
    button.addEventListener("click", () => handleShapeButtonClick(key));
    shapeButtons.set(key, button);
    shapeGroup.appendChild(button);
  }
  shapeGroupWrapper.appendChild(shapeGroup);
  form.appendChild(shapeGroupWrapper);

  // Per-shape dimension fields — rebuilt (not just re-synced) whenever the ACTIVE shape key
  // changes; while it stays the same, live-sync just updates values (focus-skipped) like any
  // other truthful field in this app.
  const shapeFieldsHost = document.createElement("div");
  shapeFieldsHost.className = "room-form__shape-fields";
  form.appendChild(shapeFieldsHost);
  let shapeFieldInputs = new Map<string, HTMLInputElement>();
  let renderedShapeKey: RoomShapeKey | null = null;

  const height = numberField(form, "Wall height (in)", DEFAULT_ROOM.wallHeight);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn";
  submit.textContent = "Resize room";
  form.appendChild(submit);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn btn--danger";
  reset.textContent = "Start over";
  form.appendChild(reset);

  function rebuildShapeFields(key: RoomShapeKey, params: Record<string, number>): void {
    shapeFieldsHost.replaceChildren();
    shapeFieldInputs = new Map();
    for (const field of ROOM_SHAPES[key].params) {
      const input = numberField(shapeFieldsHost, field.label, params[field.key] ?? field.default);
      shapeFieldInputs.set(field.key, input);
    }
    renderedShapeKey = key;
  }
  rebuildShapeFields("rectangle", defaultParamsFor("rectangle")); // first-paint default; the
  // store notify right after boot's setRoom/hydrate corrects this if the restored room differs.

  /** Read the form's current typed params for the shape it's presently showing fields for,
   * falling back to the CURRENT room's own value per field on invalid input (the form tells the
   * truth about errors too — same posture readDimensions always had). */
  function readShapeParams(): Record<string, number> {
    const currentParams = store.getState().roomShape?.params ?? {};
    const params: Record<string, number> = {};
    for (const field of ROOM_SHAPES[renderedShapeKey ?? "rectangle"].params) {
      const input = shapeFieldInputs.get(field.key);
      const fallback = currentParams[field.key] ?? field.default;
      params[field.key] = clampDimension(Number(input?.value), fallback, field.min);
    }
    return params;
  }

  function readWallHeight(): number {
    const room = store.getState().room;
    return clampDimension(Number(height.value), room?.wallHeight ?? DEFAULT_ROOM.wallHeight, 12);
  }

  /** A shape-picker click: the SAME shape is a no-op (already selected); a DIFFERENT shape
   * confirms ("Changing the room shape starts a new layout") — cross-shape wall correspondence
   * is ambiguous, so this is a fresh start, not a resize, same "Start over" idiom/message
   * posture as the reset button. Declining leaves everything exactly as it was. */
  function handleShapeButtonClick(key: RoomShapeKey): void {
    const currentKey = store.getState().roomShape?.key;
    if (key === currentKey) return;
    if (!window.confirm("Changing the room shape starts a new layout.")) return;
    store.setRoomShape(key, defaultParamsFor(key), readWallHeight());
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = readShapeParams();
    const h = readWallHeight();

    const { droppedCount } = store.previewResize(params, h);
    if (droppedCount > 0) {
      const plural = droppedCount === 1 ? "" : "s";
      const message = `${droppedCount} cabinet${plural} won't fit the new size and will be removed. Resize anyway?`;
      if (!window.confirm(message)) return;
    }
    store.resizeRoom(params, h);
  });

  reset.addEventListener("click", () => {
    if (!window.confirm("This clears your design and starts a new room.")) return;
    const key = store.getState().roomShape?.key ?? "rectangle";
    store.setRoomShape(key, readShapeParams(), readWallHeight());
  });

  // Live-sync: reflect the actual room's shape/params into the fields (rebuilding the field set
  // when the shape itself changed), skipping whichever input is focused — the same
  // activeElement-check pattern properties.ts uses so a store notify never clobbers what the
  // homeowner is mid-typing. Also keeps the shape picker's own selected state truthful.
  store.subscribe(() => {
    const { room, roomShape } = store.getState();
    if (!room || !roomShape) return;

    for (const [key, button] of shapeButtons) {
      const active = key === roomShape.key;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    }

    if (roomShape.key !== renderedShapeKey) {
      rebuildShapeFields(roomShape.key, roomShape.params);
    } else {
      for (const field of ROOM_SHAPES[roomShape.key].params) {
        const input = shapeFieldInputs.get(field.key);
        if (input && document.activeElement !== input) input.value = String(roomShape.params[field.key]);
      }
    }
    if (document.activeElement !== height) height.value = String(room.wallHeight);
  });

  return form;
}

function numberField(host: HTMLElement, label: string, value: number): HTMLInputElement {
  const wrapper = document.createElement("label");
  wrapper.className = "room-form__field";

  const caption = document.createElement("span");
  caption.className = "room-form__label";
  caption.textContent = label;

  const input = document.createElement("input");
  input.className = "number-input";
  input.type = "number";
  input.min = "12";
  input.step = "1";
  input.value = String(value);

  wrapper.append(caption, input);
  host.appendChild(wrapper);
  return input;
}

function buildPanel(parent: HTMLElement, modifier: string, title: string): HTMLElement {
  const panel = document.createElement("section");
  panel.className = `panel ${modifier}`;

  const heading = document.createElement("h2");
  heading.className = "panel__title";
  heading.textContent = title;
  panel.appendChild(heading);

  const surface = document.createElement("div");
  surface.className = "panel__surface";
  panel.appendChild(surface);

  parent.appendChild(panel);
  return surface;
}

/**
 * The elevation panel (cycle 016 Part B3): the same panel/title/surface shell as buildPanel,
 * plus a prev/next wall-paging nav cluster inside the title (a plain text span + the nav div
 * are both children of .panel__title, which is why that class gained space-between/flex — a
 * single text child there still lays out identically to before) and the filmstrip strip between
 * the header and the actual elevation surface.
 */
function buildElevationPanel(parent: HTMLElement): { surface: HTMLElement; filmstripHost: HTMLElement } {
  const panel = document.createElement("section");
  panel.className = "panel panel--elevation";

  const heading = document.createElement("h2");
  heading.className = "panel__title";
  const label = document.createElement("span");
  label.textContent = "Elevation view";
  heading.appendChild(label);

  const nav = document.createElement("div");
  nav.className = "panel__title-nav";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "btn btn--quiet";
  prevBtn.setAttribute("aria-label", "Previous wall");
  prevBtn.appendChild(createIcon("chevron-left"));
  prevBtn.addEventListener("click", () => pageWall(-1));

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "btn btn--quiet";
  nextBtn.setAttribute("aria-label", "Next wall");
  nextBtn.appendChild(createIcon("chevron-right"));
  nextBtn.addEventListener("click", () => pageWall(1));

  nav.append(prevBtn, nextBtn);
  heading.appendChild(nav);
  panel.appendChild(heading);

  // Tooltip = target wall name, re-evaluated on every store change (a piece add/delete never
  // changes wall order, but a Start-over or a room resize can).
  const sync = () => {
    const prevWall = wallAtOffset(-1);
    const nextWall = wallAtOffset(1);
    prevBtn.title = prevWall ? `Previous: ${prevWall.label}` : "";
    prevBtn.disabled = !prevWall;
    nextBtn.title = nextWall ? `Next: ${nextWall.label}` : "";
    nextBtn.disabled = !nextWall;
  };
  store.subscribe(sync);
  sync();

  const filmstripHost = document.createElement("div");
  panel.appendChild(filmstripHost);

  const surface = document.createElement("div");
  surface.className = "panel__surface";
  panel.appendChild(surface);

  parent.appendChild(panel);
  return { surface, filmstripHost };
}

/** A room/shape dimension must be a positive, sensible number of inches; fall back to a given
 * default (the current room's own value, wherever the caller has one) on invalid input. */
function clampDimension(value: number, fallback: number, min = 12): number {
  if (!Number.isFinite(value) || value < min) return fallback;
  return value;
}
