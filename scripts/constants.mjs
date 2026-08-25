/**
 * constants.mjs
 * ---------------------------------------------------------------------------
 * Shared identifiers. Kept in its own file so no module has to import another
 * just to learn the package id.
 */

export const MODULE_ID = "prosty-kreator-5e";

/**
 * The importer, by the two names its own code answers to.
 *
 * These are NOT ours to choose. IMPORTER_ID is the package id Foundry knows it
 * by, and IMPORTER_FLAG is the flag namespace it writes onto every item it
 * creates - the source book, the page, the hash, whether a class was the
 * primary one. Reading those flags is how compendium matching and multiclass
 * detection work at all.
 *
 * They live here, and only here, so that everywhere else can speak of "the
 * importer" and the literal appears twice in the codebase rather than in a
 * dozen files. Changing either value does not rename anything - it stops the
 * module reading data that is already on the sheet.
 */
export const IMPORTER_ID = "plutonium";
export const IMPORTER_FLAG = "plutonium";

/**
 * The label on the importer's own button, matched as text.
 *
 * Its dialog offers a choice of tool and we answer it by pressing the button
 * that says this. Like the ids above, it is their wording, not ours.
 */
export const IMPORTER_BUTTON_LABEL = "use plutonium";
