// Onglet SEMAINE — planning navigable (semaine ±) + grille équipe (qui travaille / absent).
import { api } from "../api.js";
import { escapeHtml } from "../util.js";

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JOURS_C = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let offset = 0;

export const semaine = {
  id: "semaine",
  label: "Semaine",
  icon: "📅",
  async render(root) { await load(root); },
};

const localISO = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const hm = (dt) => (dt ? dt.slice(11, 16) : "");

async function load(root) {
  root.innerHTML = `<h2>Ma semaine</h2><div class="placeholder">Chargement…</div>`;
  let planning, team;
  try {
    [planning, team] = await Promise.all([
      api(`/week/planning?offset=${offset}`), api(`/week/team?offset=${offset}`),
    ]);
  } catch {
    root.innerHTML = `<h2>Ma semaine</h2><div class="card" style="border-color:var(--danger)">Impossible de charger la semaine.</div>`;
    return;
  }
  renderWeek(root, planning, team);
}

function renderWeek(root, planning, team) {
  const start = new Date(planning.week_start + "T00:00:00");
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d) => d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" });
  const byDay = {};
  for (const s of planning.slots) (byDay[s.day] ||= []).push(s);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const iso = localISO(d);
    const slots = byDay[iso] || [];
    const isToday = iso === localISO(new Date());
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
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <button class="btn secondary nav" id="prev" aria-label="Semaine précédente">‹</button>
      <div style="text-align:center">
        <strong>${offset === 0 ? "Cette semaine" : fmt(start) + " – " + fmt(end)}</strong>
      </div>
      <button class="btn secondary nav" id="next" aria-label="Semaine suivante">›</button>
    </div>
    ${days.join("")}
    ${teamGrid(team)}`;

  root.querySelector("#prev").addEventListener("click", () => { offset -= 1; load(root); });
  root.querySelector("#next").addEventListener("click", () => { offset += 1; load(root); });
}

function teamGrid(team) {
  const head = team.dates.map((d, i) =>
    `<th style="font-weight:600;font-size:.7rem;color:var(--muted);padding:4px 0">${JOURS_C[i]}<br>${new Date(d + "T00:00:00").getDate()}</th>`).join("");
  const rows = team.members.map(m => {
    const cells = team.dates.map(d => {
      const c = m.days[d] || {};
      const content = c.leave ? c.leave : (c.work ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok)"></span>` : "");
      return `<td style="text-align:center;padding:6px 0">${content}</td>`;
    }).join("");
    const first = m.name.split(" ").slice(-1)[0];
    return `<tr><td style="white-space:nowrap;padding:6px 8px 6px 0;font-size:.84rem">${escapeHtml(first)}</td>${cells}</tr>`;
  }).join("");
  return `
    <div class="card">
      <strong>Équipe</strong>
      <div style="overflow-x:auto;margin-top:10px">
        <table style="width:100%;border-collapse:collapse;min-width:300px">
          <thead><tr><th></th>${head}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:14px;margin-top:8px;font-size:.74rem;color:var(--muted)">
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok);vertical-align:middle"></span> travaille</span>
        <span>🌴/🤒 absent</span>
      </div>
    </div>`;
}