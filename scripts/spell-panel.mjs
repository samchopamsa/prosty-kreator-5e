/**
 * spell-panel.mjs
 * ---------------------------------------------------------------------------
 * A narrow panel that sits inside the importer's spell list and shows what
 * the character already has, so a spell can be taken off from the same screen
 * it is added on.
 *
 * WHY
 * ---
 * The importer's spell list is six hundred rows and a tick box each, and it
 * knows nothing about what the sheet already holds: a Bard picking their
 * fourth spell has to keep the first three in their head, and a wrong pick
 * means finding the sheet, the spells tab and the delete button. The panel
 * puts the sheet's spells beside the list, grouped by level, each with a
 * remove button, under the counts the class table sets ("Prepared spells: 3
 * of 4") - so adding, checking and swapping are one screen.
 *
 * It is the description panel's sibling (importer-panel.mjs) and docks the
 * same way, into a different window (dock.mjs, "two panels, two hosts").
 * Like that one it is opened only when its host is on screen, by the watch
 * at the bottom of this file, and closes when the host goes.
 *
 * WHOSE SPELLS
 * ------------
 * The character is read off the importer's own list window (importTargetOf
 * in importer-watch.mjs: the application object's target, else the wizard
 * title) - so the panel appears whether the list was opened by the creator's
 * button or by the importer's own. A list aimed at no character - an import
 * into the world - opens nothing.
 *
 * REMOVING IS THE SHEET'S OWN DELETE
 * ----------------------------------
 * `item.delete()`, nothing more: a spell carries no advancement and leaves
 * nothing behind on the actor, so the Advancement manager the class step
 * needs for its removals has no part here. No confirmation either - the list
 * that puts it back is on the same screen, which is the whole point.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { applyTheme, preserveScroll } from "./ui.mjs";
import { trace } from "./trace.mjs";
import { watchForHost, stopWatchingHost, undockPanel } from "./dock.mjs";
import { findSpellListWindow, importTargetOf } from "./importer-watch.mjs";
import { allSpells, spellOrigin, isAvailable } from "./rules-data.mjs";
import { spellNotes, spellsAboveCap } from "./checkup.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PANEL_WIDTH = 300;

/** A burst of imports is over when nothing has landed for this long. */
const ARRIVAL_SETTLE_MS = 1000;

const escapeHtml = (text) =>
  String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * What to call the thing that granted a spell: the giver by name when the
 * advancement stamp names one, otherwise the kind of thing it was.
 */
function originLabel(origin) {
  if (origin.giver) return origin.giver;
  const key = `spellpanel.origin.${origin.giverType ?? "other"}`;
  const label = t(key);
  return label === key ? t("spellpanel.origin.other") : label;
}

/** The one panel, held from construction for the reason importer-panel.mjs gives. */
let current = null;

function openPanel() {
  return current ?? foundry.applications.instances?.get(SpellPanel.DEFAULT_OPTIONS.id) ?? null;
}

export class SpellPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    const vh = globalThis.innerHeight ?? 900;
    super({
      ...options,
      window: { title: t("spellpanel.title"), ...(options.window ?? {}) },
      position: {
        width: PANEL_WIDTH,
        height: Math.max(420, vh - 120),
        ...(options.position ?? {})
      }
    });
    this.actorId = options.actorId ?? null;
    this._stopDocking = null;
    this._hooks = [];
    current = this;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-spell-panel",
    tag: "div",
    classes: ["pk5e-creator", "pk5e-spell-panel"],
    window: { title: "Spells on the sheet", icon: "fa-solid fa-wand-sparkles", resizable: true },
    actions: {
      removeSpell: SpellPanel.onRemoveSpell
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/spell-panel.hbs` }
  };

  /** A third of the row: the list beside it has seven columns to show. */
  dockShare = 0.34;

  /** Where dock.mjs should put this panel. */
  findHost() {
    return findSpellListWindow({ visible: true }) ?? null;
  }

  /** Used by dock.mjs when the panel is undocked; it never floats, so nowhere. */
  static beside() {
    return { left: 20, top: 60 };
  }

  get actor() {
    return game.actors?.get(this.actorId) ?? null;
  }

  static closeIfOpen() {
    try {
      openPanel()?.close();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not close the spell panel`, err);
    }
  }

  async _prepareContext() {
    const actor = this.actor;
    if (!actor) return { missing: true };

    // The counts, only when the rules data is there to give them; without
    // it the panel is still the list with its remove buttons.
    const notes = isAvailable() ? await spellNotes(actor) : [];
    const tooHigh = new Set(spellsAboveCap(actor, notes).map((high) => high.item.id));

    // Grouped by level, cantrips first: the order the list beside it sorts
    // by and the order the sheet's spellbook shows. Every spell on the sheet
    // is listed, and only the class's own are the player's to remove: one
    // a species, background, feat or subclass granted is shown locked, with
    // its giver named, so the list is the whole sheet without offering to
    // delete what a feature put there (spellOrigin, rules-data.mjs).
    const groups = new Map();
    for (const item of allSpells(actor)) {
      const level = Number(item.system?.level) || 0;
      if (!groups.has(level)) {
        groups.set(level, {
          level,
          label: level === 0 ? t("spellpanel.cantrips") : t("spellpanel.level", level),
          entries: []
        });
      }
      const origin = spellOrigin(item, actor);
      groups.get(level).entries.push({
        id: item.id,
        name: item.name,
        img: item.img || "",
        uuid: item.uuid ?? "",
        locked: origin.kind !== "class",
        origin: origin.kind === "class" ? "" : originLabel(origin),
        tooHigh: tooHigh.has(item.id)
      });
    }

    return {
      actorName: actor.name,
      notes,
      groups: Array.from(groups.values()),
      empty: !groups.size,
      labels: {
        remove: t("spellpanel.remove"),
        empty: t("spellpanel.empty"),
        tooHigh: t("spellpanel.tooHigh")
      }
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-spell-panel-body"]);

    // The sheet is the source of truth and it changes under this panel with
    // every Import press and every remove button, so it is redrawn on the
    // actor's own item events rather than after its own actions.
    if (!this._hooks.length) {
      const onItem = (doc) => {
        if (doc?.parent?.id !== this.actorId || doc.type !== "spell") return;
        this.render();
      };
      for (const name of ["deleteItem", "updateItem"]) {
        this._hooks.push([name, Hooks.on(name, onItem)]);
      }
      this._hooks.push([
        "createItem",
        Hooks.on("createItem", (doc) => {
          if (doc?.parent?.id !== this.actorId || doc.type !== "spell") return;
          this.render();
          this.noteArrival(doc);
        })
      ]);
    }

    if (!this._stopDocking) this._stopDocking = watchForHost(this);
  }

  /**
   * Collects what an Import press brought and, once the burst has settled,
   * says out loud which of it the class cannot cast yet.
   *
   * The list marks such a spell in red as it lands; this is the second
   * telling, for the batch case - twelve rows ticked and imported at once,
   * where the red line scrolls past. One dialog per burst rather than one
   * per spell, hence the debounce; the burst is over when nothing has
   * arrived for a second.
   */
  noteArrival(doc) {
    this._arrived = this._arrived ?? [];
    this._arrived.push(doc.id);
    clearTimeout(this._arrivalTimer);
    this._arrivalTimer = setTimeout(() => this.reportArrivals(), ARRIVAL_SETTLE_MS);
  }

  async reportArrivals() {
    const ids = new Set(this._arrived ?? []);
    this._arrived = [];
    const actor = this.actor;
    if (!actor || !ids.size || !isAvailable()) return;

    let high = [];
    try {
      high = spellsAboveCap(actor, await spellNotes(actor)).filter((entry) => ids.has(entry.item.id));
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not check the imported spells' levels`, err);
      return;
    }
    if (!high.length) return;

    const lines = high.map((entry) => `<li>${escapeHtml(entry.item.name)} - ${t("spellpanel.levelOf", entry.level)}</li>`);
    const cap = high[0].cap;
    const className = high[0].className;
    const content =
      `<p>${t("spellpanel.tooHighIntro", className, cap)}</p><ul>${lines.join("")}</ul>` +
      `<p>${t("spellpanel.tooHighOutro")}</p>`;

    const DialogV2 = foundry.applications?.api?.DialogV2;
    try {
      if (DialogV2?.prompt) {
        await DialogV2.prompt({
          window: { title: t("spellpanel.tooHighTitle") },
          content,
          ok: { label: "OK" }
        });
        return;
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | The spell level dialog could not be shown`, err);
    }
    ui.notifications.warn(
      `${t("spellpanel.tooHighIntro", className, cap)} ${high.map((entry) => entry.item.name).join(", ")}`,
      { permanent: true }
    );
  }

  _onClose(options) {
    this._stopDocking?.();
    this._stopDocking = null;
    stopWatchingHost(this);
    try {
      undockPanel(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not undock the spell panel`, err);
    }
    for (const [name, id] of this._hooks) Hooks.off(name, id);
    this._hooks = [];
    // The arrival timer is NOT cleared here. Measured live: the importer
    // hides its list the moment Import is pressed and puts up "Import
    // Complete" instead, so the panel loses its host - and closes - before
    // the burst has settled. The report reads the actor by id and needs no
    // panel, so it is left to fire; a dialog after the window closed is the
    // whole point of the batch case.
    if (current === this) current = null;
    return super._onClose?.(options);
  }

  static async onRemoveSpell(event, target) {
    const actor = this.actor;
    const item = actor?.items?.get(target.dataset.item);
    if (!item) return;
    try {
      await item.delete();
      trace("spell removed from the panel:", item.name);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not remove ${item.name}`, err);
      ui.notifications.warn(t("spellpanel.removeFailed", item.name, err?.message ?? ""));
    }
  }
}

/**
 * Opens the panel for the character the importer is aiming at - only when
 * the spell list is on screen, and only when there is such a character.
 */
export function openSpellPanel() {
  const open = openPanel();
  if (open) return open;

  if (!findSpellListWindow({ visible: true })) {
    trace("spell panel not opened: no spell list on screen");
    return null;
  }
  // The spell list's own window says whom it is for (importer-watch.mjs).
  const actor = importTargetOf(findSpellListWindow({ visible: true }));
  if (!actor) {
    trace("spell panel not opened: the spell list names no character");
    return null;
  }
  const panel = new SpellPanel({ actorId: actor.id });
  panel.render(true);
  return panel;
}

/**
 * Opens the panel whenever the spell list appears, however it was opened.
 *
 * The same shape as dock.mjs's watch for the class list, kept here because
 * the thing it opens is this file's. The setting is read on every window, so
 * switching it off takes effect at the next list.
 */
let opener = null;

export function startSpellHostWatch() {
  if (opener) return;

  const check = () => {
    if (!findSpellListWindow({ visible: true })) return;
    if (!game.settings.get(MODULE_ID, "spellPanel")) return;
    try {
      openSpellPanel();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not open the spell panel`, err);
    }
  };

  opener = new MutationObserver(check);
  opener.observe(document.body, { childList: true, subtree: true });
  check();
}

export function stopSpellHostWatch() {
  opener?.disconnect();
  opener = null;
}
