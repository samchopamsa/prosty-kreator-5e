/**
 * entry-picker.mjs
 * ---------------------------------------------------------------------------
 * The compendium route's replacement for the importer's own picking window.
 *
 * WHAT IT IS
 * ----------
 * A modal that opens from the step's button and does what the importer's window
 * does: a list to choose from on the left, what the entry actually says on the
 * right. On the importer route those two halves are two packages - its list,
 * and our narrow panel beside it (importer-panel.mjs) filling in the
 * descriptions it does not show. Here both halves are ours, so they sit in one
 * window and nothing has to follow anything else's highlight.
 *
 * WHY A MODAL RATHER THAN A LIST INSIDE THE STEP
 * ----------------------------------------------
 * A list in the step had no room for the description, and the description is
 * the point: choosing a class from thirteen names alone is the problem this
 * module exists to fix. The panel stays a summary of the character; choosing
 * happens in a window big enough to read in.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not add anything itself. Picking hands the entry to
 * add-from-compendium.mjs, which runs the system's own Advancement - the same
 * rule as everywhere else here: arrange the call, do not reimplement the work.
 *
 * Subclasses are not offered. The system asks for one through Advancement at
 * the level the class grants it, so a list of them here would invite adding one
 * loose, unattached to any class.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { preserveScroll, applyTheme } from "./ui.mjs";
import { loadCreationIndex, readDescription } from "./compendium.mjs";
import { addFromCompendium } from "./add-from-compendium.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Which item types each step may pick from.
 *
 * "race" and "species" are both listed because dnd5e renamed the type; a
 * library assembled over time holds both, and a player should not have to know
 * which of them their compendium happens to use.
 */
export const PICKER_TYPES = {
  class: ["class"],
  species: ["race", "species"],
  background: ["background"]
};

export class EntryPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    // Sized like the reading window, and for the same reason: the description
    // column is the point, and it needs room to be worth having.
    const vw = globalThis.innerWidth ?? 1400;
    const vh = globalThis.innerHeight ?? 900;
    const width = Math.min(860, Math.max(480, vw - 80));
    const height = Math.max(480, vh - 120);

    super({
      ...options,
      position: {
        ...(options.position ?? {}),
        width,
        height,
        left: Math.max(20, Math.round((vw - width) / 2)),
        top: Math.max(20, Math.round((vh - height) / 2))
      }
    });

    this.actorId = options.actorId ?? null;
    this.step = options.step ?? "class";
    /** uuid of the entry currently being read. */
    this.selected = null;
    this.detail = null;
    this.entries = null;
    /** Compendium being shown, or "" for all of them. */
    this.packFilter = "";
    this._adding = false;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-entry-picker",
    tag: "div",
    classes: ["pk5e-creator"],
    window: { title: "Choose", icon: "fa-solid fa-book-atlas", resizable: true },
    // Modal in the sense that matters: it is the only thing to answer while it
    // is up, and it closes as soon as the entry is on the character.
    modal: true,
    actions: {
      pickEntry: EntryPicker.onPick,
      confirm: EntryPicker.onConfirm,
      cancel: EntryPicker.onCancel
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/entry-picker.hbs` }
  };

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) : null;
  }

  get title() {
    return t(`picker.title.${this.step}`);
  }

  /** Opens the picker for one step, replacing any that is already up. */
  static open(actorId, step) {
    const existing = foundry.applications.instances?.get(EntryPicker.DEFAULT_OPTIONS.id);
    if (existing) existing.close();

    const picker = new EntryPicker({ actorId, step });
    picker.render(true);
    return picker;
  }

  static closeIfOpen() {
    try {
      const open = foundry.applications.instances?.get(EntryPicker.DEFAULT_OPTIONS.id);
      if (open) open.close();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not close the picker`, err);
    }
  }

  async _prepareContext() {
    const types = PICKER_TYPES[this.step] ?? PICKER_TYPES.class;

    if (this.entries === null) {
      try {
        const all = await loadCreationIndex();
        this.entries = all
          .filter((entry) => types.includes(entry.type))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not read the compendiums`, err);
        this.entries = [];
      }
    }

    const chosen = this.entries.find((entry) => entry.uuid === this.selected) ?? null;

    // Which compendiums these entries actually came from. Built from the
    // entries rather than from the settings, so a compendium that is selected
    // but holds no class does not appear as an option that empties the list.
    const packs = new Map();
    for (const entry of this.entries) {
      if (!packs.has(entry.packId)) packs.set(entry.packId, entry.packLabel);
    }

    const shown = this.packFilter
      ? this.entries.filter((entry) => entry.packId === this.packFilter)
      : this.entries;

    return {
      step: this.step,
      lead: t(`picker.lead.${this.step}`),
      // Only worth showing when there is something to narrow. One compendium
      // is not a choice.
      packs:
        packs.size > 1
          ? Array.from(packs, ([id, label]) => ({
              id,
              label,
              selected: id === this.packFilter
            })).sort((a, b) => a.label.localeCompare(b.label))
          : [],
      allPacksLabel: t("picker.allPacks"),
      entries: shown.map((entry) => ({
        uuid: entry.uuid,
        name: entry.name,
        img: entry.img,
        origin: entry.origin,
        selected: entry.uuid === this.selected,
        search: `${entry.name} ${entry.origin}`.toLowerCase()
      })),
      empty: shown.length === 0,
      emptyHint: this.packFilter ? t("picker.emptyFiltered") : t("picker.empty"),
      searchPlaceholder: t("picker.search", shown.length),
      selected: chosen,
      detail: this.detail,
      readingLabel: t("picker.reading"),
      placeholder: t("picker.placeholder"),
      confirmLabel: chosen ? t("picker.addNamed", chosen.name) : t("picker.add"),
      canConfirm: !!chosen && !this._adding,
      cancelLabel: t("picker.cancel")
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-options", ".pk5e-detail-col"]);

    this.element.querySelector("[data-pack-filter]")?.addEventListener("change", (ev) => {
      this.packFilter = ev.currentTarget.value;
      // A selection that the filter has just hidden would leave the right-hand
      // pane describing something no longer on the list.
      if (this.packFilter) {
        const stillShown = this.entries.some(
          (entry) => entry.uuid === this.selected && entry.packId === this.packFilter
        );
        if (!stillShown) {
          this.selected = null;
          this.detail = null;
        }
      }
      this.render();
    });

    // Filters rows already on the page rather than re-rendering, so the field
    // keeps focus and the caret between keystrokes.
    const search = this.element.querySelector("[data-search]");
    if (!search) return;
    search.addEventListener("input", (ev) => {
      const query = ev.currentTarget.value.trim().toLowerCase();
      for (const row of this.element.querySelectorAll(".pk5e-option")) {
        row.style.display = !query || (row.dataset.search ?? "").includes(query) ? "" : "none";
      }
    });
  }

  /** Reads the entry the player clicked, without committing to it. */
  static async onPick(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid || uuid === this.selected) return;

    this.selected = uuid;
    // Cleared first so the pane says "reading" rather than showing the previous
    // entry's text under the new entry's name.
    this.detail = null;
    this.render();

    let html = null;
    try {
      html = await readDescription(uuid);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read ${uuid}`, err);
    }

    // The player may have clicked something else while this was loading.
    if (this.selected !== uuid) return;
    this.detail = html;
    this.render();
  }

  static async onConfirm() {
    const actor = this.actor;
    if (!actor || !this.selected || this._adding) return;

    this._adding = true;
    this.render();

    let added = false;
    try {
      added = await addFromCompendium(actor, this.selected);
    } finally {
      this._adding = false;
    }

    // Closed only on success. A refusal - a second background, an unreadable
    // entry - leaves the window up with the reason already on screen, so the
    // player can pick something else without starting over.
    if (added) this.close();
    else this.render();
  }

  static onCancel() {
    this.close();
  }
}
