/**
 * levelup.mjs
 * ---------------------------------------------------------------------------
 * A window for levelling an existing character, after creation is finished.
 *
 * WHY IT IS NOT PART OF THE CREATION PANEL
 * ----------------------------------------
 * The panel is a list of seven numbered steps, done once, in order. A level-up
 * is one action with a few consequences, done repeatedly over months. Bending
 * one shape into the other would have meant conditions in a dozen places.
 *
 * WHAT IT ADDS OVER PRESSING THE SHEET'S OWN BUTTON
 * -------------------------------------------------
 * 1. It says what changed. Foundry is oddly silent about this: the player
 *    clicks through several windows and lands back on a sheet that is different
 *    in ways nobody lists. We take a reading before and after and report the
 *    difference, so nothing has to be remembered.
 *
 * 2. It notices skipped choices. The watcher that catches a closed-too-early
 *    dialog only runs while a panel of ours is open - so a player levelling up
 *    normally had no protection at all. This closes that gap, which is arguably
 *    the better reason for the window to exist.
 *
 * 3. It levels more than once. The importer works a level at a time; a player
 *    coming back after two sessions away wants three of them.
 *
 * The class is not chosen here. Plutonium's own Level Up dialog lists the
 * character's classes with a button each, and offers multiclassing - it does
 * that job well, and duplicating it would only be another thing to keep in step.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { applyTheme, preserveScroll } from "./ui.mjs";
import { pressLevelUp, grantExperienceFor, wait } from "./sheet-actions.mjs";
import { takeSnapshot, compareSnapshots } from "./snapshot.mjs";
import { watchOptionDialogs, skippedOptions, clearSkippedOptions } from "./option-watch.mjs";
import { watchImportEnd } from "./import-end.mjs";
import { trace } from "./trace.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * How long to wait for the importer before reading the character again.
 *
 * The "Import Complete" window normally arrives first and we read straight
 * away; this only covers the case where it never comes - a cancelled import, or
 * a player who wandered off mid-way. Generous, because reading too early would
 * report half a level.
 */
const IMPORT_TIMEOUT_MS = 120000;

export class LevelUpGuide extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    const vw = globalThis.innerWidth ?? 1200;
    const vh = globalThis.innerHeight ?? 900;
    const width = Math.min(520, Math.max(360, vw - 60));
    const height = Math.min(620, Math.max(420, vh - 120));

    super({
      ...options,
      position: {
        width,
        height,
        left: Math.max(20, Math.round((vw - width) / 2)),
        top: Math.max(20, Math.round((vh - height) / 3)),
        ...(options.position ?? {})
      }
    });

    this.actorId = options.actorId ?? null;
    /** Levels still to be gained in this run. */
    this._remaining = 0;
    this._total = 0;
    this._busy = false;
    /** Everything gained so far, accumulated across levels. */
    this._changes = [];
    this._stopOptionWatch = null;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-levelup",
    tag: "div",
    classes: ["pk5e-creator", "pk5e-levelup"],
    window: { icon: "fa-solid fa-arrow-up-right-dots", resizable: true },
    actions: {
      levelOnce: LevelUpGuide.onLevelOnce,
      dismissOption: LevelUpGuide.onDismissOption,
      finish: LevelUpGuide.onFinish
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/levelup.hbs` }
  };

  get title() {
    const name = this.actor?.name ?? "";
    const base = t("levelup.windowTitle");
    return name ? `${base} - ${name}` : base;
  }

  get actor() {
    return game.actors.get(this.actorId) ?? null;
  }

  static open(actorId) {
    const existing = foundry.applications.instances?.get(LevelUpGuide.DEFAULT_OPTIONS.id);
    if (existing) {
      existing.actorId = actorId;
      existing.render(true);
      existing.bringToFront?.();
      return existing;
    }
    const app = new LevelUpGuide({ actorId });
    app.render(true);
    return app;
  }

  async _prepareContext() {
    const actor = this.actor;
    if (!actor) return { missing: true };

    const level = Number(actor.system?.details?.level ?? 0);
    const classes = actor.items
      .filter((i) => i.type === "class")
      .map((i) => ({ name: i.name, levels: Number(i.system?.levels ?? 0) }));

    // Every level from the next one up to 20, so a player returning after a
    // break can name where they are meant to be rather than pressing repeatedly.
    const targets = [];
    for (let n = level + 1; n <= 20; n += 1) targets.push({ level: n, count: n - level });

    return {
      actorName: actor.name,
      actorImg: actor.img ?? "",
      level,
      classes,
      atMax: level >= 20,
      targets,
      target: this._target ?? level + 1,
      busy: this._busy,
      remaining: this._remaining,
      total: this._total,
      inProgress: this._total > 0,
      progress: this._total > 0 ? t("levelup.progress", this._total - this._remaining, this._total) : "",
      changes: this._changes.map((change) => ({
        ...change,
        text: describeChange(change)
      })),
      skipped: skippedOptions(actor).map((entry) => ({
        ...entry,
        text:
          entry.reason === "partial"
            ? t("option.partialSelect", entry.label)
            : t("option.skipped", entry.label)
      })),
      done: this._total > 0 && this._remaining === 0
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-pane"]);

    // Bound by hand rather than through an action. As an action every click on
    // the select counted as one, and the redraw that followed closed the list
    // before anything could be picked from it - the value could only be changed
    // with the arrow keys.
    const target = this.element.querySelector("[data-target-level]");
    if (target) {
      target.value = String(this._target ?? "");
      target.addEventListener("change", (ev) => {
        // Stored, not rendered: nothing else on screen depends on it until the
        // button is pressed.
        this._target = Number(ev.currentTarget.value) || null;
      });
    }

    // Same watcher the creation panel uses. Without a window of ours open,
    // nothing was checking whether the player finished the dialogs.
    if (!this._stopOptionWatch && this.actor) {
      this._stopOptionWatch = watchOptionDialogs(this.actor, () => this.render());
    }
  }

  async close(options = {}) {
    this._stopOptionWatch?.();
    this._stopOptionWatch = null;
    return super.close(options);
  }

  /**
   * Gains one level and reports what it brought.
   *
   * Reading the character afterwards is timed off the importer's own "Import
   * Complete" window: items arrive part-way through the chain of dialogs, so
   * anything sooner would report half a level.
   */
  async levelOnce() {
    const actor = this.actor;
    if (!actor || this._busy) return;

    this._busy = true;
    this.render();

    const before = takeSnapshot(actor);

    try {
      if (game.settings.get(MODULE_ID, "levelUpMode") === "xp") {
        const ready = await grantExperienceFor(actor, this._target);
        if (!ready) {
          this._busy = false;
          this.render();
          return false;
        }
        if (actor.sheet.rendered) {
          await actor.sheet.render();
          await wait(500);
        }
      }

      const pressed = await pressLevelUp(actor);
      if (!pressed) {
        ui.notifications.warn(t("levelup.noButton"));
        this._busy = false;
        this.render();
        return false;
      }

      await watchImportEnd({ timeout: IMPORT_TIMEOUT_MS });
      // The sheet settles a moment after the importer reports itself done.
      await wait(600);

      const after = takeSnapshot(actor);
      const changes = compareSnapshots(before, after);
      trace("level-up changes:", changes);
      this._changes.push(...changes);

      if (!changes.length) {
        // Nothing moved: the import was cancelled, or the dialogs were closed
        // without going through. Saying so beats an empty list.
        ui.notifications.warn(t("levelup.nothingChanged"));
        return false;
      }
      return true;
    } catch (err) {
      console.error(`${MODULE_ID} | The level-up did not complete`, err);
      ui.notifications.error(t("levelup.failed"));
      return false;
    } finally {
      this._busy = false;
      this.render();
    }
  }

  static async onLevelOnce() {
    const actor = this.actor;
    if (!actor) return;

    const level = Number(actor.system?.details?.level ?? 0);
    const target = Number(this._target ?? level + 1);
    if (target <= level) return;

    this._total = target - level;
    this._remaining = this._total;
    this._changes = [];

    // One level at a time, because that is how the importer works. The window
    // shows which one it is on, so a run of three does not look like a hang.
    while (this._remaining > 0) {
      const ok = await this.levelOnce();
      if (!ok) break;
      this._remaining -= 1;
      this.render();
      if (this._remaining > 0) await wait(400);
    }
  }

  static async onDismissOption(event, target) {
    await clearSkippedOptions(this.actor, {
      label: target.dataset.label,
      level: Number(target.dataset.level) || null
    });
    this.render();
  }

  static async onFinish() {
    await this.close();
    this.actor?.sheet?.render(true);
  }
}

/** Turns one change into a line a player can read. */
function describeChange(change) {
  const ability = (key) => CONFIG.DND5E?.abilities?.[key]?.label ?? key.toUpperCase();
  const skill = (key) => CONFIG.DND5E?.skills?.[key]?.label ?? key;

  switch (change.kind) {
    case "level":
      return t("levelup.changeLevel", change.label, change.detail);
    case "newClass":
      return t("levelup.changeNewClass", change.label, change.detail);
    case "hp":
      return t("levelup.changeHp", change.detail);
    case "slots":
      return t("levelup.changeSlots", slotLabel(change.label), change.detail);
    case "spell":
      return t("levelup.changeSpell", change.label);
    case "skill":
      return t("levelup.changeSkill", skill(change.label));
    case "save":
      return t("levelup.changeSave", ability(change.label));
    case "ability":
      return t("levelup.changeAbility", ability(change.label), change.detail);
    case "language":
      return t("levelup.changeLanguage", change.label);
    default:
      return t("levelup.changeItem", change.label);
  }
}

/** "spell3" -> "3", "pact" left alone. */
function slotLabel(key) {
  const found = String(key).match(/^spell(\d+)$/);
  return found ? found[1] : key;
}

export function openLevelUp(actorId) {
  return LevelUpGuide.open(actorId);
}
