// Onglet « Je fais » — interventions du jour (bascule Jour/Semaine) + détail enrichi
// (historique client, fiche client, Démarrer→Rapport) + création (avec client rapide).
import { api } from "../api.js";
import { escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";
import { renderReport } from "./report.js";
import { semaine } from "./semaine.js";

let selectedDate = null;  // YYYY-MM-DD ; null = aujourd'hui
let mode = "jour";        // "jour" | "semaine" (bascule en tête de l'onglet « Je fais »)
// Permet à l'Accueil d'ouvrir directement le planning (mode semaine) via deep-link.
export function setTerrainMode(m) { mode = m; }
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };


export const terrain = {
  id: "terrain",
  label: "Rapport",
  icon: "tools",
  async render(root, ctx) {
    if (ctx && ctx.intent === "new") { renderReport(root, { create: true, onDone: () => terrain.render(root) }); return; }
    root.innerHTML = `${modeToggle()}<div id="t-content"></div>`;
    root.querySelectorAll("[data-mode]").forEach(b =>
      b.addEventListener("click", () => { mode = b.dataset.mode; terrain.render(root); }));
    const content = root.querySelector("#t-content");
    if (mode === "semaine") await semaine.render(content);
    else await renderJour(root, content);
  },
};

function modeToggle() {
  return `<div style="display:flex;gap:8px;margin-bottom:14px">
    ${["jour", "semaine"].map(m => `<button class="chip ${m === mode ? "active" : ""}" data-mode="${m}" style="flex:1">${m === "jour" ? "Jour" : "Semaine"}</button>`).join("")}
  </div>`;
}

async function renderJour(root, content) {
  const date = selectedDate || todayISO();
  content.innerHTML = `${dateHeader(date)}<div id="iv-zone"><div class="placeholder"><div class="big">${icon("note")}</div>Chargement…</div></div>`;
  bindDate(root);
  let data;
  try { data = await api(`/interventions/today?date=${date}`); }
  catch { content.querySelector("#iv-zone").innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger les interventions.</div>`; return; }
  renderList(root, data.interventions || []);
}

function dateHeader(date) {
  const d = new Date(date + "T00:00:00");
  const isToday = date === todayISO();
  return `
    <h2 style="margin:0 0 12px">Interventions</h2>
    <button class="btn" id="iv-add" style="min-height:60px;font-size:1.1rem;margin-bottom:14px">${icon("plus")} Ajouter une intervention</button>
    <div style="display:flex;align-items:center;gap:10px;margin:0 0 16px">
      <button class="btn secondary nav" id="d-prev" aria-label="Jour précédent">‹</button>
      <label style="flex:1;position:relative">
        <input id="d-date" type="date" value="${date}" style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;background:#fff;text-align:center;font-weight:600;color:var(--navy);cursor:pointer">
      </label>
      <button class="btn secondary nav" id="d-next" aria-label="Jour suivant">›</button>
    </div>
    ${isToday ? "" : `<p style="text-align:center;margin:-8px 0 12px"><button class="btn secondary" id="d-today" style="width:auto;min-height:34px;padding:0 14px;font-size:.85rem">Revenir à aujourd'hui</button></p>`}`;
}

function bindDate(root) {
  const shift = (days) => { const d = new Date((selectedDate || todayISO()) + "T00:00:00"); d.setDate(d.getDate() + days); selectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; terrain.render(root); };
  root.querySelector("#d-prev").addEventListener("click", () => shift(-1));
  root.querySelector("#d-next").addEventListener("click", () => shift(1));
  const dd = root.querySelector("#d-date");
  dd.addEventListener("change", (e) => { selectedDate = e.target.value || todayISO(); terrain.render(root); });
  // Ouvre le calendrier directement au clic / focus sur la barre de date.
  const openDD = () => { if (typeof dd.showPicker === "function") { try { dd.showPicker(); } catch {} } };
  dd.addEventListener("click", openDD); dd.addEventListener("focus", openDD);
  const t = root.querySelector("#d-today"); if (t) t.addEventListener("click", () => { selectedDate = null; terrain.render(root); });
  root.querySelector("#iv-add").addEventListener("click", () =>
    renderReport(root, { create: true, onDone: () => terrain.render(root) }));
}

function hm(dt) { return dt ? dt.slice(11, 16) : ""; }

// Couleur indicative selon le type d'intervention (déduit du libellé).
function typeColor(label) {
  const t = (label || "").toLowerCase();
  if (t.includes("entretien")) return "var(--ok)";
  if (t.includes("sav")) return "#e08a1e";
  if (t.includes("dépann") || t.includes("depann")) return "#2f7fd1";
  if (t.includes("hivernage")) return "#6c5ce7";
  return "var(--aqua-dark)";
}

function renderList(root, slots) {
  const zone = root.querySelector("#iv-zone");
  if (!slots.length) { zone.innerHTML = `<div class="placeholder"><div class="big">${icon("sun")}</div>Aucune intervention ce jour-là.</div>`; return; }
  zone.innerHTML = `<div id="slot-list">${slots.map(slotCard).join("")}</div>`;
  zone.querySelector("#slot-list").addEventListener("click", (e) => {
    const c = e.target.closest("[data-slot]"); if (c) renderDetail(root, Number(c.dataset.slot));
  });
}

function slotCard(s) {
  const done = s.state === "1_done";
  const accent = done ? "var(--ok)" : typeColor(s.label);
  const client = s.partner_id ? s.partner_id[1] : "";
  return `<div class="card" data-slot="${s.id}" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;border-left:4px solid ${accent}">
    <div style="flex:0 0 auto;text-align:center;min-width:48px">
      <div style="font-weight:700;color:${accent}">${hm(s.start_datetime)}</div>
      <div style="font-size:.72rem;color:var(--muted)">${hm(s.end_datetime)}</div></div>
    <div style="flex:1;min-width:0"><strong>${escapeHtml(s.label)}</strong>
      ${client ? `<div style="color:var(--muted);font-size:.88rem;margin-top:2px">${escapeHtml(client)}</div>` : ""}
      ${done ? `<div style="font-size:.75rem;color:var(--ok);margin-top:4px;display:flex;align-items:center;gap:4px">${icon("check", "icon-sm")} Terminé</div>` : ""}</div>
    <span style="color:var(--muted);align-self:center">›</span></div>`;
}

async function renderDetail(root, slotId) {
  root.innerHTML = `<button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button><div class="placeholder">Chargement…</div>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));
  let s;
  try { s = await api(`/interventions/${slotId}`); }
  catch { root.querySelector(".placeholder").textContent = "Intervention introuvable."; return; }
  const pn = s.partner || {};
  const addr = [pn.street, pn.street2, [pn.zip, pn.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const tel = pn.phone;
  const maps = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
  const accent = s.state === "1_done" ? "var(--ok)" : typeColor(s.label);
  const historyCard = (s.history && s.history.length) ? `
    <div class="card"><strong>Historique client</strong>
      ${s.history.map(h => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--line)">
        <span style="min-width:0">${escapeHtml(h.name || "—")}</span>
        <span style="color:var(--muted);font-size:.82rem;white-space:nowrap">${escapeHtml(h.date || "")}${h.stage ? " · " + escapeHtml(h.stage) : ""}</span>
      </div>`).join("")}
    </div>` : "";
  const ficheCard = s.known_issues ? `
    <details class="card"><summary style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:8px">${icon("note", "icon-sm")} Fiche client</summary>
      <p style="white-space:pre-line;color:var(--muted);font-size:.86rem;margin:10px 0 0">${escapeHtml(s.known_issues)}</p>
    </details>` : "";

  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0;border-left:4px solid ${accent};padding-left:10px">${escapeHtml(s.label)}</h2>
    <div class="card"><strong>Horaire</strong><p style="color:var(--muted);margin:.3rem 0 0">${hm(s.start_datetime)} – ${hm(s.end_datetime)}</p></div>
    ${s.partner_id ? `<div class="card"><strong>${escapeHtml(pn.name || s.partner_id[1])}</strong>${addr ? `<p style="color:var(--muted);margin:.4rem 0 0">${escapeHtml(addr)}</p>` : ""}</div>
    <div style="display:flex;gap:10px">
      ${tel ? `<a class="btn" href="tel:${escapeHtml(tel)}" style="text-decoration:none">${icon("phone", "icon-sm")} Appeler</a>` : ""}
      ${maps ? `<a class="btn secondary" href="${maps}" target="_blank" rel="noopener" style="text-decoration:none">${icon("navigation", "icon-sm")} Itinéraire</a>` : ""}
    </div>` : ""}
    ${ficheCard}
    ${historyCard}
    <button class="btn" id="do-start" style="margin-top:16px">${icon("play", "icon-sm")} Démarrer l'intervention</button>
    <button class="btn secondary" id="do-report" style="margin-top:8px">${icon("note", "icon-sm")} Rapport (sans chrono)</button>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));
  const back = (msg) => { terrain.render(root); if (msg) toast(msg); };
  root.querySelector("#do-start").addEventListener("click", () =>
    renderReport(root, { slot: { id: slotId, label: s.label, partner_id: s.partner_id, partner: s.partner, employee_ids: s.employee_ids, start_datetime: s.start_datetime, end_datetime: s.end_datetime }, autoStart: true, onDone: back }));
  root.querySelector("#do-report").addEventListener("click", () =>
    renderReport(root, { slot: { id: slotId, label: s.label, partner_id: s.partner_id, partner: s.partner, employee_ids: s.employee_ids, start_datetime: s.start_datetime, end_datetime: s.end_datetime }, onDone: back }));
}

