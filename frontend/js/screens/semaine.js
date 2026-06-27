// Onglet PLANNING — 3 vues : Liste (mon planning), Calendrier (semaine, façon Odoo,
// avec le nom de la tâche), Équipe (ce que fait chaque collègue, visuel).
import { api } from "../api.js";
import { escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";
import { renderReport } from "./report.js";

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JOURS_C = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let offset = 0;
let view = "liste";   // "liste" | "calendrier" | "equipe"

export const semaine = {
  id: "planning",
  label: "Planning",
  icon: "calendar",
  async render(root) { await load(root); },
};

const localISO = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const hm = (dt) => (dt ? dt.slice(11, 16) : "");
const todayISO = () => localISO(new Date());

// Couleur + fond teinté selon le type d'intervention (déduit du libellé).
function typeStyle(label) {
  const t = (label || "").toLowerCase();
  if (t.includes("entretien")) return { c: "#2f8f63", s: "#e3f3ea" };
  if (t.includes("sav")) return { c: "#d99a2b", s: "#fbf0d8" };
  if (t.includes("dépann") || t.includes("depann") || t.includes("hivernage")) return { c: "#5957c9", s: "#ececfa" };
  return { c: "#127d89", s: "#e8f2f3" };
}

async function load(root) {
  root.innerHTML = `<h2>Planning</h2><div class="placeholder">Chargement…</div>`;
  let planning, team;
  try {
    [planning, team] = await Promise.all([
      api(`/week/planning?offset=${offset}`), api(`/week/team?offset=${offset}`),
    ]);
  } catch {
    root.innerHTML = `<h2>Planning</h2><div class="card" style="border-color:var(--danger)">Impossible de charger le planning.</div>`;
    return;
  }
  draw(root, planning, team);
}

function weekDates(weekStart) {
  const start = new Date(weekStart + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => localISO(new Date(start.getTime() + i * 86400000)));
}

function rangeTitle(weekStart) {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d) => d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" });
  return offset === 0 ? "Cette semaine" : `${fmt(start)} – ${fmt(end)}`;
}

function draw(root, planning, team) {
  const dates = weekDates(planning.week_start);
  const byDay = {};
  for (const s of planning.slots) (byDay[s.day] ||= []).push(s);

  const switcher = [
    ["liste", "list", "Liste"], ["calendrier", "grid", "Calendrier"], ["equipe", "users", "Gantt"],
  ].map(([v, ic, l]) => `<button class="chip ${v === view ? "active" : ""}" data-view="${v}" style="flex:1;justify-content:center">${icon(ic, "icon-sm")} ${l}</button>`).join("");

  let body;
  if (view === "liste") body = listView(dates, byDay);
  else if (view === "calendrier") body = calendarView(dates, byDay);
  else body = ganttView(team);

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <button class="btn secondary nav" id="prev" aria-label="Semaine précédente">‹</button>
      <strong style="font-family:var(--font-display)">${rangeTitle(planning.week_start)}</strong>
      <button class="btn secondary nav" id="next" aria-label="Semaine suivante">›</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px">${switcher}</div>
    ${body}`;

  root.querySelector("#prev").addEventListener("click", () => { offset -= 1; load(root); });
  root.querySelector("#next").addEventListener("click", () => { offset += 1; load(root); });
  root.querySelectorAll("[data-view]").forEach(b =>
    b.addEventListener("click", () => { view = b.dataset.view; draw(root, planning, team); }));

  // Clic sur une tâche (Liste / Calendrier / Gantt) → rapport d'intervention pré-rempli.
  root.querySelectorAll("[data-slot]").forEach(el =>
    el.addEventListener("click", () => openReport(root, Number(el.dataset.slot))));
}

// Ouvre le rapport d'intervention pour un créneau, avec les données client (Odoo).
async function openReport(root, slotId) {
  root.innerHTML = `<div class="placeholder"><div class="big">${icon("note")}</div>Chargement…</div>`;
  let s;
  try { s = await api(`/interventions/${slotId}`); }
  catch { await load(root); toast("Intervention introuvable."); return; }
  renderReport(root, {
    slot: { id: slotId, label: s.label, partner_id: s.partner_id, partner: s.partner, employee_ids: s.employee_ids, start_datetime: s.start_datetime, end_datetime: s.end_datetime },
    onDone: () => semaine.render(root),
  });
}

// --- Vue Liste : épurée, groupée par jour -----------------------------------
function listView(dates, byDay) {
  return dates.map((iso, i) => {
    const slots = byDay[iso] || [];
    const d = new Date(iso + "T00:00:00");
    const isToday = iso === todayISO();
    const rows = slots.length
      ? slots.map(s => {
          const st = typeStyle(s.label);
          return `<div class="ivrow" data-slot="${s.id}">
            <span class="ivbar" style="background:${st.c}"></span>
            <span class="ivtime">${hm(s.start_datetime)}</span>
            <span class="ivmain"><b>${escapeHtml(s.label)}</b>${s.partner_id ? `<span class="ivcli"> · ${escapeHtml(s.partner_id[1])}</span>` : ""}</span>
            ${icon("chevR", "chev")}
          </div>`;
        }).join("")
      : `<div class="ivempty">— Aucune intervention</div>`;
    return `<div class="daygroup">
      <div class="dayhead${isToday ? " today" : ""}"><span class="d">${JOURS[i]} ${d.getDate()}</span>${isToday ? `<span class="daytag">Aujourd'hui</span>` : ""}</div>
      ${rows}</div>`;
  }).join("");
}

// --- Vue Calendrier : colonnes de jours, blocs teintés par type --------------
function calendarView(dates, byDay) {
  const cols = dates.map((iso, i) => {
    const slots = byDay[iso] || [];
    const d = new Date(iso + "T00:00:00");
    const blocks = slots.length
      ? slots.map(s => {
          const st = typeStyle(s.label);
          return `<div class="cal-block" data-slot="${s.id}" style="cursor:pointer;background:${st.s};border-left-color:${st.c}">
            <div class="cal-time" style="color:${st.c}">${hm(s.start_datetime)}</div>
            <div class="cal-label">${escapeHtml(s.label)}${s.partner_id ? `<br><span class="muted">${escapeHtml(s.partner_id[1])}</span>` : ""}</div>
          </div>`;
        }).join("")
      : `<div class="cal-empty">·</div>`;
    return `<div class="cal-col${iso === todayISO() ? " today" : ""}">
      <div class="cal-head">${JOURS_C[i]}<br>${d.getDate()}</div>${blocks}</div>`;
  }).join("");
  return `<div class="cal-grid">${cols}</div>`;
}

// --- Vue Gantt : lignes = employés, colonnes = jours, segments par type ------
function ganttView(team) {
  if (!team.members || !team.members.length) return `<div class="placeholder">Aucune donnée d'équipe.</div>`;
  const head = team.dates.map((iso, i) =>
    `<th class="${iso === todayISO() ? "today" : ""}">${JOURS_C[i]} ${new Date(iso + "T00:00:00").getDate()}</th>`).join("");
  const rows = team.members.map(m => {
    const first = m.name.split(" ").slice(-1)[0];
    const cells = team.dates.map(iso => {
      const c = m.days[iso] || {};
      const slots = c.slots || [];
      let inner = "";
      if (slots.length) {
        inner = slots.map(s => { const st = typeStyle(s.label); return `<div class="seg" ${s.id ? `data-slot="${s.id}" style="background:${st.c};cursor:pointer"` : `style="background:${st.c}"`}><span class="gt">${escapeHtml(s.time)}</span> ${escapeHtml(s.label)}</div>`; }).join("");
      } else if (c.leave) {
        inner = `<span class="gleave">${icon("leaf", "icon-sm")} Absent</span>`;
      }
      return `<td>${inner}</td>`;
    }).join("");
    return `<tr><td class="gname">${escapeHtml(first)}</td>${cells}</tr>`;
  }).join("");
  return `<div class="card" style="padding:12px">
    <div class="gantt"><table class="gtable">
      <thead><tr><th class="gname"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="glegend">
      <span><span class="gdot" style="background:#127d89"></span>Mise en service</span>
      <span><span class="gdot" style="background:#2f8f63"></span>Entretien</span>
      <span><span class="gdot" style="background:#d99a2b"></span>SAV</span>
      <span><span class="gdot" style="background:#5957c9"></span>Dépannage</span>
    </div></div>`;
}
