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
    // Restore the scroll offset after a bulk action rebuilt the list.
    const scroller = this.element.querySelector(".pk5e-src-groups");
    if (scroller && this._scrollTop) scroller.scrollTop = this._scrollTop;
    if (scroller) {
      scroller.addEventListener("scroll", () => {
        this._scrollTop = scroller.scrollTop;
      });
    }

    this.element.querySelectorAll("[data-pack]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const id = ev.currentTarget.dataset.pack;
        if (ev.currentTarget.checked) this.selection.add(id);
        else this.selection.delete(id);
        // Patch the counters in place instead of re-rendering, which would
        // reset both the scroll position and the search filter.
        this.refreshCounters();
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

  /** Updates the "n/m" labels without rebuilding the DOM. */
  refreshCounters() {
    const el = this.element;
    const total = el.querySelectorAll("[data-pack]").length;
    const summary = el.querySelector("[data-summary]");
    if (summary) {
      summary.textContent = `${this.selection.size} of ${total} compendiums enabled.`;
    }
    el.querySelectorAll(".pk5e-src-group").forEach((group) => {
      const boxes = Array.from(group.querySelectorAll("[data-pack]"));
      const on = boxes.filter((b) => this.selection.has(b.dataset.pack)).length;
      const counter = group.querySelector(".pk5e-src-count");
      if (counter) counter.textContent = `${on}/${boxes.length}`;
      const toggle = group.querySelector("[data-action='toggleGroup']");
      if (toggle) toggle.textContent = on === boxes.length ? "Deselect group" : "Select group";
    });
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
