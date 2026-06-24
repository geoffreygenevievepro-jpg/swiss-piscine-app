// Onglet SEMAINE — planning de la semaine (lecture) + absences de l'équipe.
import { api } from "../api.js";
import { escapeHtml } from "../util.js";

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export const semaine = {
  id: "semaine",
  label: "Semaine",
  icon: "📅",

  async render(root) {
    root.innerHTML = `<h2>Ma semaine</h2><div class="placeholder">Chargement…</div>`;
    let planning, absences;
    try {
      [planning, absences] = await Promise.all([api("/week/planning"), api("/week/absences")]);
    } catch {
      root.innerHTML = `<h2>Ma semaine</h2><div class="card" style="border-color:var(--danger)">Impossible de charger la semaine.</div>`;
      return;
    }
    renderWeek(root, planning, absences);
  },
};

function hm(dt) { return dt ? dt.slice(11, 16) : ""; }

function renderWeek(root, planning, absences) {
  const start = new Date(planning.week_start + "T00:00:00");
  const byDay = {};
  for (const s of planning.slots) (byDay[s.day] ||= []).push(s);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const slots = byDay[iso] || [];
    const isToday = iso === new Date().toISOString().slice(0, 10);
    days.push(`
      <div class="card" style="margin-bottom:10px;${isToday ? "border-color:var(--aqua)" : ""}">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong>${JOURS[i]} ${d.getDate()}</strong>
          ${isToday ? `<span style="font-size:.72rem;color:var(--aqua-dark)">aujourd'hui</span>` : ""}
        </div>
        ${slots.length
          ? slots.map(s => `<div style="display:flex;gap:10px;margin-top:8px">
              <span style="font-weight:600;color:var(--aqua-dark);flex:0 0 auto">${hm(s.start_datetime)}</span>
              <span style="min-width:0">${escapeHtml(s.label)}${s.partner_id ? ` · <span style="color:var(--muted)">${escapeHtml(s.partner_id[1])}</span>` : ""}</span>
            </div>`).join("")
          : `<div style="color:var(--muted);font-size:.85rem;margin-top:6px">—</div>`}
      </div>`);
  }

  root.innerHTML = `
    <h2>Ma semaine</h2>
    ${days.join("")}
    <div class="card">
      <strong>Équipe absente cette semaine</strong>
      <div style="margin-top:10px">${absenceList(absences.absences)}</div>
    </div>`;
}

function absenceList(absences) {
  if (!absences.length) return `<p style="color:var(--muted);margin:0">Personne d'absent cette semaine 👍</p>`;
  return absences.map(a => {
    const who = a.employee_id ? a.employee_id[1] : "—";
    const type = a.work_entry_type_id ? a.work_entry_type_id[1] : "Absence";
    return `<div style="display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--line)">
      <strong>${escapeHtml(who)}</strong>
      <span style="font-size:.8rem;color:var(--muted)">${escapeHtml(type)} · ${a.request_date_from} → ${a.request_date_to}</span>
    </div>`;
  }).join("");
}
