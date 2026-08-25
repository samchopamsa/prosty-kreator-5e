/**
 * reference-config.mjs
 * ---------------------------------------------------------------------------
 * Chooses which compendiums the reference window reads.
 *
 * Deliberately the only place selection happens: which classes and subclasses
 * appear is decided by what you put in the compendium, not by a second list
 * kept here. Compendium ids survive re-imports; individual entry ids do not.
 */

import { MODULE_ID } from "./constants.mjs";
import { preserveScroll, applyTheme } from "./ui.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Every compendium holding Items. */
export function itemPacks() {
  return game.packs.filter((p) => p.documentName === "Item");
}

function packOrigin(pack) {
  switch (pack.metadata.packageType) {
    case "system":
      return "System";
    case "world":
      return "World";
    default:
      return `Module: ${pack.metadata.packageName ?? "?"}`;
  }
}

/**
 * Ids of the compendiums to read. An empty selection means "every compendium",
 * so the window is useful before anything has been configured.
 */
export function referencePackIds() {
  // The GM can be exempt from the restriction, mirroring the importer's separate
  // switches for players and GMs: players read a curated set, the GM sees
  // everything installed.
  if (game.user?.isGM && game.settings.get(MODULE_ID, "referenceGmSeesAll")) {
    return itemPacks().map((p) => p.collection);
  }

  const saved = game.settings.get(MODULE_ID, "referencePacks") ?? [];
  if (Array.isArray(saved) && saved.length) return saved;
  return itemPacks().map((p) => p.collection);
}

export function referenceIsConfigured() {
  const saved = game.settings.get(MODULE_ID, "referencePacks") ?? [];
  return Array.isArray(saved) && saved.length > 0;
}

export class ReferenceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    const saved = game.settings.get(MODULE_ID, "referencePacks") ?? [];
    this.selection = new Set(saved);
    this.onSaved = options.onSaved ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-reference-config",
    tag: "div",
    classes: ["pk5e-creator"],
    window: {
      title: "Reference: compendiums to read",
      icon: "fa-solid fa-book-open",
      resizable: true
    },
    position: { width: 560, height: 640 },
    actions: {
      selectAll: ReferenceConfig.onSelectAll,
      selectNone: ReferenceConfig.onSelectNone,
      save: ReferenceConfig.onSave
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/reference-config.hbs` }
  };

  async _prepareContext() {
    const packs = itemPacks().map((pack) => ({
      id: pack.collection,
      label: pack.metadata.label,
      origin: packOrigin(pack),
      folders: pack.folders?.size ?? 0,
      checked: this.selection.has(pack.collection),
      search: `${pack.metadata.label} ${pack.collection}`.toLowerCase()
    }));

    packs.sort((a, b) => a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label));

    return {
      packs,
      total: packs.length,
      selected: this.selection.size,
      usingAll: this.selection.size === 0
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-pane", ".pk5e-packs"]);

    this.element.querySelectorAll("[data-pack]").forEach((box) => {
      box.addEventListener("change", (ev) => {
        const id = ev.currentTarget.dataset.pack;
        if (ev.currentTarget.checked) this.selection.add(id);
        else this.selection.delete(id);
        this.refreshCounter();
      });
    });

    const search = this.element.querySelector("[data-search]");
    if (!search) return;
    search.addEventListener("input", (ev) => {
      const query = ev.currentTarget.value.trim().toLowerCase();
      this.element.querySelectorAll(".pk5e-pack").forEach((row) => {
        row.style.display = !query || row.dataset.search.includes(query) ? "" : "none";
      });
    });
  }

  /** Updates the tally in place, so ticking a box does not rebuild the list. */
  refreshCounter() {
    const node = this.element.querySelector("[data-summary]");
    if (!node) return;
    const total = this.element.querySelectorAll("[data-pack]").length;
    node.textContent = this.selection.size
      ? `${this.selection.size} of ${total} compendiums selected.`
      : `Nothing selected - all ${total} compendiums will be read.`;
  }

  static onSelectAll() {
    for (const pack of itemPacks()) this.selection.add(pack.collection);
    this.render();
  }

  static onSelectNone() {
    this.selection.clear();
    this.render();
  }

  static async onSave() {
    await game.settings.set(MODULE_ID, "referencePacks", Array.from(this.selection));
    ui.notifications.info(
      this.selection.size
        ? `Reference will read ${this.selection.size} compendium(s).`
        : "Reference will read every compendium."
    );
    if (this.onSaved) this.onSaved();
    this.close();
  }
}
