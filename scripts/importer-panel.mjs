/**
 * importer-panel.mjs
 * ---------------------------------------------------------------------------
 * A narrow window that sits beside the importer's importer and shows what the
 * highlighted class or subclass actually does.
 *
 * The importer lists names and nothing else, which leaves a new player choosing
 * blind. The wide reference window solved that, but as a second thing to open,
 * read and close. This one follows along: click a name in the importer, read it
 * here, no extra step.
 *
 * When nothing matches - a book the player has enabled in the importer but that is
 * not in the compendiums - the dropdown stays available so they can pick
 * something themselves. That path narrows to the class the importer named, if
 * we hold it; otherwise it offers everything, because a list narrowed to
 * nothing is worse than no narrowing at all.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { preserveScroll, applyTheme } from "./ui.mjs";
import {
  loadClassIndex,
  groupByClass,
  matchImporterEntry,
  classIdForName,
  readDescription
} from "./compendium.mjs";
import { watchImporter, importerRect } from "./importer-watch.mjs";
import { watchForHost, stopWatchingHost, undockPanel } from "./dock.mjs";
import { describeRow } from "./class-text.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PANEL_WIDTH = 340;

export class ImporterPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    // v14 freezes options once super() has run, so the position has to be
    // worked out first and handed in.
    const vh = globalThis.innerHeight ?? 900;
    super({
      ...options,
      // The title has to go in here too: options are frozen after super().
      window: { title: t("panel.title"), ...(options.window ?? {}) },
      position: {
        width: PANEL_WIDTH,
        height: Math.max(420, vh - 120),
        ...ImporterPanel.beside(),
        ...(options.position ?? {})
      }
    });

    this.entries = [];
    this.groups = [];
    this.selectedUuid = null;
    this._detail = null;
    this._notice = null;
    this._listOpen = false;
    this._query = "";
    this._limitTo = null;
    this._stopWatching = null;
    this._stopDocking = null;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-importer-panel",
    tag: "div",
    classes: ["pk5e-creator", "pk5e-importer-panel"],
    window: { title: "Class descriptions", icon: "fa-solid fa-book-open", resizable: true },
    actions: {
      toggleList: ImporterPanel.onToggleList,
      pickEntry: ImporterPanel.onPick,
      clearPick: ImporterPanel.onClear
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/importer-panel.hbs` }
  };

  /**
   * A spot beside the importer rather than on top of it.
   *
   * The importer opens centred, so there is usually room to its left. If not,
   * the right. If neither, the left edge and let them overlap - a panel half
   * off-screen would be worse.
   */
  static beside() {
    const rect = importerRect();
    const vw = globalThis.innerWidth ?? 1400;
    const gap = 12;

    if (!rect) return { left: 20, top: 60 };
    if (rect.left >= PANEL_WIDTH + gap * 2) {
      return { left: Math.max(10, rect.left - PANEL_WIDTH - gap), top: Math.round(rect.top) };
    }
    if (vw - rect.right >= PANEL_WIDTH + gap * 2) {
      return { left: Math.round(rect.right + gap), top: Math.round(rect.top) };
    }
    return { left: 20, top: 60 };
  }

  static closeIfOpen() {
    try {
      const open = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
      if (open) open.close();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not close the importer panel`, err);
    }
  }

  async _prepareContext() {
    if (!this.entries.length) {
      this.entries = await loadClassIndex();
      this.groups = groupByClass(this.entries);
    }

    const query = this._query.trim().toLowerCase();
    const limit = this._limitTo;

    const visible = this.groups
      .map((group) => {
        // When a match failed we know the class even though we lack the entry,
        // so the list opens already narrowed to that class's subclasses.
        if (limit && group.key !== limit) return null;

        const headMatches = !query || group.name.toLowerCase().includes(query);
        const subclasses = group.subclasses.filter(
          (sub) => !query || headMatches || sub.name.toLowerCase().includes(query)
        );

        // A heading stays visible whenever anything under it survives the
        // filter: a bare list of domains with no Cleric above it means nothing.
        if (!headMatches && !subclasses.length) return null;

        return {
          key: group.key,
          name: group.name,
          uuid: group.entry?.uuid ?? null,
          selected: group.entry?.uuid === this.selectedUuid,
          subclasses: subclasses.map((sub) => ({
            uuid: sub.uuid,
            name: sub.name,
            origin: sub.origin,
            selected: sub.uuid === this.selectedUuid
          }))
        };
      })
      .filter(Boolean);

    const selected = this.entries.find((e) => e.uuid === this.selectedUuid) ?? null;

    return {
      groups: visible,
      listOpen: this._listOpen,
      query: this._query,
      limited: Boolean(limit),
      empty: !this.groups.length,
      notice: this._notice,
      detail: this._detail,
      selected,
      placeholder: t("panel.searchPlaceholder"),
      labels: {
        pick: t("panel.pick"),
        clear: t("panel.clear"),
        showAll: t("panel.showAll"),
        nothing: t("panel.nothing"),
        empty: t("panel.empty"),
        noResults: t("panel.noResults")
      }
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-panel-list", ".pk5e-panel-detail"]);

    const search = this.element.querySelector("[data-panel-search]");
    if (search) {
      search.addEventListener("input", (ev) => {
        this._query = ev.currentTarget.value;
        this._listOpen = true;
        this.render();
      });
      search.addEventListener("focus", () => {
        if (this._listOpen) return;
        this._listOpen = true;
        this.render();
      });
      // Redrawing moves the caret to the start, which makes typing impossible.
      if (this._listOpen && document.activeElement !== search) {
        const end = search.value.length;
        search.focus();
        search.setSelectionRange(end, end);
      }
    }

    if (!this._stopWatching) this.startWatching();

    // Re-docked on every render: Foundry rewrites position and size as inline
    // styles each time, and re-parents the element if it has been moved.
    if (!this._stopDocking && game.settings.get(MODULE_ID, "dockImporterPanel")) {
      this._stopDocking = watchForHost(this);
    }
  }

  /**
   * Leaves the importer's window before this one goes away.
   *
   * Without this the element would be torn down inside a window that knows
   * nothing about it, and the layout class would be left behind on a container
   * that no longer has a second column.
   */
  _onClose(options) {
    this._stopDocking?.();
    this._stopDocking = null;
    stopWatchingHost();
    try {
      undockPanel(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not undock the panel`, err);
    }
    return super._onClose?.(options);
  }

  /** Follows the importer until either it or this panel closes. */
  startWatching() {
    this._stopWatching = watchImporter({
      onSelect: (row) => this.follow(row),
      onClose: () => this.close()
    });
  }

  /**
   * Reacts to a row being highlighted in the importer.
   *
   * A hit shows the description straight away. A miss says so by name and
   * narrows the dropdown to that class, because "Artificer is not in your
   * compendiums" is useful information, while an empty panel just looks broken.
   */
  async follow(row) {
    // The rules data first: it covers every entry the importer lists, across
    // every book, which the compendiums cannot - they hold what was imported
    // into this world, and the importer offers 352 entries from all of them.
    // A player hovering Path of the Battlerager wants to know what it is, not
    // that it is absent from world.xphb.
    try {
      const described = await describeRow(row);
      if (described) {
        this._notice = null;
        this._limitTo = null;
        this._query = "";
        this._listOpen = false;
        this.selectedUuid = null;
        // The template renders the header from a compendium entry, which there
        // is no longer one of, so the heading travels with the body.
        this._detail =
          `<header class="pk5e-text-head"><h3>${described.title}</h3>` +
          `<span class="pk5e-panel-origin">${described.subtitle}</span></header>` +
          described.html;
        this.render();
        return;
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read "${row.name}" from the importer's rules data`, err);
    }

    // Falls back to the compendiums, which still work when the importer is not
    // loaded at all - the panel can be opened on its own.
    const match = matchImporterEntry(this.entries, row);

    if (match) {
      this._notice = null;
      this._limitTo = null;
      this._query = "";
      this._listOpen = false;
      await this.show(match.uuid);
      return;
    }

    const classKey = classIdForName(this.entries, row.parentName);
    const known = this.groups.some((group) => group.key === classKey);

    this.selectedUuid = null;
    this._detail = null;
    this._listOpen = false;
    this._query = "";
    this._limitTo = known ? classKey : null;
    this._notice = known
      ? t("panel.missingEntry", row.name, row.parentName)
      : t("panel.missingClass", row.parentName);

    this.render();
  }


  async show(uuid) {
    this.selectedUuid = uuid;
    this._detail = null;
    this.render();

    try {
      const html = await readDescription(uuid);
      this._detail = html ?? `<p><em>${t("panel.noDescription")}</em></p>`;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read ${uuid}`, err);
      this._detail = `<p><em>${t("panel.readError")}</em></p>`;
    }
    this.render();
  }

  async close(options = {}) {
    this._stopWatching?.();
    this._stopWatching = null;
    return super.close(options);
  }

  static onToggleList() {
    this._listOpen = !this._listOpen;
    this.render();
  }

  static onClear() {
    this._limitTo = null;
    this._query = "";
    this._notice = null;
    this._listOpen = true;
    this.render();
  }

  static async onPick(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    this._listOpen = false;
    this._notice = null;
    this._query = "";
    await this.show(uuid);
  }
}

/** Opens the panel, or brings the existing one forward. */
export function openImporterPanel() {
  const open = foundry.applications.instances?.get(ImporterPanel.DEFAULT_OPTIONS.id);
  if (open) {
    open.bringToFront?.();
    return open;
  }
  const panel = new ImporterPanel();
  panel.render(true);
  return panel;
}
