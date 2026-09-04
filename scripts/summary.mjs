/**
 * summary.mjs
 * ---------------------------------------------------------------------------
 * Posts a short character card to chat, so the GM sees new arrivals without
 * opening every sheet.
 */

import { MODULE_ID } from "./constants.mjs";

export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

export function buildSummary(actor) {
  const system = actor.system ?? {};
  const find = (types) => actor.items.find((i) => types.includes(i.type));

  const species = find(["race", "species"])?.name ?? "—";
  const background = find(["background"])?.name ?? "—";
  const cls = find(["class"]);
  const className = cls ? `${cls.name} ${cls.system?.levels ?? 1}` : "—";

  const abilities = Object.entries(system.abilities ?? {})
    .map(([key, value]) => {
      const score = Number(value.value) || 10;
      const mod = Math.floor((score - 10) / 2);
      const label = (CONFIG.DND5E?.abilities?.[key]?.abbreviation ?? key).toUpperCase();
      return `<div class="pk5e-card-ability">
        <span class="pk5e-card-abbr">${escape(label)}</span>
        <span class="pk5e-card-score">${score}</span>
        <span class="pk5e-card-mod">${mod >= 0 ? `+${mod}` : mod}</span>
      </div>`;
    })
    .join("");

  const hp = system.attributes?.hp?.max ?? 0;
  const ac = system.attributes?.ac?.value ?? "—";
  const speed = system.attributes?.movement?.walk ?? 0;

  return `<div class="pk5e-card">
    <header class="pk5e-card-head">
      <img src="${escape(actor.img)}" alt="" width="48" height="48">
      <div>
        <h3>${escape(actor.name)}</h3>
        <p>${escape(species)} &middot; ${escape(background)} &middot; ${escape(className)}</p>
      </div>
    </header>
    <div class="pk5e-card-stats">
      <span><strong>HP</strong> ${hp}</span>
      <span><strong>AC</strong> ${ac}</span>
      <span><strong>Speed</strong> ${speed}</span>
    </div>
    <div class="pk5e-card-abilities">${abilities}</div>
  </div>`;
}

export async function postSummary(actor) {
  if (!actor) return null;
  try {
    return await ChatMessage.create({
      content: buildSummary(actor),
      speaker: { alias: actor.name }
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not post the summary`, err);
    ui.notifications.error(`Could not post the summary: ${err.message}`);
    return null;
  }
}
