// properties.ts — the selection-details panel. Three states: a piece selected (position/
// width/height/depth + delete), an ISLAND selected with no piece (length/orientation/position
// X/Y + delete island), or nothing selected (hint). Every edit routes through the store, which
// clamps/rejects the value and re-renders both views.
//
// Sectioned layout (cycle 012): identity / dimensions / position / message strip / danger zone,
// each its own .properties__section — restyled only, every sync/focus/gesture/message behavior
// below is unchanged from before the chrome rework.
//
// The panel rebuilds its DOM only when the SELECTED subject (piece id, or island id in island
// mode) changes. On other store updates it syncs values into the existing inputs, skipping
// whichever input is focused — so a store notify triggered by the user's own keystroke never
// steals focus or clobbers what they typed.

import { store, type EditOutcome } from "../model/store";
import type { Cabinet } from "../model/cabinet";
import {
  CABINET_FINISHES,
  DOOR_STYLES,
  resolveDoorStyle,
  resolveFinish,
  swatchModifierClass,
  type CabinetFinishKey,
  type DoorStyle,
} from "../model/finishes";
import { kindDefinition, pieceLabel } from "../model/kinds";
import { islandOrientation, type IslandOrientation, type Wall } from "../model/room";
import { formatInches } from "../model/units";

type Dimension = "width" | "height" | "depth";
const DIMENSIONS: Array<{ label: string; key: Dimension }> = [
  { label: "Width", key: "width" },
  { label: "Height", key: "height" },
  { label: "Depth", key: "depth" },
];

export class Properties {
  private currentId: string | null = null;
  private mode: "piece" | "island" | "empty" = "empty";
  private inputs = new Map<Dimension, HTMLInputElement>();
  private positionInput: HTMLInputElement | null = null;
  private islandLengthInput: HTMLInputElement | null = null;
  private islandOrientationSelect: HTMLSelectElement | null = null;
  private islandXInput: HTMLInputElement | null = null;
  private islandYInput: HTMLInputElement | null = null;
  private messageEl: HTMLElement | null = null;
  /** The identity caption (cycle 018: pieceLabel is now attribute-derived — a resize past
   * TALL_CABINET_MIN_HEIGHT or a door-style edit can change a SELECTED piece's own label
   * without changing WHICH piece is selected, so syncValues must re-derive it every notify,
   * not just at initial renderPiece time). */
  private typeEl: HTMLElement | null = null;
  private finishSwatchButtons: Array<{ button: HTMLButtonElement; key: CabinetFinishKey }> = [];
  private doorStyleButtons: Array<{ button: HTMLButtonElement; key: DoorStyle }> = [];

  constructor(private readonly host: HTMLElement) {
    this.host.classList.add("properties");
    store.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const cabinet = store.getSelectedCabinet();
    const wall = store.getSelectedWall();
    const island = !cabinet && wall && wall.kind === "island" ? wall : null;

    const nextMode: "piece" | "island" | "empty" = cabinet ? "piece" : island ? "island" : "empty";
    const nextId = cabinet ? cabinet.id : island ? island.id : null;

    if (nextMode === this.mode && nextId !== null && nextId === this.currentId) {
      if (cabinet) this.syncValues(cabinet);
      else if (island) this.syncIslandValues(island);
      return;
    }

    this.mode = nextMode;
    this.currentId = nextId;
    this.inputs.clear();
    this.positionInput = null;
    this.islandLengthInput = null;
    this.islandOrientationSelect = null;
    this.islandXInput = null;
    this.islandYInput = null;
    this.messageEl = null; // a selection change clears the feedback message (Part 4)
    this.typeEl = null;
    this.finishSwatchButtons = [];
    this.doorStyleButtons = [];
    this.host.replaceChildren();

    if (cabinet) {
      this.renderPiece(cabinet);
    } else if (island) {
      this.renderIsland(island);
    } else {
      const section = this.section();
      const hint = document.createElement("p");
      hint.className = "properties__hint";
      hint.textContent = "Select a cabinet or island to edit it.";
      section.appendChild(hint);
      this.host.appendChild(section);
    }
  }

  /** One .properties__section wrapper — every group of related fields gets its own, so the
   * panel reads as identity / dimensions / position / message / danger zone rather than one
   * long unbroken list. */
  private section(): HTMLElement {
    const section = document.createElement("div");
    section.className = "properties__section";
    return section;
  }

  // ---- Piece mode -----------------------------------------------------------

  private renderPiece(cabinet: Cabinet): void {
    const identity = this.section();
    const type = document.createElement("p");
    type.className = "properties__type";
    type.textContent = pieceLabel(cabinet);
    identity.appendChild(type);
    this.host.appendChild(identity);
    this.typeEl = type;

    const fields = this.section();
    fields.appendChild(this.positionField(cabinet));
    // Depth is meaningless for an opening — a window/door/doorway's "depth" is a nominal 4"
    // rendering artifact (see kinds.ts), not a real dimension the owner should be editing.
    const isOpening = kindDefinition(cabinet.kind, cabinet.type).opening === true;
    for (const dim of DIMENSIONS) {
      if (isOpening && dim.key === "depth") continue;
      fields.appendChild(this.field(dim.label, dim.key, cabinet));
    }
    this.host.appendChild(fields);

    // Finish (cycle 014) — cabinet/filler kinds only; appliances/openings keep their fixed
    // colors and have nothing to override here.
    if (cabinet.kind === "cabinet" || cabinet.kind === "filler") {
      this.host.appendChild(this.finishSection(cabinet));
    }

    this.host.appendChild(this.messageSlot());

    const danger = this.section();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--danger btn--block";
    remove.textContent = "Delete cabinet";
    remove.addEventListener("click", () => store.deleteCabinet(cabinet.id));
    danger.appendChild(remove);
    this.host.appendChild(danger);
  }

  /**
   * "Finish" section (cycle 014): a cabinet-finish swatch row (cabinet/filler kinds), plus a
   * door-style segmented trio for real cabinets (a filler strip has no door of its own). Both
   * route through the new store mutations and can't fail — no message-slot wiring needed, same
   * as every other swatch/segmented click in this cycle.
   */
  private finishSection(cabinet: Cabinet): HTMLElement {
    const section = this.section();
    const room = store.getState().room!;

    const finishCaption = document.createElement("span");
    finishCaption.className = "properties__label";
    finishCaption.textContent = "Finish";
    section.appendChild(finishCaption);

    const swatchRow = document.createElement("div");
    swatchRow.className = "properties__swatch-row";
    const currentFinish = resolveFinish(room, cabinet);
    for (const key of Object.keys(CABINET_FINISHES) as CabinetFinishKey[]) {
      const entry = CABINET_FINISHES[key];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `swatch ${swatchModifierClass(entry.cssVar)}`;
      button.title = entry.label;
      button.setAttribute("aria-label", entry.label);
      const active = key === currentFinish;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => store.setPieceFinish(cabinet.id, key));
      this.finishSwatchButtons.push({ button, key });
      swatchRow.appendChild(button);
    }
    section.appendChild(swatchRow);

    if (cabinet.kind === "cabinet") {
      section.appendChild(this.doorStyleField(cabinet, resolveDoorStyle(room, cabinet)));
    }

    return section;
  }

  private doorStyleField(cabinet: Cabinet, currentDoorStyle: DoorStyle | null): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "properties__field";

    const caption = document.createElement("span");
    caption.className = "properties__label";
    caption.textContent = "Door style";
    wrapper.appendChild(caption);

    const group = document.createElement("div");
    group.className = "properties__segmented";
    for (const key of Object.keys(DOOR_STYLES) as DoorStyle[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--quiet properties__segmented-option";
      button.textContent = DOOR_STYLES[key].label;
      const active = key === currentDoorStyle;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => store.setPieceDoorStyle(cabinet.id, key));
      this.doorStyleButtons.push({ button, key });
      group.appendChild(button);
    }
    wrapper.appendChild(group);
    return wrapper;
  }

  private syncValues(cabinet: Cabinet): void {
    // Cycle 018: pieceLabel is attribute-derived (height/doorStyle), so a resize or door-style
    // edit on the SAME still-selected piece can change its own caption — re-derive every notify,
    // not just at the initial renderPiece. Plain text, no focus state to protect.
    if (this.typeEl) this.typeEl.textContent = pieceLabel(cabinet);
    if (this.positionInput && document.activeElement !== this.positionInput) {
      this.positionInput.value = formatInches(cabinet.xOffset);
    }
    for (const [key, input] of this.inputs) {
      if (document.activeElement === input) continue; // don't fight the user's typing
      input.value = formatInches(cabinet[key]);
    }

    // A preset click (or another piece's own applyPreset-triggered clear) can change this
    // piece's RESOLVED finish/door-style without changing WHICH piece is selected — resync the
    // swatch/trio highlight every notify, not just on a fresh selection.
    const room = store.getState().room;
    if (!room) return;
    const currentFinish = resolveFinish(room, cabinet);
    for (const entry of this.finishSwatchButtons) {
      const active = entry.key === currentFinish;
      entry.button.classList.toggle("is-selected", active);
      entry.button.setAttribute("aria-pressed", String(active));
    }
    const currentDoorStyle = cabinet.kind === "cabinet" ? resolveDoorStyle(room, cabinet) : null;
    for (const entry of this.doorStyleButtons) {
      const active = entry.key === currentDoorStyle;
      entry.button.classList.toggle("is-selected", active);
      entry.button.setAttribute("aria-pressed", String(active));
    }
  }

  /** A field-editing session (focus -> blur) is ONE undo step, not one per keystroke — see
   * store.beginGesture. Wired on every number input in this panel (position, dimensions,
   * island length/X/Y); the island orientation SELECT doesn't need it (a single discrete
   * change, not a typing session). */
  private wireGesture(input: HTMLInputElement): void {
    input.addEventListener("focus", () => store.beginGesture());
    input.addEventListener("blur", () => store.endGesture());
  }

  /** THE single feedback channel (cycle 011 Part 4): one message strip, created once per
   * selection and updated in place by every field that can partially honor an edit (push
   * falling short, a clamp, a rejected rotation). Shows the outcome's reason when the edit
   * didn't fully succeed; clears on a clean edit or (via render()'s reset) a selection change. */
  private messageSlot(): HTMLElement {
    const message = document.createElement("p");
    message.className = "properties__message";
    this.messageEl = message;
    return message;
  }

  private setMessage(outcome: EditOutcome): void {
    if (!this.messageEl) return;
    this.messageEl.textContent = outcome.reason ?? "";
    this.messageEl.classList.toggle("is-visible", !outcome.achieved && !!outcome.reason);
  }

  private positionField(cabinet: Cabinet): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "properties__field";

    const caption = document.createElement("span");
    caption.className = "properties__label";
    caption.textContent = "Position (in)";

    const input = document.createElement("input");
    input.className = "number-input";
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.value = formatInches(cabinet.xOffset);
    this.wireGesture(input);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value !== "" && Number.isFinite(value)) {
        this.setMessage(store.moveCabinet(cabinet.id, value));
      }
    });
    input.addEventListener("blur", () => {
      const current = store.getSelectedCabinet();
      if (current && current.id === cabinet.id) input.value = formatInches(current.xOffset);
    });

    this.positionInput = input;
    wrapper.append(caption, input);
    return wrapper;
  }

  private field(label: string, dimension: Dimension, cabinet: Cabinet): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "properties__field";

    const caption = document.createElement("span");
    caption.className = "properties__label";
    caption.textContent = `${label} (in)`;

    const input = document.createElement("input");
    input.className = "number-input";
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.value = formatInches(cabinet[dimension]);
    this.wireGesture(input);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value !== "" && Number.isFinite(value)) {
        this.setMessage(store.resizeCabinet(cabinet.id, { [dimension]: value }));
      }
    });
    // On blur, reflect the model's clamped value back into the field.
    input.addEventListener("blur", () => {
      const current = store.getSelectedCabinet();
      if (current && current.id === cabinet.id) input.value = formatInches(current[dimension]);
    });

    this.inputs.set(dimension, input);
    wrapper.append(caption, input);
    return wrapper;
  }

  // ---- Island mode ------------------------------------------------------------

  private renderIsland(island: Wall): void {
    const identity = this.section();
    const type = document.createElement("p");
    type.className = "properties__type";
    type.textContent = "Island";
    identity.appendChild(type);
    this.host.appendChild(identity);

    const dimensions = this.section();
    dimensions.appendChild(this.islandLengthField(island));
    dimensions.appendChild(this.islandOrientationField(island));
    this.host.appendChild(dimensions);

    const position = this.section();
    position.appendChild(this.islandPositionField("Position X (in)", island, "x"));
    position.appendChild(this.islandPositionField("Position Y (in)", island, "y"));
    this.host.appendChild(position);

    this.host.appendChild(this.messageSlot());

    const danger = this.section();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--danger btn--block";
    remove.textContent = "Delete island";
    remove.addEventListener("click", () => store.deleteIsland(island.id));
    danger.appendChild(remove);
    this.host.appendChild(danger);
  }

  private syncIslandValues(island: Wall): void {
    if (this.islandLengthInput && document.activeElement !== this.islandLengthInput) {
      this.islandLengthInput.value = formatInches(island.length);
    }
    if (this.islandOrientationSelect && document.activeElement !== this.islandOrientationSelect) {
      this.islandOrientationSelect.value = islandOrientation(island);
    }
    if (this.islandXInput && document.activeElement !== this.islandXInput) {
      this.islandXInput.value = formatInches(island.start.x);
    }
    if (this.islandYInput && document.activeElement !== this.islandYInput) {
      this.islandYInput.value = formatInches(island.start.y);
    }
  }

  private islandLengthField(island: Wall): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "properties__field";

    const caption = document.createElement("span");
    caption.className = "properties__label";
    caption.textContent = "Length (in)";

    const input = document.createElement("input");
    input.className = "number-input";
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.value = formatInches(island.length);
    this.wireGesture(input);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value !== "" && Number.isFinite(value)) {
        store.setIslandLength(island.id, value);
      }
    });
    input.addEventListener("blur", () => {
      const current = store.getSelectedWall();
      if (current && current.id === island.id) input.value = formatInches(current.length);
    });

    this.islandLengthInput = input;
    wrapper.append(caption, input);
    return wrapper;
  }

  private islandOrientationField(island: Wall): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "properties__field";

    const caption = document.createElement("span");
    caption.className = "properties__label";
    caption.textContent = "Orientation";

    const select = document.createElement("select");
    select.className = "number-input";
    const options: Array<{ value: IslandOrientation; label: string }> = [
      { value: "ew", label: "East-West" },
      { value: "ns", label: "North-South" },
    ];
    for (const opt of options) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }
    select.value = islandOrientation(island);
    select.addEventListener("change", () => {
      const outcome = store.setIslandOrientation(island.id, select.value as IslandOrientation);
      this.setMessage(outcome);
      // A rejected rotation never calls notify() (nothing changed), so nothing else will
      // resync this dropdown — reset it back to the TRUE orientation ourselves so it never
      // visually implies a rotation that didn't happen.
      if (!outcome.achieved) {
        const current = store.getSelectedWall();
        if (current) select.value = islandOrientation(current);
      }
    });

    this.islandOrientationSelect = select;
    wrapper.append(caption, select);
    return wrapper;
  }

  private islandPositionField(label: string, island: Wall, axis: "x" | "y"): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "properties__field";

    const caption = document.createElement("span");
    caption.className = "properties__label";
    caption.textContent = label;

    const input = document.createElement("input");
    input.className = "number-input";
    input.type = "number";
    input.step = "1";
    input.value = formatInches(island.start[axis]);
    this.wireGesture(input);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value === "" || !Number.isFinite(value)) return;
      this.setMessage(store.setIslandPosition(island.id, axis, value));
    });
    input.addEventListener("blur", () => {
      const current = store.getSelectedWall();
      if (current && current.id === island.id) input.value = formatInches(current.start[axis]);
    });

    if (axis === "x") this.islandXInput = input;
    else this.islandYInput = input;
    wrapper.append(caption, input);
    return wrapper;
  }
}
