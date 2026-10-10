// catalog.ts — the left catalog panel: Cabinets / Fill / Appliances / Openings / Island /
// Templates, as labeled icon+label sections (cycle 012 — replaces the old wrapped toolbar's
// role, retiring the queued catalog-panel item). Every behavior here is carried over VERBATIM
// from the old palette.ts + ui/templates.ts: the same store calls, the same disable/tooltip
// logic (width-aware fit checks, push-feasibility, canPlaceOn island rules, template confirm).
// This module restyles; it does not reimplement.
//
// No silent no-ops: every fill button hard-disables when no wall is selected, OR the selected
// wall's kind can't accept that piece ("Can't place on an island"), OR no free gap (plain or
// push) fits that specific piece — each with a tooltip stating why. Draggable add rows (cabinets/
// appliances/openings, cycle 015) stay soft-disabled instead — aria-disabled + a tooltip, never
// the real `disabled` attribute — so dragging one onto a wall works before any wall is even
// selected; only a CLICK on one of THOSE while unfit reports the reason (via the status bar),
// rather than silently doing nothing.

import { store, type PieceOverrides } from "../model/store";
import { MIN_DIMENSION, type CabinetType } from "../model/cabinet";
import {
  BACKSPLASHES,
  CABINET_FINISHES,
  COUNTER_MATERIALS,
  CUSTOM_PRESET,
  FLOOR_MATERIALS,
  PRESETS,
  swatchModifierClass,
  WALL_PAINTS,
  type PresetKey,
  type SurfaceCategory,
} from "../model/finishes";
import { anchorBottomFor, APPLIANCE_KIND_LIST, canPlaceOn, kindDefinition, type PieceKind } from "../model/kinds";
import { firstFittingGap } from "../model/occupancy";
import { planInsertWithPush } from "../model/push";
import { TEMPLATES, type TemplateKey } from "../model/templates";
import { catalogDrag } from "./catalogDrag";
import { createIcon, type IconName } from "./icons";
import { setTransientHint } from "./statusbar";

const DEFAULT_ADD_WIDTH = 24;
/** Tall-cabinet variant preset height (cycle 016 Part C) — a full-height pantry column; the
 * model already clamps this to the ceiling via the existing create/resize height clamp. */
const TALL_CABINET_HEIGHT = 90;
const CANT_PLACE_ON_ISLAND = "Can't place on an island";
/** Minimum pointer travel (px) before a pointerdown on an add-row becomes a drag rather than a
 * plain click — small enough that a real drag always crosses it, large enough that a click's
 * natural hand jitter never does. Click-to-add stays untouched: a native "click" only fires when
 * pointerup lands back on the button, which never happens once the pointer has moved into a
 * view's canvas, so no explicit suppression is needed either way. */
const DRAG_THRESHOLD_PX = 4;

/** Icon for each of the four templates — one map, no bespoke per-template branching. */
const TEMPLATE_ICONS: Record<TemplateKey, IconName> = {
  "single-wall": "template-single-wall",
  galley: "template-galley",
  "l-shape": "template-l-shape",
  "u-shape": "template-u-shape",
};

/** Icon for each appliance/opening kind — a plain lookup except wall-oven, whose glyph is
 * named "oven-stack" (matching its catalog label, "Oven stack") rather than its kind string. */
const APPLIANCE_ICONS: Record<Exclude<PieceKind, "cabinet" | "filler">, IconName> = {
  fridge: "fridge",
  range: "range",
  dishwasher: "dishwasher",
  sink: "sink",
  hood: "hood",
  "wall-oven": "oven-stack",
  window: "window",
  door: "door",
  doorway: "doorway",
};

interface FitCheckedButton {
  button: HTMLButtonElement;
  kind: PieceKind;
  band: CabinetType;
  /** Resolves the width to check/add with at click/render time — dynamic for the two plain
   * cabinet buttons (the shared width input), fixed for every appliance/opening button. */
  width: () => number;
  /** Variant preset (cycle 016 Part C1) — carried through to store.addCabinet/addCabinetAt at
   * create; never consulted by the fit check itself (a tall cabinet's fit check uses the SAME
   * base-band vertical range a plain base cabinet would, matching the existing manual-resize
   * workflow this row replaces — see kinds.ts's own history). */
  overrides?: PieceOverrides;
}

export class Catalog {
  private readonly fitCheckedButtons: FitCheckedButton[] = [];
  private readonly fillButtons: Array<{ button: HTMLButtonElement; band: CabinetType; label: Text }> = [];
  private readonly widthInput: HTMLInputElement;
  private readonly presetButtons: Array<{ button: HTMLButtonElement; key: PresetKey }> = [];
  private styleCustomCaption: HTMLElement | null = null;
  private readonly surfaceButtons: Record<SurfaceCategory, Array<{ button: HTMLButtonElement; key: string }>> = {
    counter: [],
    floor: [],
    walls: [],
    backsplash: [],
  };

  constructor(host: HTMLElement) {
    host.classList.add("catalog");

    // Build sections FIRST, Style LAST (cycle 018 audit friction #1): at a first-timer's
    // 1280x720 launch, the Style section's 6 presets + 4 swatch rows pushed every build
    // section below the fold (Base cabinet at y~764) — a paint chooser ahead of the entire
    // build vocabulary. Pure reorder of these constructor calls; zero new UI/behavior, since
    // `section()` just appends to `host` in call order.
    const cabinetsSection = this.section(host, "Cabinets");
    this.widthInput = this.makeWidthInput();
    const widthField = document.createElement("label");
    widthField.className = "catalog__width-field";
    const widthCaption = document.createElement("span");
    widthCaption.textContent = "Width (in)";
    widthField.append(widthCaption, this.widthInput);
    cabinetsSection.appendChild(widthField);
    cabinetsSection.appendChild(
      this.makeAddButton("base-cabinet", "Base cabinet", "cabinet", "base", () => this.widthValue()),
    );
    cabinetsSection.appendChild(
      this.makeAddButton("wall-cabinet", "Wall cabinet", "cabinet", "wall", () => this.widthValue()),
    );
    // Catalog vocabulary round-out (cycle 016 Part C): three variant presets on the SAME
    // cabinet kind — height/doorStyle overrides applied at create, carried through both add
    // paths. The model already fully supports each one; these rows just make them discoverable.
    cabinetsSection.appendChild(
      this.makeAddButton("tall-cabinet", "Tall cabinet", "cabinet", "base", () => this.widthValue(), {
        height: TALL_CABINET_HEIGHT,
      }),
    );
    cabinetsSection.appendChild(
      this.makeAddButton("glass-upper", "Glass upper", "cabinet", "wall", () => this.widthValue(), {
        doorStyle: "glass",
      }),
    );
    cabinetsSection.appendChild(
      this.makeAddButton("open-shelf", "Open shelf", "cabinet", "wall", () => this.widthValue(), {
        doorStyle: "open",
      }),
    );

    const fillSection = this.section(host, "Fill");
    fillSection.appendChild(this.makeFillButton("base"));
    fillSection.appendChild(this.makeFillButton("wall"));

    const applianceSection = this.section(host, "Appliances");
    const openingSection = this.section(host, "Openings");
    for (const kind of APPLIANCE_KIND_LIST) {
      // Band is irrelevant to the lookup for appliance/opening kinds (each has its own fixed
      // band in the catalog, and kindDefinition ignores the passed value for them) — "base"
      // here is just a harmless placeholder. Openings get their OWN section, not Appliances —
      // they're wall features, not fixtures.
      const def = kindDefinition(kind, "base");
      const section = def.opening ? openingSection : applianceSection;
      section.appendChild(
        this.makeAddButton(APPLIANCE_ICONS[kind], def.label, kind, def.band, () => def.defaultSize.width),
      );
    }

    const islandSection = this.section(host, "Island");
    const addIslandButton = document.createElement("button");
    addIslandButton.type = "button";
    addIslandButton.className = "btn catalog__row";
    addIslandButton.append(createIcon("island"), textNode("Add island"));
    addIslandButton.addEventListener("click", () => store.addIsland());
    islandSection.appendChild(addIslandButton);

    const templatesSection = this.section(host, "Templates");
    for (const key of Object.keys(TEMPLATES) as TemplateKey[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn catalog__row";
      button.append(createIcon(TEMPLATE_ICONS[key]), textNode(TEMPLATES[key].label));
      button.addEventListener("click", () => this.applyTemplate(key));
      templatesSection.appendChild(button);
    }

    // Style LAST — see the reorder comment at the top of this constructor.
    this.buildStyleSection(host);

    this.widthInput.addEventListener("input", () => this.render());
    store.subscribe(() => this.render());
    this.render();
  }

  private section(host: HTMLElement, title: string): HTMLElement {
    const section = document.createElement("div");
    section.className = "catalog__section";
    const heading = document.createElement("h3");
    heading.className = "catalog__section-title";
    heading.textContent = title;
    section.appendChild(heading);
    host.appendChild(section);
    return section;
  }

  /**
   * "Style" section (cycle 014) — the homeowner's front door: 6 one-click preset rows, then 4
   * room-surface swatch rows (Floor/Walls/Counter/Backsplash). Cabinet finish + door style live
   * per-piece in the properties panel instead (not here — a room-wide cabinet-finish control
   * would fight with per-piece overrides; the preset is the only place that sets it room-wide).
   */
  private buildStyleSection(host: HTMLElement): void {
    const section = this.section(host, "Style");
    // Shown only once the room's style has diverged from the last preset actually clicked
    // (style.preset === "custom") — so this section never claims a bundle the room no longer
    // wears (cycle 015 audit #3).
    const customCaption = document.createElement("span");
    customCaption.className = "catalog__custom-caption";
    customCaption.textContent = "Custom";
    section.appendChild(customCaption);
    this.styleCustomCaption = customCaption;
    for (const key of Object.keys(PRESETS) as PresetKey[]) {
      section.appendChild(this.makePresetRow(key));
    }
    section.appendChild(this.makeSurfaceRow("Floor", "floor", FLOOR_MATERIALS, this.surfaceButtons.floor));
    section.appendChild(this.makeSurfaceRow("Walls", "walls", WALL_PAINTS, this.surfaceButtons.walls));
    section.appendChild(this.makeSurfaceRow("Counter", "counter", COUNTER_MATERIALS, this.surfaceButtons.counter));
    section.appendChild(
      this.makeSurfaceRow("Backsplash", "backsplash", BACKSPLASHES, this.surfaceButtons.backsplash),
    );
  }

  /** One preset row: the existing catalog row-button pattern, with a decorative (non-interactive
   * — the ROW is the button) swatch chip standing in for an icon. */
  private makePresetRow(key: PresetKey): HTMLButtonElement {
    const bundle = PRESETS[key];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn catalog__row";
    const chip = document.createElement("span");
    chip.className = `swatch ${swatchModifierClass(CABINET_FINISHES[bundle.cabinetFinish].cssVar)}`;
    chip.setAttribute("aria-hidden", "true");
    button.append(chip, textNode(bundle.label));
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => store.applyPreset(key));
    this.presetButtons.push({ button, key });
    return button;
  }

  /** One room-surface row: a label + a wrapped strip of standalone swatch buttons (real
   * <button>s, per the interaction spec) — clicking one sets that surface room-wide. */
  private makeSurfaceRow(
    label: string,
    category: SurfaceCategory,
    registry: Record<string, { label: string; cssVar: string }>,
    tracking: Array<{ button: HTMLButtonElement; key: string }>,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "catalog__swatch-row";

    const caption = document.createElement("span");
    caption.className = "catalog__swatch-row-label";
    caption.textContent = label;
    row.appendChild(caption);

    const chips = document.createElement("div");
    chips.className = "catalog__swatch-row-chips";
    for (const key of Object.keys(registry)) {
      const entry = registry[key];
      const button = this.makeSwatchButton(entry.cssVar, entry.label);
      button.addEventListener("click", () => store.setRoomSurface(category, key));
      tracking.push({ button, key });
      chips.appendChild(button);
    }
    row.appendChild(chips);
    return row;
  }

  private makeSwatchButton(cssVar: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `swatch ${swatchModifierClass(cssVar)}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    return button;
  }

  private applyTemplate(key: TemplateKey): void {
    const hasCabinets = store.getState().room?.walls.some((wall) => wall.cabinets.length > 0) ?? false;
    if (hasCabinets && !window.confirm("Replace the current layout?")) return;
    store.applyTemplate(key);
  }

  private widthValue(): number {
    const value = Number(this.widthInput.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADD_WIDTH;
  }

  private makeWidthInput(): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "number-input";
    input.type = "number";
    input.min = String(MIN_DIMENSION);
    input.step = "1";
    input.value = String(DEFAULT_ADD_WIDTH);
    return input;
  }

  private makeAddButton(
    icon: IconName,
    label: string,
    kind: PieceKind,
    band: CabinetType,
    width: () => number,
    overrides?: PieceOverrides,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn catalog__row catalog__row--${band}`;
    button.append(createIcon(icon), textNode(label));
    // Click-add gates VISUALLY only (aria-disabled, cycle 015) — never the real disabled
    // attribute, which would also block the drag below. An unfittable click still DOES
    // something: it fires the same reason the row's tooltip already shows, rather than a
    // silent no-op.
    button.addEventListener("click", () => {
      const reason = this.fitReason(kind, band, width());
      if (reason) {
        setTransientHint(reason);
        return;
      }
      store.addCabinet(kind, band, width(), overrides);
    });
    this.wireDrag(button, kind, band, width, overrides);
    this.fitCheckedButtons.push({ button, kind, band, width, overrides });
    return button;
  }

  /**
   * Pointer-based custom drag (cycle 013) — NOT HTML5 drag-and-drop. pointerdown starts tracking;
   * only once the pointer crosses DRAG_THRESHOLD_PX does it become a real drag (catalogDrag.start),
   * so a plain click's own hand jitter never triggers one. window-level listeners (not the
   * button's own) since the drag travels far outside the button once started; Escape cancels.
   * Startable whenever ANY room exists (cycle 015) — NOT gated on a selected wall or a fit check;
   * the drag ghost's own validity (rendered by each view against the live cursor position)
   * governs whether a drop actually lands, exactly like a drag aimed anywhere else already does.
   */
  private wireDrag(
    button: HTMLButtonElement,
    kind: PieceKind,
    band: CabinetType,
    width: () => number,
    overrides?: PieceOverrides,
  ): void {
    let pointerId: number | null = null;
    let startClientX = 0;
    let startClientY = 0;
    let started = false;

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeydown);
      pointerId = null;
      started = false;
    };

    const onMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      if (!started) {
        const dx = event.clientX - startClientX;
        const dy = event.clientY - startClientY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        started = true;
        catalogDrag.start({ mode: "add", spec: { kind, band, width: width(), overrides } }, event.clientX, event.clientY);
      } else {
        catalogDrag.move(event.clientX, event.clientY);
      }
    };

    const onUp = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      if (started) catalogDrag.drop();
      cleanup();
    };

    const onCancel = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      if (started) catalogDrag.cancel();
      cleanup();
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pointerId !== null) {
        catalogDrag.cancel();
        cleanup();
      }
    };

    button.addEventListener("pointerdown", (event) => {
      if (!store.getState().room) return;
      pointerId = event.pointerId;
      startClientX = event.clientX;
      startClientY = event.clientY;
      started = false;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKeydown);
    });
  }

  private makeFillButton(band: CabinetType): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn catalog__row catalog__row--${band}`;
    const label = textNode(`Fill wall: ${band}`);
    button.append(createIcon("fill"), label);
    button.addEventListener("click", () => store.fillWall(band));
    this.fillButtons.push({ button, band, label });
    return button;
  }

  /**
   * Would adding `kind`/`band` at `width` succeed right now — null if so, else the reason a
   * tooltip/transient hint should show. THE one fit check both render()'s soft-disable styling
   * AND a click on an unfittable row consult, so they can never disagree (cycle 015 audit #7).
   */
  private fitReason(kind: PieceKind, band: CabinetType, width: number): string | null {
    const wall = store.getSelectedWall();
    const room = store.getState().room;
    if (!wall || !room) return "Select a wall first";
    if (!canPlaceOn(wall.kind, kind, band)) return CANT_PLACE_ON_ISLAND;

    const def = kindDefinition(kind, band);
    const bottom = anchorBottomFor({ kind, type: def.band });
    const verticalRange = { bottom, top: bottom + def.defaultSize.height };
    const gap = firstFittingGap(room, wall, verticalRange, def.defaultSize.depth, width);
    // A plain gap is the common case; when none fits, the piece can still land via push
    // (planInsertWithPush) — this must report "fits" ONLY when NEITHER works, or it would
    // flag exactly the cases push was added to solve.
    const fits = gap !== null || planInsertWithPush(room, wall, verticalRange, def.defaultSize.depth, width) !== null;
    return fits ? null : `No space for a ${width}" piece on this wall`;
  }

  private render(): void {
    const wall = store.getSelectedWall();
    const room = store.getState().room;

    for (const entry of this.fitCheckedButtons) {
      // Soft-disable only (cycle 015 audit #7) — these rows stay draggable even when unfit; the
      // drag ghost's own validity governs the drop. See fitReason for what a click reports.
      this.setSoftDisabled(entry.button, this.fitReason(entry.kind, entry.band, entry.width()));
    }

    // Cycle 016 audit #A5: the fill rows re-label for an island ("Fill island: base/wall")
    // instead of always claiming "wall" — the base row is the actionable one on an island; the
    // wall row is relabeled too, for consistency, even though canPlaceOn always disables it there.
    const fillNoun = wall?.kind === "island" ? "island" : "wall";
    for (const entry of this.fillButtons) {
      entry.label.data = `Fill ${fillNoun}: ${entry.band}`;
      if (!wall) {
        this.setDisabled(entry.button, "Select a wall first");
      } else if (!canPlaceOn(wall.kind, "cabinet", entry.band)) {
        this.setDisabled(entry.button, CANT_PLACE_ON_ISLAND);
      } else {
        this.setDisabled(entry.button, null);
      }
    }

    const style = room?.style;
    for (const entry of this.presetButtons) {
      const active = style?.preset === entry.key;
      entry.button.classList.toggle("is-selected", active);
      entry.button.setAttribute("aria-pressed", String(active));
    }
    this.styleCustomCaption?.classList.toggle("is-visible", style?.preset === CUSTOM_PRESET);
    this.syncSwatchRow(this.surfaceButtons.floor, style?.floor);
    this.syncSwatchRow(this.surfaceButtons.walls, style?.walls);
    this.syncSwatchRow(this.surfaceButtons.counter, style?.counter);
    this.syncSwatchRow(this.surfaceButtons.backsplash, style?.backsplash);
  }

  private syncSwatchRow(entries: Array<{ button: HTMLButtonElement; key: string }>, activeKey: string | undefined): void {
    for (const entry of entries) {
      const active = entry.key === activeKey;
      entry.button.classList.toggle("is-selected", active);
      entry.button.setAttribute("aria-pressed", String(active));
    }
  }

  /** True hard-disable — fill/island/template rows (no drag semantics) keep this unchanged. */
  private setDisabled(button: HTMLButtonElement, reason: string | null): void {
    button.disabled = reason !== null;
    button.title = reason ?? "";
  }

  /** Visual-only disable (cycle 015 audit #7) — draggable add rows. NEVER sets the real
   * `disabled` attribute (that would also block the drag's own pointerdown); aria-disabled +
   * the shared muted-look CSS rule communicate the same "can't add this way right now" state,
   * while the tooltip keeps stating why. */
  private setSoftDisabled(button: HTMLButtonElement, reason: string | null): void {
    if (reason !== null) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
    button.title = reason ?? "";
  }
}

function textNode(text: string): Text {
  return document.createTextNode(text);
}
