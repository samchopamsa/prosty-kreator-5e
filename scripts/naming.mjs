/**
 * naming.mjs
 * ---------------------------------------------------------------------------
 * Two small things that both concern telling characters apart.
 *
 * Folders arrive from game.folders as a flat collection with a parent
 * reference, which is right for storage and wrong for a dropdown: a list
 * showing "Players", "Creatures", "P7" in alphabetical order says nothing about
 * which sits inside which, and two folders can share a name at different depths.
 *
 * Names have the matching problem. Foundry's Create Actor makes "New Character"
 * every time, so a world ends up with six of them - which is how an earlier
 * session had verify() report on an empty sheet while the real character sat
 * three rows below under the same name.
 */

/**
 * Actor folders as a tree, flattened back into display order with depth.
 *
 * Ordered so each folder is followed by its children, and named with an indent
 * that shows the nesting. The indent uses non-breaking spaces because a select
 * element collapses ordinary ones.
 */
export function folderChoices(selectedId = null) {
  const all = game.folders.filter((folder) => folder.type === "Actor");

  // The parent reference is a document in some Foundry versions and a bare id
  // in others; both appear in the wild, so neither is assumed.
  const parentIdOf = (folder) => {
    const parent = folder.folder;
    if (!parent) return null;
    return typeof parent === "string" ? parent : (parent.id ?? null);
  };

  const childrenOf = new Map();
  for (const folder of all) {
    const key = parentIdOf(folder) ?? "root";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(folder);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const out = [];
  const walk = (key, depth) => {
    for (const folder of childrenOf.get(key) ?? []) {
      out.push({
        id: folder.id,
        name: folder.name,
        depth,
        // Indented rather than shown as a path, so the names stay readable in
        // a narrow select.
        label: `${"\u00A0\u00A0\u00A0".repeat(depth)}${depth ? "└ " : ""}${folder.name}`,
        selected: folder.id === selectedId
      });
      // Guarded against a folder that is somehow its own ancestor, which would
      // otherwise loop until the tab dies.
      if (depth < 10) walk(folder.id, depth + 1);
    }
  };
  walk("root", 0);

  // Anything whose parent is missing would be invisible otherwise - better an
  // odd position in the list than an unreachable folder.
  const seen = new Set(out.map((entry) => entry.id));
  for (const folder of all) {
    if (seen.has(folder.id)) continue;
    out.push({
      id: folder.id,
      name: folder.name,
      depth: 0,
      label: folder.name,
      selected: folder.id === selectedId
    });
  }

  return out;
}

/**
 * A name nobody else in the world is using.
 *
 * "New Character" becomes "New Character (2)", then "(3)". An existing number
 * in brackets is treated as one of the series rather than part of the name, so
 * a second "New Character (2)" becomes "(3)" and not "New Character (2) (2)".
 *
 * @param {string} desired
 * @param {string} [ignoreId]  an actor allowed to keep its own name
 */
export function uniqueActorName(desired, ignoreId = null) {
  const base = String(desired ?? "").trim() || "New Character";
  const stem = base.replace(/\s*\(\d+\)\s*$/, "");

  const taken = new Set(
    game.actors.contents
      .filter((actor) => actor.id !== ignoreId)
      .map((actor) => actor.name)
  );

  if (!taken.has(stem)) return stem;

  // Starts at 2 because the unnumbered name is the first of the series.
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }

  // A thousand of them means something else is wrong; a timestamp at least
  // stays unique rather than failing.
  return `${stem} (${Date.now()})`;
}


/**
 * Keeps a token's name in step with its character's.
 *
 * prototypeToken.name is copied from the actor once, when the actor is created,
 * and never again: renaming "New Character" to "Łucznik" leaves the token
 * saying "New Character" on every hover and in every combat tracker.
 *
 * Only replaced when the token still carries a name nobody chose - the actor's
 * previous name, or one of the placeholders. A token deliberately named
 * something else ("Hooded Stranger" over a character whose name is a secret) is
 * a real use and is left alone.
 *
 * @returns {object} fields to merge into an actor update, possibly empty
 */
export function tokenNameUpdate(actor, newName, placeholders = []) {
  const tokenName = actor?.prototypeToken?.name ?? "";
  const actorName = actor?.name ?? "";

  const isUnchosen =
    !tokenName ||
    tokenName === actorName ||
    placeholders.some((placeholder) =>
      placeholder instanceof RegExp ? placeholder.test(tokenName) : tokenName === placeholder
    );

  if (!isUnchosen || tokenName === newName) return {};
  return { "prototypeToken.name": newName };
}

/**
 * Watches for renames and carries the new name onto the token.
 *
 * A hook rather than something wired into this module's own panel, because
 * renaming almost always happens on the character sheet - the panel is not
 * where a player types their character's name.
 *
 * Guarded three ways. Only when the name actually changed, or the update we
 * make here would trigger us again. Only for the client that made the change,
 * so five connected players do not all send the same write. And only when the
 * token's name was one nobody chose.
 */
let renameHook = null;

export function startTokenNameSync(placeholders = []) {
  if (renameHook !== null) return;

  renameHook = Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (!changes?.name) return;
    if (actor.type !== "character") return;

    // Compared against the name before the change, which is what the token
    // would still be carrying if nobody had touched it.
    const previous = options?.pk5ePreviousName ?? null;
    const update = tokenNameUpdate(
      { ...actor, name: previous ?? actor.name, prototypeToken: actor.prototypeToken },
      changes.name,
      placeholders
    );
    if (!Object.keys(update).length) return;

    try {
      await actor.update(update);
    } catch (err) {
      console.warn("prosty-kreator-5e | Could not rename the token", err);
    }
  });

  // The previous name is not in the hook's arguments, so it is captured just
  // before the write and handed along in the options.
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (changes?.name) options.pk5ePreviousName = actor.name;
  });
}

export function stopTokenNameSync() {
  if (renameHook === null) return;
  Hooks.off("updateActor", renameHook);
  renameHook = null;
}
