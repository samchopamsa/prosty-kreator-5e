/**
 * equipment.mjs
 * ---------------------------------------------------------------------------
 * Starting equipment.
 *
 * The dnd5e Advancement system deliberately does NOT grant starting equipment -
 * it only stores the data. Classes and backgrounds carry system.startingEquipment,
 * a flat list of nodes forming a tree via the `group` field:
 *
 *   group: ""        -> a top level choice the player must resolve
 *   type: "OR"       -> pick exactly one child
 *   type: "AND"      -> take every child
 *   type: "linked"   -> a specific item, key holds its UUID
 *   type: "weapon" / "armor" / "tool" / "focus"
 *                    -> a category, key holds e.g. "martialM" or "shield"
 *   count            -> quantity (null means 1)
 *
 * Classes also carry system.wealth: the gold you may take instead of gear.
 */

import { MODULE_ID, getEnabledPackIds } from "./sources.mjs";

let CANDIDATE_CACHE = null;

/** Item document types worth scanning for equipment candidates. */
const CANDIDATE_TYPES = ["weapon", "equipment", "tool", "consumable", "container"];

export function clearCandidateCache() {
  CANDIDATE_CACHE = null;
}

/**
 * Scans enabled compendiums once and groups physical items by document type and
 * by their system.type.value, which is what startingEquipment keys refer to.
 */
async function getCandidatePool() {
  if (CANDIDATE_CACHE) return CANDIDATE_CACHE;

  const pool = { byType: {}, byCategory: {} };
  for (const packId of getEnabledPackIds()) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== "Item") continue;

    let index;
    try {
      index = await pack.getIndex({ fields: ["system.type.value", "system.type.baseItem"] });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not index ${packId} for equipment`, err);
      continue;
    }

    for (const entry of index) {
      if (!CANDIDATE_TYPES.includes(entry.type)) continue;
      const record = {
        uuid: `Compendium.${pack.collection}.${entry._id}`,
        name: entry.name,
        img: entry.img,
        docType: entry.type,
        category: entry.system?.type?.value ?? ""
      };
      (pool.byType[entry.type] ??= []).push(record);
      const catKey = `${entry.type}:${record.category}`;
      (pool.byCategory[catKey] ??= []).push(record);
    }
  }

  for (const list of Object.values(pool.byType)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const list of Object.values(pool.byCategory)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  CANDIDATE_CACHE = pool;
  return pool;
}

/** Which document type a startingEquipment category node maps to. */
function docTypeFor(nodeType) {
  switch (nodeType) {
    case "weapon":
      return "weapon";
    case "armor":
    case "focus":
      return "equipment";
    case "tool":
      return "tool";
    default:
      return null;
  }
}

/**
 * Candidate items for a category node. Falls back to every item of the right
 * document type when the exact category yields nothing, so the player is never
 * stuck with an empty dropdown.
 */
async function candidatesFor(node) {
  const pool = await getCandidatePool();
  const docType = docTypeFor(node.type);
  if (!docType) return { list: [], fallback: false };

  const exact = pool.byCategory[`${docType}:${node.key}`] ?? [];
  if (exact.length) return { list: exact, fallback: false };

  // "sim" / "mar" proficiency keys cover several concrete categories.
  if (node.type === "weapon" && /^(sim|mar)$/.test(node.key)) {
    const prefix = node.key === "sim" ? "simple" : "martial";
    const merged = (pool.byType.weapon ?? []).filter((i) =>
      String(i.category).startsWith(prefix)
    );
    if (merged.length) return { list: merged, fallback: false };
  }

  return { list: pool.byType[docType] ?? [], fallback: true };
}

/** Human label for a category node, e.g. "Any martial melee weapon". */
function categoryLabel(node) {
  const C = CONFIG.DND5E ?? {};
  const lookup =
    C.weaponTypes?.[node.key] ??
    C.weaponProficiencies?.[node.key] ??
    C.armorTypes?.[node.key] ??
    C.toolTypes?.[node.key] ??
    C.focusTypes?.[node.key]?.label ??
    node.key;
  const label = typeof lookup === "string" ? lookup : (lookup?.label ?? node.key);
  return `Any ${String(label).toLowerCase()}`;
}

/**
 * Turns one source item (class or background) into a render-ready plan.
 */
async function planForSource(kind, entry) {
  const doc = await fromUuid(entry.uuid);
  if (!doc) return null;

  const nodes = doc.system?.startingEquipment ?? [];
  if (!nodes.length) return null;

  const childrenOf = (id) =>
    nodes.filter((n) => (n.group ?? "") === id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  /** Flattens a node into concrete leaves the player will receive. */
  const flatten = async (node) => {
    if (node.type === "AND") {
      const out = [];
      for (const child of childrenOf(node._id)) out.push(...(await flatten(child)));
      return out;
    }
    if (node.type === "OR") {
      // A nested OR is rare; take its first branch rather than nesting the UI.
      const first = childrenOf(node._id)[0];
      return first ? await flatten(first) : [];
    }
    if (node.type === "linked") {
      const item = await fromUuid(node.key).catch(() => null);
      return [
        {
          id: node._id,
          kind: "linked",
          uuid: node.key,
          name: item?.name ?? "Unknown item",
          img: item?.img ?? "icons/svg/item-bag.svg",
          count: node.count ?? 1,
          needsPick: false
        }
      ];
    }
    const { list, fallback } = await candidatesFor(node);
    return [
      {
        id: node._id,
        kind: "category",
        name: categoryLabel(node),
        count: node.count ?? 1,
        needsPick: true,
        fallback,
        candidates: list.map((c) => ({ uuid: c.uuid, name: c.name }))
      }
    ];
  };

  const groups = [];
  for (const root of childrenOf("")) {
    if (root.type === "OR") {
      const options = [];
      for (const child of childrenOf(root._id)) {
        const parts = await flatten(child);
        options.push({
          id: child._id,
          label: parts
            .map((p) => (p.count > 1 ? `${p.name} x${p.count}` : p.name))
            .join(" + "),
          parts
        });
      }
      groups.push({ id: root._id, isChoice: true, options });
    } else {
      const parts = await flatten(root);
      groups.push({
        id: root._id,
        isChoice: false,
        options: [
          {
            id: root._id,
            label: parts
              .map((p) => (p.count > 1 ? `${p.name} x${p.count}` : p.name))
              .join(" + "),
            parts
          }
        ]
      });
    }
  }

  let wealth = doc.system?.wealth ?? "";
  return {
    kind,
    sourceName: entry.name,
    wealth: String(wealth ?? ""),
    hasWealth: !!wealth,
    groups
  };
}

/** Full plan for the current wizard selections. */
export async function buildEquipmentPlan(wizard) {
  const plan = [];
  for (const kind of ["class", "background"]) {
    const entry = wizard[kind];
    if (!entry) continue;
    try {
      const part = await planForSource(kind, entry);
      if (part) plan.push(part);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read starting equipment of ${entry.name}`, err);
    }
  }
  return plan;
}

/**
 * Resolves the player's choices into concrete item data plus a gold total.
 */
export async function resolveEquipment(plan, state) {
  const items = [];
  let gold = 0;

  for (const source of plan) {
    if (state.mode?.[source.kind] === "gold") {
      gold += await evaluateWealth(source.wealth);
      continue;
    }

    for (const group of source.groups) {
      const chosenId = group.isChoice
        ? (state.choices?.[group.id] ?? group.options[0]?.id)
        : group.options[0]?.id;
      const option = group.options.find((o) => o.id === chosenId) ?? group.options[0];
      if (!option) continue;

      for (const part of option.parts) {
        const uuid = part.needsPick ? state.picks?.[part.id] : part.uuid;
        if (!uuid) continue;
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) continue;
        const data = doc.toObject();
        delete data._id;
        if (part.count > 1) foundry.utils.setProperty(data, "system.quantity", part.count);
        items.push(data);
      }
    }
  }

  return { items, gold };
}

/** Starting wealth may be a plain number or a dice formula. */
async function evaluateWealth(wealth) {
  if (!wealth) return 0;
  const asNumber = Number(wealth);
  if (Number.isFinite(asNumber)) return asNumber;
  try {
    const roll = await new Roll(String(wealth)).evaluate();
    return roll.total;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not evaluate wealth formula "${wealth}"`, err);
    return 0;
  }
}

/** True when every category choice has a concrete item selected. */
export function equipmentComplete(plan, state) {
  for (const source of plan) {
    if (state.mode?.[source.kind] === "gold") continue;
    for (const group of source.groups) {
      const chosenId = group.isChoice
        ? (state.choices?.[group.id] ?? group.options[0]?.id)
        : group.options[0]?.id;
      const option = group.options.find((o) => o.id === chosenId) ?? group.options[0];
      if (!option) continue;
      for (const part of option.parts) {
        if (part.needsPick && !state.picks?.[part.id]) return false;
      }
    }
  }
  return true;
}
