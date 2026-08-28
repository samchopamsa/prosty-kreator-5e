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
 * How large a linked picture may be before it is left where it is.
 *
 * A portrait is a small square. Anything past this is a wallpaper somebody
 * pasted the address of, and copying those into the world folder is how the
 * folder stops being small. Over the limit the link still works - it is only
 * the copy that is declined.
 */
const MAX_COPY_BYTES = 4 * 1024 * 1024;

/** Whether this is an address to fetch, rather than a path we already hold. */
export function isRemote(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return new URL(url).origin !== globalThis.location?.origin;
  } catch (err) {
    return false;
  }
}

/**
 * One file per character, named after it.
 *
 * Not the name the picture had on the far end: those are `image.png` as often
 * as anything, and two characters would overwrite each other. Named for the
 * character and its id, a portrait set five times replaces itself five times
 * instead of leaving five files behind.
 */
export function copyNameFor(actor, mime) {
  const ext = String(mime ?? "").split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
  const slug =
    String(actor?.name ?? "portrait")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "portrait";
  return `${slug}-${String(actor?.id ?? "").slice(0, 8)}.${ext}`;
}

/**
 * Fetches a linked picture and keeps it in the portrait folder.
 *
 * WHY BOTHER, when the link works on its own: it does not work everywhere. The
 * sheet shows a plain <img> and is happy with any address, but the token is a
 * canvas texture loaded through PIXI, which asks the far server for permission
 * it often does not give - so the portrait appears on the sheet and the token
 * stays empty. A copy is also in the world backup, and survives the page it
 * came from being taken down.
 *
 * Returns "" whenever the copy cannot be made - no upload permission, the
 * server refusing cross-origin reads, something that is not an image, or
 * something too big. Every one of those is a reason to fall back to the link
 * rather than to fail: the link is what the player asked for.
 */
async function copyFromWeb(actor, url) {
  if (!game.user?.can?.("FILES_UPLOAD")) return "";

  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return "";

    const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!mime.startsWith("image/")) return "";

    const blob = await response.blob();
    if (!blob.size || blob.size > MAX_COPY_BYTES) return "";

    const name = copyNameFor(actor, blob.type || mime);
    return await uploadPortrait(new File([blob], name, { type: blob.type || mime }));
  } catch (err) {
    // A cross-origin refusal arrives here as a TypeError with nothing useful in
    // it. Not worth an error to the player: the link is about to be used.
    console.warn(`${MODULE_ID} | Could not copy the linked portrait, using the link`, err);
    return "";
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
  await actor.update({ img: path, "prototypeToken.texture.src": path });
  return true;
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
    let path = "";
    if (chosen.file) {
      path = await uploadPortrait(chosen.file);
    } else {
      // A link is copied into the world where that is possible, and used as a
      // link where it is not. The player is told which of the two happened,
      // because a portrait that lives on somebody else's server is a portrait
      // that can disappear.
      path = isRemote(chosen.url) ? await copyFromWeb(actor, chosen.url) : "";
      if (!path) {
        path = chosen.url;
        if (isRemote(chosen.url)) ui.notifications.info(t("portrait.keptAsLink"));
      }
    }
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
