/**
 * reference.mjs
 * ---------------------------------------------------------------------------
 * A reading window for classes and subclasses.
 *
 * Plutonium's picker shows names with nothing to read, which leaves a new
 * player choosing a class blind. This window fills that gap by listing what the
 * compendiums hold and showing the full description on click.
 *
 * IMPORTANT: this reads COMPENDIUMS. Plutonium fetches its own data at run time
 * and cannot be queried, so the two lists agree only as far as the enabled
 * books agree. With sources restricted to one Player's Handbook they match.
 */

import { MODULE_ID } from "./constants.mjs";
import { preserveScroll } from "./ui.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const KINDS = {
  class: { label: "Classes", types: ["class"] },
  subclass: { label: "Subclasses", types: ["subclass"] }
};

export class ClassReference extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    // Opened to the left so it does not land on top of the importer, which
    // Foundry centres. Both are ordinary windows and can be dragged.
    const vh = globalThis.innerHeight ?? 900;
    super({
      ...options,
      position: {
        width: 560,
        height: Math.max(480, vh - 80),
        left: 20,
        top: 40,
        ...(options.position ?? {})
      }
    });

    this.kind = options.kind ?? "class";
    this.selectedUuid = null;
    this._entries = {};
    this._detail = null;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-reference",
    tag: "div",
    classes: ["pk5e-creator"],
    window: { title: "Class reference", icon: "fa-solid fa-book-open", resizable: true },
    actions: {
      pickEntry: ClassReference.onPick,
      setKind: ClassReference.onSetKind
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/reference.hbs` }
  };

  /** Every entry of the current kind, from every Item compendium. */
  async getEntries(kind) {
    if (this._entries[kind]) return this._entries[kind];

    const types = KINDS[kind].types;
    const results = [];

    for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
      let index;
      try {
        index = await pack.getIndex({ fields: ["system.source.book", "system.source.rules"] });
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not index ${pack.collection}`, err);
        continue;
      }

      for (const entry of index) {
        if (!types.includes(entry.type)) continue;
        const source = entry.system?.source ?? {};
        results.push({
          uuid: `Compendium.${pack.collection}.${entry._id}`,
          name: entry.name,
          img: entry.img || "icons/svg/book.svg",
          origin: source.book || source.custom || pack.metadata.label,
          search: `${entry.name} ${pack.metadata.label}`.toLowerCase()
        });
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin));
    this._entries[kind] = results;
    return results;
  }

  async _prepareContext() {
    const entries = await this.getEntries(this.kind);
    return {
      kinds: Object.entries(KINDS).map(([key, config]) => ({
        key,
        label: config.label,
        active: key === this.kind
      })),
      list: entries.map((entry) => ({ ...entry, selected: entry.uuid === this.selectedUuid })),
      empty: entries.length === 0,
      detail: this._detail,
      selected: entries.find((entry) => entry.uuid === this.selectedUuid) ?? null
    };
  }

  _onRender() {
    preserveScroll(this, [".pk5e-options", ".pk5e-detail-col"]);

    const search = this.element.querySelector("[data-search]");
    if (!search) return;
    search.addEventListener("input", (ev) => {
      const query = ev.currentTarget.value.trim().toLowerCase();
      this.element.querySelectorAll(".pk5e-option").forEach((node) => {
        node.style.display = !query || node.dataset.search.includes(query) ? "" : "none";
      });
    });
  }

  static async onSetKind(event, target) {
    this.kind = target.dataset.kind;
    this.selectedUuid = null;
    this._detail = null;
    this.render();
  }

  static async onPick(event, target) {
    const uuid = target.dataset.uuid;
    this.selectedUuid = uuid;
    this._detail = null;
    this.render();

    try {
      const doc = await fromUuid(uuid);
      const raw = doc?.system?.description?.value ?? "";
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      let html = raw
        ? await TE.enrichHTML(raw, { relativeTo: doc, secrets: false })
        : "<p><em>No description in the compendium.</em></p>";
      // Artwork from books the user may not own renders as a padlock.
      html = html
        .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
        .replace(/<img\b[^>]*>/gi, "");
      this._detail = html;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read ${uuid}`, err);
      this._detail = "<p><em>Could not read that entry.</em></p>";
    }
    this.render();
  }
}
