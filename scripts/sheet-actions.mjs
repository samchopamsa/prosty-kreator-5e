/**
 * sheet-actions.mjs
 * ---------------------------------------------------------------------------
 * Everything this module does BY OPERATING THE CHARACTER SHEET rather than by
 * writing to the actor.
 *
 * The creator's whole approach is to press the buttons the sheet already has,
 * so that the importer, the Compendium Browser and the system's Advancement all
 * carry on working exactly as they were built to. That means a certain amount
 * of reaching into the sheet's markup, waiting for windows to appear, and
 * clicking things - work that is fiddly, timing-dependent, and quite unlike the
 * rest of the module.
 *
 * It lived in guide.mjs, which had grown to 1476 lines and was doing this
 * alongside laying out the panel and holding the window's state. Split out so
 * that the panel can be read without wading through DOM plumbing, and so this
 * plumbing - the part most likely to break when dnd5e or Plutonium changes -
 * can be found in one place.
 *
 * Nothing here knows about the panel. It takes an actor and does a thing.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The closing sentence of each pick step describes the clicks still ahead. When
 * the module clicks through those dialogs itself, describing them would be
 * describing something the player never sees.
 */
export function importFlowNote() {
  const setting = game.settings.get(MODULE_ID, "autoAdvance");
  const clickingThrough = setting === "everyone" || (setting === "players" && !game.user?.isGM);
  if (clickingThrough || plutoniumAnswersItself()) return t("flow.plutonium");
  return t("flow.prompt");
}



/**
 * The GM's own wording wins; otherwise the translated default. A GM who has
 * written custom text presumably wants exactly that text, in any language.
 */
export function text(settingKey, translationKey) {
  const custom = game.settings.get(MODULE_ID, settingKey);
  if (typeof custom === "string" && custom.trim()) return custom;
  return t(translationKey);
}

/** What each step adds, and how to find its button and its item. */
/**
 * Keyed in panel order, because missingSteps() reports in the order it walks
 * this object and "what is still missing" reads oddly out of sequence.
 */
export const STEP_CONFIG = {
  class: {
    itemTypes: ["class"],
    buttonTypes: ["class"],
    labels: ["add class"]
  },
  species: {
    itemTypes: ["race", "species"],
    buttonTypes: ["race", "species"],
    labels: ["add species", "add race"]
  },
  background: {
    itemTypes: ["background"],
    buttonTypes: ["background"],
    labels: ["add background"]
  }
};

/**
 * Deletes an item the way the character sheet does.
 *
 * Class, species and background advancements write proficiencies, features and
 * hit points directly onto the actor. Deleting the item on its own leaves all of
 * that behind, so we hand it to the system's Advancement manager, which knows
 * how to unwind those changes.
 */
export async function deleteWithAdvancement(actor, item) {
  const AdvancementManager =
    foundry.utils.getProperty(globalThis, "dnd5e.applications.advancement.AdvancementManager") ??
    foundry.utils.getProperty(game, "dnd5e.applications.advancement.AdvancementManager");

  if (AdvancementManager?.forDeletedItem) {
    let manager = null;
    try {
      manager = AdvancementManager.forDeletedItem(actor, item.id);
    } catch (err) {
      console.warn(`${MODULE_ID} | Advancement reversal unavailable for ${item.name}`, err);
    }

    if (manager?.steps?.length) {
      await new Promise((resolve) => {
        const originalClose = manager.close.bind(manager);
        manager.close = async (...args) => {
          try {
            return await originalClose(...args);
          } finally {
            resolve();
          }
        };
        manager.render(true);
      });
      return;
    }
  }

  await item.delete();
}

/**
 * Waits for a button carrying one of the given labels to appear anywhere on the
 * page, then hands it back. Used to walk the player past dialogs belonging to
 * other packages, whose internals we deliberately do not depend on - we only
 * recognise the wording a person would read.
 */
export function waitForButton(labels, timeout = 5000) {
  const wanted = labels.map((l) => l.toLowerCase());
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;

    const find = () => {
      const nodes = document.querySelectorAll("button, a.button, .dialog-button");
      for (const node of nodes) {
        if (node.disabled || node.closest("#pk5e-guide")) continue;
        const label = (node.textContent ?? "").trim().toLowerCase();
        if (label && wanted.some((w) => label === w || label.includes(w))) return node;
      }
      return null;
    };

    const tick = () => {
      const hit = find();
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 120);
    };
    tick();
  });
}

/**
 * Finds the "Keep Window Open" checkbox on the importer screen.
 *
 * Matched by the wording next to it, because we only ever act on things a
 * person could see and click themselves.
 */
export function findKeepOpenCheckbox() {
  for (const box of document.querySelectorAll("input[type='checkbox']")) {
    if (box.closest("#pk5e-guide")) continue;
    const row = box.closest("label, tr, div, li");
    const text = (row?.textContent ?? "").trim().toLowerCase();
    if (text.includes("keep window open")) return box;
  }
  return null;
}

/**
 * Optionally clicks through the "Use Plutonium / Use Compendium Browser" choice
 * and the importer's own "Open Importer" button, so the player lands straight
 * on the list of options. Off by default: it takes a real choice away, and it
 * leans on the wording of another package.
 *
 * Note the Keep Window Open step. That checkbox lives ONLY on the screen we are
 * about to click past, so a player who had it ticked would never get another
 * chance to untick it - the two conveniences would combine into a trap. We
 * therefore untick it here, doing exactly what the player would have done, and
 * only if we can actually see it.
 */
/**
 * Whether Plutonium has been configured to skip its own importer question.
 * Read through its public config API; if that is unavailable we assume it still
 * asks, which is the safe direction - at worst we wait a moment for nothing.
 */
export function plutoniumAnswersItself() {
  try {
    const value = globalThis.plutonium?.config?.getValue?.("actor", "addButtonMode");
    // 0 Never, 1 Prompt, 2 Always - anything other than Prompt means no dialog.
    return value !== undefined && value !== 1;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read Plutonium's addButtonMode`, err);
    return false;
  }
}

/**
 * Does this user want the importer's opening screens clicked through?
 *
 * This was five settings - a mode and a source-screen toggle for players, the
 * same pair again for the GM, and a switch for the Keep Window Open checkbox.
 * Five, for something whose own help text told you to configure Plutonium
 * instead. Now one, with a choice of who it applies to; the Keep Window Open
 * handling is simply part of what clicking through means.
 */
function autoAdvanceApplies() {
  const setting = game.settings.get(MODULE_ID, "autoAdvance");
  if (!setting || setting === "off") return false;
  if (setting === "everyone") return true;
  return !game.user?.isGM;
}

export async function autoAdvance() {
  if (!autoAdvanceApplies()) return;
  const mode = "plutonium";
  const skipSources = true;

  // Step one: the "Use Plutonium / Use Compendium Browser" choice.
  //
  // Plutonium can be told to stop asking, via its own "Use Importer when Using
  // ADD ... Button on Actor" setting. When it is, waiting for a window that will
  // never appear just adds four seconds to every step, so we ask Plutonium first.
  if (mode && mode !== "off" && !plutoniumAnswersItself()) {
    const label = mode === "plutonium" ? "use plutonium" : "use compendium browser";
    const chooser = await waitForButton([label], 4000);
    if (chooser) chooser.click();
    // The compendium browser opens straight onto its list; nothing else to skip.
    if (mode === "compendium") return;
  }

  // Step two: the data source screen, closed by pressing "Open Importer".
  // Independent of step one on purpose - you may want to pick the importer
  // yourself and still not be asked about sources every time.
  if (!skipSources) return;

  const opener = await waitForButton(["open importer"], 12000);
  if (!opener) return;

  // Keep Window Open lives ONLY on the screen we are about to skip, so a player
  // who had it ticked would never get another chance to untick it. We therefore
  // untick it here, doing exactly what they would have done.
  const keepOpen = findKeepOpenCheckbox();
  if (keepOpen?.checked) {
    keepOpen.click();
    console.log(`${MODULE_ID} | Unticked "Keep Window Open" before opening the importer.`);
  }

  opener.click();
}

/** Confirmation dialog, tolerant of the API differing between versions. */
export async function confirmRemoval(message) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    try {
      return await DialogV2.confirm({
        window: { title: "Remove" },
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
 * Finds an "Add X" button on the sheet.
 *
 * The sheet marks these with data-item-type ("class", "race", "background").
 * Matching on that is language independent; the label match below is only a
 * fallback for sheet versions that omit the attribute.
 */
export function findAddButton(root, types, labels) {
  if (!root) return null;
  const candidates = Array.from(root.querySelectorAll("[data-action='findItem']"));

  const byType = candidates.find((b) => {
    const value = String(b.dataset.itemType ?? b.dataset.type ?? "").toLowerCase();
    return value && types.includes(value);
  });
  if (byType) return byType;

  return candidates.find((b) => {
    const text = `${b.textContent ?? ""} ${b.dataset.tooltip ?? ""}`.trim().toLowerCase();
    return labels.some((label) => text.includes(label));
  });
}

/** Puts the sheet into edit mode, where the "Add X" buttons exist at all. */
export async function ensureEditMode(actor) {
  const sheet = actor.sheet;
  const MODES = sheet.constructor?.MODES;
  if (MODES?.EDIT === undefined || sheet._mode === MODES.EDIT) return;

  const toggle = sheet.element?.querySelector("[data-action='changeMode']");
  if (!toggle) return;
  toggle.click();
  await wait(400);
}

/**
 * Clicks the sheet's own button. Opens the sheet if needed and flips it into
 * edit mode when the button is not visible in play mode.
 */
/**
 * Plutonium's own level-up button on the character sheet. It carries no text and
 * no data-action, so it is matched on a fragment of its class name - the same
 * approach as everywhere else here: recognise what a person would point at, and
 * do nothing if it is not there.
 *
 * The window it opens offers both the next level and "Add New Class
 * (Multiclass)", so one button covers both.
 */
export const LEVEL_UP_SELECTORS = [
  ".imp-cls__btn-sheet-level-up",
  "[class*='btn-sheet-level-up']",
  "[class*='level-up']"
];

/**
 * Experience needed for each character level. Read from the system so a world
 * with altered thresholds still works; the table is only a fallback.
 */
export function experienceTable() {
  const fromSystem = CONFIG.DND5E?.CHARACTER_EXP_LEVELS;
  if (Array.isArray(fromSystem) && fromSystem.length >= 20) return fromSystem;
  return [
    0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
    85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000
  ];
}

/**
 * Asks which level the character should reach and tops up experience to match.
 *
 * Plutonium's level-up button refuses to advance a character that has not earned
 * the experience, which is correct for play but pointless when building a
 * character that is meant to start at level five. Experience is only ever raised,
 * never lowered, so nothing already earned is thrown away.
 */
/**
 * @param {Actor}       actor
 * @param {number|null} wanted  Target level. When given, the player is not asked
 *                              again - the level-up window has already chosen.
 */
export async function grantExperienceFor(actor, wanted = null) {
  const table = experienceTable();
  const currentXp = Number(actor.system?.details?.xp?.value ?? 0);
  const currentLevel = actor.items
    .filter((i) => i.type === "class")
    .reduce((sum, i) => sum + (i.system?.levels ?? 0), 0);

  const options = table
    .map((xp, index) => ({ level: index + 1, xp }))
    .filter((entry) => entry.level > Math.max(1, currentLevel))
    .map((entry) => `<option value="${entry.level}">Level ${entry.level} (${entry.xp} XP)</option>`)
    .join("");

  if (!options) {
    ui.notifications.info("Already at the highest level in the table.");
    return true;
  }

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.prompt) {
    ui.notifications.warn("Cannot ask for a target level in this version; set experience by hand.");
    return true;
  }

  let target = Number(wanted) || null;
  if (target) {
    const needed = table[target - 1] ?? 0;
    if (needed > currentXp) {
      await actor.update({ "system.details.xp.value": needed });
      ui.notifications.info(`Experience set to ${needed} for level ${target}.`);
    }
    return true;
  }

  try {
    target = await DialogV2.prompt({
      window: { title: "Level up" },
      content: `<p>Currently level ${currentLevel || 1}, ${currentXp} XP.
                Choose the level to reach - experience will be topped up to match.</p>
                <select name="level" style="width:100%">${options}</select>`,
      ok: { callback: (event, button) => Number(button.form.elements.level.value) }
    });
  } catch (err) {
    // Dialog cancelled: leave the sheet alone entirely.
    return false;
  }

  if (!target) return false;

  const needed = table[target - 1] ?? 0;
  if (needed > currentXp) {
    try {
      await actor.update({ "system.details.xp.value": needed });
      ui.notifications.info(`Experience set to ${needed} for level ${target}.`);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not set experience`, err);
      ui.notifications.error(`Could not set experience: ${err.message}`);
      return false;
    }
  }
  return true;
}

export async function pressLevelUp(actor) {
  const sheet = actor.sheet;
  if (!sheet.rendered) {
    await sheet.render(true);
    await wait(300);
  }

  // A disabled button looks identical to a missing one when clicked: nothing
  // happens. Plutonium disables it while the character lacks the experience for
  // the next level, so we tell the two cases apart and say which it is.
  const isDisabled = (el) =>
    el.disabled ||
    el.getAttribute("aria-disabled") === "true" ||
    /\bdisabled\b/.test(el.className);

  const findAll = () => {
    const seen = new Set();
    for (const selector of LEVEL_UP_SELECTORS) {
      for (const el of actor.sheet.element?.querySelectorAll(selector) ?? []) seen.add(el);
    }
    return Array.from(seen);
  };

  const find = () => findAll().find((el) => !isDisabled(el)) ?? null;

  // Plutonium injects this button after the sheet has rendered, so a single
  // look straight away finds nothing. Poll for a few seconds instead.
  let button = null;
  const deadline = Date.now() + 3000;
  while (!button && Date.now() < deadline) {
    button = find();
    if (button) break;
    await wait(200);
  }

  if (!button) {
    await ensureEditMode(actor);
    await wait(500);
    button = find();
  }

  if (!button) {
    const blocked = findAll();
    if (blocked.length) {
      console.warn(`${MODULE_ID} | Level-up button found but disabled`, blocked[0].className);
      ui.notifications.warn(
        "The level-up button is disabled, which means the character has not got the experience for the next level. Set 'How levelling works at your table' to Experience, or put the dnd5e system into its no-experience mode.",
        { permanent: true }
      );
      return false;
    }

    console.warn(`${MODULE_ID} | No level-up button matched`, LEVEL_UP_SELECTORS);
    ui.notifications.warn(
      "Could not find the level-up button on the sheet. It comes from Plutonium, so it appears only while Plutonium is active."
    );
    return false;
  }

  console.log(`${MODULE_ID} | Pressing Plutonium's level-up button.`);
  button.click();
  return true;
}

export async function pressSheetButton(actor, types, labels) {
  const sheet = actor.sheet;
  if (!sheet.rendered) {
    await sheet.render(true);
    await wait(300);
  }

  await ensureEditMode(actor);

  let button = findAddButton(actor.sheet.element, types, labels);
  if (!button) {
    // The sheet may still be redrawing after the mode switch.
    await wait(400);
    button = findAddButton(actor.sheet.element, types, labels);
  }

  if (!button) {
    ui.notifications.warn(
      "That button is not on the sheet right now. Put the sheet into edit mode and try again."
    );
    return false;
  }

  button.click();
  autoAdvance();
  return true;
}

/**
 * Which creation steps are still outstanding on an actor. Used to decide
 * whether to offer "Resume creation" at all.
 */
