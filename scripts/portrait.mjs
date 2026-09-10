/**
 * portrait.mjs
 * ---------------------------------------------------------------------------
 * Setting a character's portrait, in the two ways a player actually has one.
 *
 * WHY NOT THE FILE PICKER
 * -----------------------
 * The button used to open Foundry's own file browser, which is a file manager:
 * a source dropdown (Data, Public, S3), a directory tree, an upload control
 * that quietly uploads into whatever folder happens to be open, and a path
 * field. A player who has a picture on their desktop has to understand all of
 * it in order to get the picture onto their character, and the one thing they
 * are most likely to get wrong - which folder the upload lands in - is the one
 * thing nobody can see afterwards.
 *
 * A portrait arrives in exactly two ways: a file on this computer, or a link to
 * one on the internet. So the screen offers those two and nothing else, and the
 * folder is decided here rather than by whatever the browser was last showing.
 *
 * WHAT IT NEEDS FROM FOUNDRY
 * --------------------------
 * Uploading is a permission (FILES_UPLOAD), and a player may not have it. That
 * is not an error to report at the end - the upload half is simply not offered,
 * and the link half still works, because a link needs no permission at all.
 *
 * The folder is created on demand, one segment at a time. createDirectory
 * throws when the directory is already there, which is the normal case and not
 * worth reporting.
 *
 * THE TOKEN IS PART OF SETTING A PORTRAIT
 * ---------------------------------------
 * A portrait set here has always been written onto the prototype token as well,
 * but that only covers the portraits this screen sets. Foundry keeps the two
 * pictures independent: clicking the portrait on the character sheet, dropping
 * a file onto it, or letting an importer set it changes `img` and leaves
 * `prototypeToken.texture.src` as the mystery man - and the player, who just
 * watched their picture appear, has no reason to suspect there is a second
 * picture hidden in the token configuration.
 *
 * So the same rule as for names (see naming.mjs): when a character's portrait
 * changes, the token follows it - but only while the token is still carrying a
 * picture nobody chose, which means the placeholder, nothing at all, or the
 * portrait being replaced. A token deliberately set to something else (a wolf
 * for a druid's wild shape, a hooded figure over a character whose face is a
 * secret) is a real use and is left exactly as it is.
 *
 * Tokens already standing on a scene are updated too, under the same rule.
 * Changing the prototype changes nothing about a token dragged out yesterday,
 * and "right on the sheet, right in the token settings, wrong on the map" is
 * the worst of the three states to be left in.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";

/** Where uploads land unless the GM says otherwise. */
export const DEFAULT_PORTRAIT_FOLDER = "assets/portrety";

/** The class moved namespaces across Foundry versions, so ask in turn. */
function filePicker() {
  return (
    foundry.applications?.apps?.FilePicker?.implementation ??
    foundry.applications?.apps?.FilePicker ??
    globalThis.FilePicker ??
    null
  );
}

export function portraitFolder() {
  const raw = String(game.settings.get(MODULE_ID, "portraitFolder") ?? "").trim();
  return (raw || DEFAULT_PORTRAIT_FOLDER).replace(/^\/+|\/+$/g, "");
}

/**
 * Creates the folder if it is not there, a segment at a time.
 *
 * Failure is not fatal: the upload is attempted anyway, and if the folder truly
 * cannot be made it is the upload that will say so, with a better message than
 * anything invented here.
 */
async function ensureFolder(FP, folder) {
  let path = "";
  for (const part of folder.split("/").filter(Boolean)) {
    path = path ? `${path}/${part}` : part;
    try {
      await FP.createDirectory("data", path);
    } catch (err) {
      // Already there, which is the usual answer.
    }
  }
}

/** Uploads one file into the portrait folder and returns where it landed. */
async function uploadPortrait(file) {
  const FP = filePicker();
  if (!FP?.upload) throw new Error("Uploading is not available in this version.");

  const folder = portraitFolder();
  await ensureFolder(FP, folder);

  const result = await FP.upload("data", folder, file, {}, { notify: false });
  const path = result?.path ?? "";
  if (!path) throw new Error("The upload returned no path.");
  return path;
}

/**
 * Foundry's and the system's stand-in pictures - the ones a token wears because
 * nobody has chosen anything, not because somebody picked them.
 *
 * Matched on the path rather than against one constant, because the default has
 * moved between Foundry versions and a world carries tokens made under several
 * of them.
 *
 * The second pattern is the one that earns its keep, and the width of it is
 * deliberate. Measured across a live world (2026-09-10, 10 characters and 69
 * actors): the stand-in a fresh dnd5e character actually wears is
 * `systems/dnd5e/icons/svg/actors/character.svg` - the system's own default,
 * not Foundry's mystery man, which appeared on nothing. Narrowing this to
 * mystery-man alone would therefore match none of the tokens the rule exists
 * for. In that same world no token sat anywhere under `icons/svg/` except those
 * three placeholders, so the breadth costs nothing measurable: a deliberately
 * chosen core icon is the case it could get wrong, and there were none.
 */
const PLACEHOLDER_IMAGES = [/mystery-man/i, /(^|\/)icons\/svg\//i];

/** Whether a picture is one nobody chose. Nothing at all counts as one. */
export function isPlaceholderImage(path) {
  const img = String(path ?? "").trim();
  if (!img) return true;
  return PLACEHOLDER_IMAGES.some((pattern) => pattern.test(img));
}

/**
 * Fields that carry a new portrait onto the prototype token, or nothing.
 *
 * The actor handed in is the one BEFORE the change, so `actor.img` is the
 * portrait being replaced - and that is what tells a token which was following
 * the portrait from one that was set deliberately.
 *
 * @param   {object} actor   with `img` and `prototypeToken`
 * @param   {string} newImg
 * @returns {object} fields to merge into an actor update, possibly empty
 */
export function tokenImageUpdate(actor, newImg) {
  const img = String(newImg ?? "").trim();
  if (!img) return {};

  const token = actor?.prototypeToken ?? {};
  const current = String(token?.texture?.src ?? "").trim();
  const previous = String(actor?.img ?? "").trim();

  const isUnchosen = isPlaceholderImage(current) || current === previous;
  if (!isUnchosen || current === img) return {};

  const update = { "prototypeToken.texture.src": img };

  // A dynamic token ring keeps its own copy of the picture (the subject
  // texture). Left alone while it is empty, because then the ring draws
  // texture.src and there is nothing to keep in step; replaced when it holds
  // the portrait being changed, or the ring would go on showing the old face.
  const subject = String(token?.ring?.subject?.texture ?? "").trim();
  if (subject && (subject === previous || subject === current)) {
    update["prototypeToken.ring.subject.texture"] = img;
  }

  return update;
}

/** The prototype field names, as a placed token spells them. */
function placedTokenUpdate(token, newImg, previousImg) {
  const update = tokenImageUpdate({ img: previousImg, prototypeToken: token }, newImg);
  const keys = Object.keys(update);
  if (!keys.length) return null;

  const out = { _id: token.id };
  for (const key of keys) out[key.replace(/^prototypeToken\./, "")] = update[key];
  return out;
}

/**
 * The same rule for tokens already placed on scenes.
 *
 * Linked tokens only: an unlinked one is a copy with a life of its own, and
 * repainting it is not something a portrait change should be doing. Failures
 * are swallowed per scene - a player who may not write to a scene is the
 * ordinary case here, not an error worth reporting.
 */
async function syncPlacedTokens(actor, newImg, previousImg) {
  if (!actor?.id || !newImg || !game.scenes) return;

  for (const scene of game.scenes) {
    let updates = [];
    try {
      updates = scene.tokens
        .filter((token) => token.actorId === actor.id && token.actorLink !== false)
        .map((token) => placedTokenUpdate(token, newImg, previousImg))
        .filter(Boolean);
    } catch (err) {
      continue;
    }
    if (!updates.length) continue;

    try {
      await scene.updateEmbeddedDocuments("Token", updates);
    } catch (err) {
      // Usually a scene this user may not write to. The prototype is already
      // fixed, so the next token placed is right either way.
    }
  }
}

/**
 * Writes the portrait onto the character and its token.
 *
 * Both, deliberately: a portrait set only on the sheet leaves the token as the
 * mystery man, and the player who set it has no idea why.
 */
async function applyPortrait(actor, path) {
  if (!actor || !path) return false;
  const previous = actor.img ?? null;
  // Flagged so the watch below does not do the same work a second time.
  await actor.update({ img: path, ...tokenImageUpdate(actor, path) }, { pk5ePortrait: true });
  await syncPlacedTokens(actor, path, previous);
  return true;
}

/**
 * Watches for a portrait set anywhere else - the sheet, a drop, an importer -
 * and carries it onto the token.
 *
 * Guarded the same three ways as the rename watch in naming.mjs: only when the
 * portrait actually changed, only on the client that changed it, and only when
 * the token was wearing a picture nobody chose. The portrait before the change
 * is not among the hook's arguments, so it is captured just before the write.
 */
let portraitHook = null;
let previousImgHook = null;

export function startTokenImageSync() {
  if (portraitHook !== null) return;

  portraitHook = Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (!changes?.img) return;
    if (actor.type !== "character") return;

    // Already written as one update by applyPortrait, which is where the
    // panel's own portrait screen goes.
    if (options?.pk5ePortrait) return;

    const previous = options?.pk5ePreviousImg ?? null;
    const update = tokenImageUpdate(
      { img: previous ?? actor.img, prototypeToken: actor.prototypeToken },
      changes.img
    );

    if (Object.keys(update).length) {
      try {
        await actor.update(update);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not set the token image`, err);
      }
    }

    await syncPlacedTokens(actor, changes.img, previous);
  });

  // Held in its own variable so stopping takes BOTH hooks off. Kept together:
  // one without the other reads the portrait before the change from an actor
  // that already carries the one after it.
  previousImgHook = Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (changes?.img) options.pk5ePreviousImg = actor.img;
  });
}

export function stopTokenImageSync() {
  if (portraitHook === null) return;
  Hooks.off("updateActor", portraitHook);
  Hooks.off("preUpdateActor", previousImgHook);
  portraitHook = null;
  previousImgHook = null;
}

/**
 * The screen itself: upload a file, or paste a link.
 *
 * @param   {Actor}    actor
 * @returns {Promise<boolean>}  Whether a portrait was set.
 */
export async function choosePortrait(actor) {
  if (!actor) return false;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) return legacyPicker(actor);

  const canUpload = !!game.user?.can?.("FILES_UPLOAD");
  const folder = portraitFolder();
  const current = actor.img ?? "";

  const content = `
    <div class="pk5e-portrait-dialog">
      ${
        canUpload
          ? `<label class="pk5e-label" for="pk5e-portrait-file">${t("portrait.fromDisk")}</label>
             <input type="file" id="pk5e-portrait-file" name="file" accept="image/*">
             <p class="pk5e-note">${t("portrait.folderNote", folder)}</p>`
          : `<p class="pk5e-note">${t("portrait.noUpload")}</p>`
      }
      <label class="pk5e-label" for="pk5e-portrait-url">${t("portrait.fromWeb")}</label>
      <input type="text" id="pk5e-portrait-url" name="url" value="${current}"
             placeholder="https://..." autocomplete="off">
      <p class="pk5e-note">${t("portrait.urlNote")}</p>
    </div>`;

  let chosen = null;
  try {
    await DialogV2.wait({
      window: { title: t("portrait.title"), icon: "fa-solid fa-image" },
      classes: ["pk5e-creator"],
      content,
      buttons: [
        {
          action: "set",
          label: t("portrait.set"),
          default: true,
          // The file wins over the field when both are filled in: choosing a
          // file is the more deliberate act, and the field arrives with the
          // current portrait already in it.
          callback: (event, button) => {
            const form = button.form;
            const file = form.elements.file?.files?.[0] ?? null;
            const url = String(form.elements.url?.value ?? "").trim();
            chosen = file ? { file } : url && url !== current ? { url } : null;
          }
        },
        { action: "cancel", label: t("portrait.cancel") }
      ]
    });
  } catch (err) {
    // Closed with the X, which is a cancellation like any other.
    return false;
  }

  if (!chosen) return false;

  try {
    const path = chosen.file ? await uploadPortrait(chosen.file) : chosen.url;
    await applyPortrait(actor, path);
    ui.notifications.info("Portrait set.");
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | Could not set the portrait`, err);
    ui.notifications.error(`Could not set the portrait: ${err.message}`);
    return false;
  }
}

/**
 * Foundry's own browser, for a version too old for DialogV2.
 *
 * Kept as a fallback rather than the main road: it is the screen this module
 * exists to avoid, but a dead button is worse than a confusing one.
 */
async function legacyPicker(actor) {
  const FP = filePicker();
  if (!FP) {
    ui.notifications.warn("The file picker is not available in this version.");
    return false;
  }
  try {
    new FP({
      type: "image",
      current: actor.img,
      callback: (path) => applyPortrait(actor, path)
    }).render(true);
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | Could not open the file picker`, err);
    return false;
  }
}
