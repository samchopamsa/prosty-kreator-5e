/**
 * reference.mjs
 * ---------------------------------------------------------------------------
 * A reading window for classes and subclasses.
 *
 * Plutonium's picker shows names with nothing to read, which leaves a new player
 * choosing a class blind. This window fills that gap from the compendiums.
 *
 * The tree mirrors the folder structure, MERGED BY FOLDER NAME across every
 * compendium being read. A "Barbarian" folder in one book's compendium and a
 * "Barbarian" folder in another become one branch, so the player sees a single
 * Barbarian with all its subclasses rather than one entry per book.
 *
 * IMPORTANT: this reads COMPENDIUMS. Plutonium fetches its own data at run time
 * and cannot be queried, so the two lists agree only as far as the enabled books
 * agree.
 */

import { MODULE_ID } from "./constants.mjs";
import { preserveScroll, applyTheme } from "./ui.mjs";
import { referencePackIds, ReferenceConfig, referenceIsConfigured } from "./reference-config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const WANTED_TYPES = ["class", "subclass"];

/**
 * Folder path of an entry as an array of names, e.g. ["Barbarian", "Subclasses"].
 * The parent field is a document in some versions and a plain id in others.
 */
function folderPath(pack, folderId) {
  const names = [];
  const guard = new Set();
  let current = folderId;

  while (current && !guard.has(current)) {
    guard.add(current);
    const folder = pack.folders?.get?.(current) ?? null;
    if (!folder) break;
    names.unshift(folder.name);
    const parent = folder.folder;
    current = typeof parent === "string" ? parent : parent?.id ?? null;
  }
  return names;
}

export class ClassReference extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    // Centred. It used to open hard left so it could sit beside the importer,
    // but that job belongs to the narrow panel now: this window is opened
    // deliberately, on its own, to browse.
    const vh = globalThis.innerHeight ?? 900;
    const vw = globalThis.innerWidth ?? 1400;
    // Wider than it was: the description column is the point of the window.
    const width = Math.min(860, Math.max(480, vw - 80));
    const height = Math.max(480, vh - 120);
    super({
      ...options,
      position: {
        width,
        height,
        left: Math.max(10, Math.round((vw - width) / 2)),
        top: Math.max(10, Math.round((vh - height) / 2)),
        ...(options.position ?? {})
      }
    });

    this.selectedUuid = null;
    this._detail = null;
    this._tree = null;
    this._open = {};
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-reference",
    tag: "div",
    classes: ["pk5e-creator"],
    window: { title: "Class reference", icon: "fa-solid fa-book-open", resizable: true },
    actions: {
      pickEntry: ClassReference.onPick,
      configure: ClassReference.onConfigure,
      refresh: ClassReference.onRefresh
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/reference.hbs` }
  };

  /**
   * Closes the reading window if it is open.
   *
   * Called once a class has actually landed on the character: at that point the
   * window has done its job, and leaving it over the finished sheet only asks
   * the player to tidy up after us.
   */
  static closeIfOpen() {
    try {
      const open = foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id);
      if (open) open.close();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not close the reference window`, err);
    }
  }

  /**
   * Builds the merged tree.
   *
   * Branch key is the top folder NAME, so identical folders in different
   * compendiums collapse into one. Entries filed directly at a compendium's
   * root land in a catch-all branch rather than disappearing.
   */
  async buildTree() {
    if (this._tree) return this._tree;

    const branches = new Map();
    const loose = [];

    const branchFor = (name) => {
      if (!branches.has(name)) {
        branches.set(name, { key: name, name, entries: [], children: new Map() });
      }
      return branches.get(name);
    };

    for (const packId of referencePackIds()) {
      const pack = game.packs.get(packId);
      if (!pack || pack.documentName !== "Item") continue;

      let index;
      try {
        index = await pack.getIndex({ fields: ["system.source.book", "folder"] });
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not index ${packId}`, err);
        continue;
      }

      for (const entry of index) {
        if (!WANTED_TYPES.includes(entry.type)) continue;

        const source = entry.system?.source ?? {};
        const record = {
          uuid: `Compendium.${pack.collection}.${entry._id}`,
          name: entry.name,
          img: entry.img || "icons/svg/book.svg",
          type: entry.type,
          origin: source.book || source.custom || pack.metadata.label,
          search: `${entry.name} ${pack.metadata.label}`.toLowerCase()
        };

        const path = folderPath(pack, entry.folder);
        if (!path.length) {
          loose.push(record);
          continue;
        }

        const branch = branchFor(path[0]);
        if (path.length === 1) {
          branch.entries.push(record);
        } else {
          const childName = path[1];
          if (!branch.children.has(childName)) {
            branch.children.set(childName, { name: childName, entries: [] });
          }
          branch.children.get(childName).entries.push(record);
        }
      }
    }

    const byName = (a, b) => a.name.localeCompare(b.name);

    const tree = Array.from(branches.values())
      .map((branch) => ({
        key: branch.key,
        name: branch.name,
        entries: branch.entries.sort(byName),
        children: Array.from(branch.children.values())
          .map((child) => ({ ...child, entries: child.entries.sort(byName) }))
          .sort(byName),
        count:
          branch.entries.length +
          Array.from(branch.children.values()).reduce((sum, c) => sum + c.entries.length, 0)
      }))
      .sort(byName);

    if (loose.length) {
      tree.push({
        key: "__loose__",
        name: "Not in a folder",
        entries: loose.sort(byName),
        children: [],
        count: loose.length
      });
    }

    this._tree = tree;
    return tree;
  }

  async _prepareContext() {
    const tree = await this.buildTree();
    const openAll = tree.length <= 3;

    return {
      isGM: game.user.isGM,
      configured: referenceIsConfigured(),
      packCount: referencePackIds().length,
      tree: tree.map((branch) => ({
        ...branch,
        // A branch holding the entry being read stays open regardless: the
        // reader is looking at it, so collapsing it would hide their place.
        open: this.branchHasSelection(branch) || (this._open[branch.key] ?? openAll),
        entries: branch.entries.map((e) => ({ ...e, selected: e.uuid === this.selectedUuid })),
        children: branch.children.map((child) => ({
          ...child,
          entries: child.entries.map((e) => ({ ...e, selected: e.uuid === this.selectedUuid }))
        }))
      })),
      empty: tree.length === 0,
      detail: this._detail,
      selected: this.findEntry(this.selectedUuid)
    };
  }

  branchHasSelection(branch) {
    if (!this.selectedUuid) return false;
    if (branch.entries.some((e) => e.uuid === this.selectedUuid)) return true;
    return branch.children.some((child) =>
      child.entries.some((e) => e.uuid === this.selectedUuid)
    );
  }

  findEntry(uuid) {
    if (!uuid || !this._tree) return null;
    for (const branch of this._tree) {
      const direct = branch.entries.find((e) => e.uuid === uuid);
      if (direct) return direct;
      for (const child of branch.children) {
        const nested = child.entries.find((e) => e.uuid === uuid);
        if (nested) return nested;
      }
    }
    return null;
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-options", ".pk5e-detail-col"]);

    // <details> toggles itself natively, so without this the panel would forget
    // which branches the reader opened and collapse them on the next redraw.
    this.element.querySelectorAll("details[data-branch]").forEach((node) => {
      node.addEventListener("toggle", () => {
        this._open[node.dataset.branch] = node.open;
      });
    });

    const search = this.element.querySelector("[data-search]");
    if (!search) return;

    search.addEventListener("input", (ev) => {
      const query = ev.currentTarget.value.trim().toLowerCase();
      this.element.querySelectorAll(".pk5e-branch").forEach((branch) => {
        let visible = 0;
        branch.querySelectorAll(".pk5e-option").forEach((row) => {
          const match = !query || row.dataset.search.includes(query);
          row.style.display = match ? "" : "none";
          if (match) visible += 1;
        });
        branch.style.display = visible ? "" : "none";
        // Searching should reveal matches inside collapsed branches.
        const details = branch.querySelector("details");
        if (details && query) details.open = true;
      });
    });
  }

  static onConfigure() {
    new ReferenceConfig({
      onSaved: () => {
        this._tree = null;
        this.render();
      }
    }).render(true);
  }

  static onRefresh() {
    this._tree = null;
    this._detail = null;
    this.selectedUuid = null;
    this.render();
  }

  static async onPick(event, target) {
    this.selectedUuid = target.dataset.uuid;
    this._detail = null;
    this.render();

    try {
      const doc = await fromUuid(this.selectedUuid);
      const raw = doc?.system?.description?.value ?? "";
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      let html = raw
        ? await TE.enrichHTML(raw, { relativeTo: doc, secrets: false })
        : "<p><em>No description in the compendium.</em></p>";
      // Artwork from books the reader may not own renders as a padlock.
      html = html
        .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
        .replace(/<img\b[^>]*>/gi, "");
      this._detail = html;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read ${this.selectedUuid}`, err);
      this._detail = "<p><em>Could not read that entry.</em></p>";
    }
    this.render();
  }
}
