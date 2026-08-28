/**
 * languages.mjs
 * ---------------------------------------------------------------------------
 * Language selection, as its own window.
 *
 * This used to be tucked away inside the ability score screen, where players
 * simply did not find it. It became a step of its own, with the rule text and
 * the Standard Languages table from the Player's Handbook.
 *
 * The table, the lookup and the write are not here: they live in
 * languages-core.mjs, which the guide panel's own inline step draws from as
 * well. This file is the window.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { preserveScroll, applyTheme } from "./ui.mjs";
import {
  EXPECTED_EXTRAS,
  applyLanguages,
  buildLanguageView,
  commonKey,
  rollLanguage,
  selectionFor
} from "./languages-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

async function confirmExtra(message) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    try {
      return await DialogV2.confirm({
        window: { title: "More languages than usual" },
        content: `<p>${message}</p>`,
        modal: true
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | DialogV2 unavailable, falling back`, err);
    }
  }
  return window.confirm(message);
}

/**
 * Asks before saving more languages than a character normally knows.
 *
 * Shared with the panel's inline step - the guard belongs to the decision, not
 * to the window it happens to be taken in.
 */
export async function confirmExtraLanguages(selected) {
  const common = commonKey();
  const extras = Array.from(selected).filter((key) => key !== common).length;
  if (extras <= EXPECTED_EXTRAS) return true;
  return confirmExtra(
    `A character normally knows Common plus two more languages. You have chosen ${extras}. Keep them all?`
  );
}

export class LanguagePicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId ?? null;
    this.selected = null;
    /** Every roll made in this window, so the table keeps showing them all. */
    this.rolls = [];
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-languages",
    tag: "div",
    classes: ["pk5e-creator"],
    window: { title: t("lang.title"), icon: "fa-solid fa-comments", resizable: true },
    position: { width: 620, height: 700 },
    actions: {
      rollLanguage: LanguagePicker.onRoll,
      clearRolls: LanguagePicker.onClearRolls,
      apply: LanguagePicker.onApply
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/languages.hbs` }
  };

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) : null;
  }

  /** Current selection, seeded from the sheet, with Common always included. */
  get languages() {
    if (!this.selected) this.selected = selectionFor(this.actor);
    return this.selected;
  }

  async _prepareContext() {
    return {
      actorName: this.actor?.name ?? "",
      hasActor: !!this.actor,
      ...buildLanguageView(this.languages, this.rolls, {
        standard: t("lang.standard"),
        expanded: t("lang.expanded")
      })
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-pane", ".pk5e-lang-groups"]);

    const el = this.element;

    el.querySelectorAll("input[data-language]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.language;
        if (ev.currentTarget.checked) this.languages.add(key);
        else this.languages.delete(key);
        this.render();
      });
    });

    const search = el.querySelector("[data-language-search]");
    if (search) search.addEventListener("input", (ev) => filterLanguages(el, ev.currentTarget.value));
  }

  static async onRoll() {
    const result = await rollLanguage(this.languages);
    this.rolls.push(result.total);
    announceRoll(result);
    this.render();
  }

  /** Clears the roll record. Languages already ticked are left alone. */
  static onClearRolls() {
    this.rolls = [];
    this.render();
  }

  static async onApply() {
    const actor = this.actor;
    if (!actor) return;

    if (!(await confirmExtraLanguages(this.languages))) return;

    try {
      await applyLanguages(actor, this.languages);
      ui.notifications.info(`Languages saved for "${actor.name}".`);
      this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not save languages`, err);
      ui.notifications.error(`Could not save languages: ${err.message}`);
    }
  }
}

/**
 * Hides the rows that do not match, and any group left with nothing in it.
 *
 * Done in the DOM rather than by re-rendering: the query lives in the input,
 * and a render would put an empty box back under the player's cursor.
 */
export function filterLanguages(root, rawQuery) {
  const query = String(rawQuery ?? "").trim().toLowerCase();
  root.querySelectorAll(".pk5e-lang-group").forEach((group) => {
    let visible = 0;
    group.querySelectorAll(".pk5e-pack").forEach((row) => {
      const match = !query || row.dataset.search.includes(query);
      row.style.display = match ? "" : "none";
      if (match) visible += 1;
    });
    group.style.display = visible ? "" : "none";
  });
}

/** What a roll did, said out loud. */
export function announceRoll(result) {
  if (!result) return;
  if (result.outcome === "unknown-to-system") {
    ui.notifications.warn(`Rolled ${result.total}: ${result.name}, which this system does not list.`);
  } else if (result.outcome === "already-known") {
    ui.notifications.info(`Rolled ${result.total}: ${result.name} - already known, roll again.`);
  } else if (result.outcome === "added") {
    ui.notifications.info(`Rolled ${result.total}: ${result.name} added.`);
  }
}
