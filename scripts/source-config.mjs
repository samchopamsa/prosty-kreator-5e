/**
 * source-config.mjs
 * ---------------------------------------------------------------------------
 * GM-only screen for choosing which compendiums the creator reads from.
 * Registered as a settings menu, and reachable from the wizard's Start step.
 */

import { MODULE_ID, getPackGroups, getEnabledPackIds, getItemPacks } from "./sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SourceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.selection = new Set(getEnabledPackIds());
    this.onSaved = options.onSaved ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-sources",
    tag: "div",
    classes: ["pk5e-creator"],
    window: {
      title: "Character Creator: Compendium Sources",
      icon: "fa-solid fa-book",
      resizable: true
    },
    position: { width: 620, height: 700 },
    actions: {
      selectAll: SourceConfig.onSelectAll,
      selectNone: SourceConfig.onSelectNone,
      toggleGroup: SourceConfig.onToggleGroup,
      save: SourceConfig.onSave
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/sources.hbs` }
  };

  async _prepareContext() {
    const groups = getPackGroups().map((g) => ({
      ...g,
      packs: g.packs.map((p) => ({ ...p, checked: this.selection.has(p.id) }))
    }));
    for (const g of groups) {
      g.checkedCount = g.packs.filter((p) => p.checked).length;
      g.allChecked = g.checkedCount === g.packs.length;
    }
    return {
      groups,
      total: getItemPacks().length,
      selected: this.selection.size
    };
  }

  _onRender() {
    this.element.querySelectorAll("[data-pack]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const id = ev.currentTarget.dataset.pack;
        if (ev.currentTarget.checked) this.selection.add(id);
        else this.selection.delete(id);
        this.render();
      });
    });

    const search = this.element.querySelector("[data-search]");
    if (search) {
      search.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLowerCase();
        this.element.querySelectorAll(".pk5e-src-group").forEach((group) => {
          let visible = 0;
          group.querySelectorAll(".pk5e-pack").forEach((row) => {
            const match = !q || row.dataset.search.includes(q);
            row.style.display = match ? "" : "none";
            if (match) visible += 1;
          });
          group.style.display = visible ? "" : "none";
        });
      });
    }
  }

  static onSelectAll() {
    for (const pack of getItemPacks()) this.selection.add(pack.collection);
    this.render();
  }

  static onSelectNone() {
    this.selection.clear();
    this.render();
  }

  static onToggleGroup(event, target) {
    const groupEl = target.closest(".pk5e-src-group");
    if (!groupEl) return;
    const ids = Array.from(groupEl.querySelectorAll("[data-pack]")).map(
      (cb) => cb.dataset.pack
    );
    const allOn = ids.every((id) => this.selection.has(id));
    for (const id of ids) {
      if (allOn) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.render();
  }

  static async onSave() {
    await game.settings.set(MODULE_ID, "enabledPacks", Array.from(this.selection));
    ui.notifications.info(`Character Creator: ${this.selection.size} compendium(s) enabled.`);
    if (this.onSaved) this.onSaved();
    this.close();
  }
}
