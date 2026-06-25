// Onglet « Admin » (rôle admin uniquement) — heures par employé + tous les congés
// (liste ou calendrier d'ensemble de toute l'équipe).
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml } from "../util.js";
import { icon } from "../icons.js";
import { messageBanner, wireBanner } from "../banner.js";

const JOURS_C = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
let leaveView = "liste";  // "liste" | "calendrier"
let monthOffset = 0;
let announcement = null;

function fmtH(h) {
  const s = h < 0 ? "-" : "";
  const a = Math.abs(h || 0), hh = Math.floor(a), mm = Math.round((a - hh) * 60);
  return `${s}${hh}h${String(mm).padStart(2, "0")}`;
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const cardHead = (title, ic) => `<div class="card-head"><div class="t">${icon(ic)}<h3>${title}</h3></div></div>`;

export const admin = {
  id: "admin",
  label: "Admin",
  icon: "users",
  async render(root) {
    const p = profile.get() || {};
    if (p.role !== "admin") {
      root.innerHTML = `<h2>Admin</h2><div class="card">Accès réservé à l'administration.</div>`;
      return;
    }
    root.innerHTML = `<h2>Admin</h2><div id="adm"><div class="placeholder"><div class="big">${icon("users")}</div>Chargement…</div></div>`;
    const zone = root.querySelector("#adm");
    let hours, leaves;
    try {
      [hours, leaves, announcement] = await Promise.all([
        api("/admin/employees-hours"), api("/admin/leaves"), api("/announcement").catch(() => ({})),
      ]);
    } catch {
      zone.innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger les données admin.</div>`;
      return;
    }
    draw(root, zone, hours, leaves);
  },
};

function draw(root, zone, hours, leaves) {
  zone.innerHTML = messageBanner(announcement, true) + hoursCard(hours) + leavesSection(leaves);
  wireBanner(zone);
  zone.querySelectorAll("[data-lv]").forEach(b =>
    b.addEventListener("click", () => { leaveView = b.dataset.lv; monthOffset = leaveView === "calendrier" ? monthOffset : 0; draw(root, zone, hours, leaves); }));
  const prev = zone.querySelector("#m-prev"), next = zone.querySelector("#m-next");
  if (prev) prev.addEventListener("click", () => { monthOffset -= 1; draw(root, zone, hours, leaves); });
  if (next) next.addEventListener("click", () => { monthOffset += 1; draw(root, zone, hours, leaves); });
}

// --- Heures par employé ------------------------------------------------------
function hoursCard(hours) {
  const rows = (hours || []).map(e => `<tr>
    <td>${escapeHtml(e.name)}</td>
    <td class="tabular">${fmtH(e.day)}</td><td class="tabular">${fmtH(e.week)}</td>
    <td class="tabular">${fmtH(e.month)}</td><td class="tabular">${fmtH(e.year)}</td></tr>`).join("");
  return `<div class="card">
    ${cardHead("Heures par employé", "clock")}
    <div style="overflow-x:auto;margin-top:10px"><table class="adm-table">
      <thead><tr><th>Employé</th><th>Jour</th><th>Sem.</th><th>Mois</th><th>Année</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">Aucun employé.</td></tr>`}</tbody></table></div>
  </div>`;
}

// --- Congés : liste / calendrier d'ensemble ----------------------------------
const LEAVE_STATE = {
  confirm: ["En attente", "pending"], validate1: ["En attente", "pending"],
  validate: ["Validé", "ok"], refuse: ["Refusé", "danger"], cancel: ["Annulé", "grey"],
};

function leaveColor(l) {
  const t = (l.type_label || "").toLowerCase();
  if (t.includes("vacance")) return "#127d89";
  if (t.includes("maladie")) return "#e0735a";
  if (t.includes("accident")) return "#d99a2b";
  return "#5957c9";
}

function leavesSection(leaves) {
  const toggle = [["liste", "list", "Liste"], ["calendrier", "grid", "Calendrier"]]
    .map(([v, ic, l]) => `<button class="chip ${v === leaveView ? "active" : ""}" data-lv="${v}" style="flex:1;justify-content:center">${icon(ic, "icon-sm")} ${l}</button>`).join("");
  const body = leaveView === "liste" ? leavesList(leaves) : leavesCalendar(leaves);
  return `<div class="card">
    ${cardHead("Demandes de congé", "leaf")}
    <div style="display:flex;gap:8px;margin:12px 0 14px">${toggle}</div>
    ${body}
  </div>`;
}

function leavesList(leaves) {
  if (!leaves.length) return `<p class="muted" style="margin:0">Aucune demande.</p>`;
  return leaves.map(l => {
    const [lbl, cls] = LEAVE_STATE[l.state] || [l.state, "grey"];
    return `<div class="row" style="justify-content:space-between;padding:9px 0">
      <div style="min-width:0;display:flex;align-items:center;gap:9px"><span class="dot" style="background:${leaveColor(l)}"></span>
        <div style="min-width:0"><strong>${escapeHtml(l.who)}</strong>
          <div class="muted" style="font-size:.82rem">${escapeHtml(l.type_label || "Congé")} · ${l.request_date_from} → ${l.request_date_to} · ${l.number_of_days} j</div></div></div>
      <span class="badge badge-${cls}">${escapeHtml(lbl)}</span></div>`;
  }).join("");
}

function leavesCalendar(leaves) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = base.getFullYear(), month = base.getMonth();
  const title = base.toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
  const startPad = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const active = (leaves || []).filter(l => l.state !== "refuse" && l.state !== "cancel");
  const todayStr = iso(new Date());

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(`<div class="mc-cell mc-empty"></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const dstr = iso(new Date(year, month, day));
    const offs = active.filter(l => l.request_date_from <= dstr && dstr <= l.request_date_to);
    const chips = offs.slice(0, 4).map(l => {
      const last = l.who.split(" ").slice(-1)[0] || "?";
      return `<span class="mc-chip" style="background:${leaveColor(l)}" title="${escapeHtml(l.who)} — ${escapeHtml(l.type_label || "")}">${escapeHtml(last.slice(0, 3))}</span>`;
    }).join("");
    const more = offs.length > 4 ? `<span class="mc-more">+${offs.length - 4}</span>` : "";
    cells.push(`<div class="mc-cell${dstr === todayStr ? " today" : ""}"><span class="mc-d">${day}</span>${chips}${more}</div>`);
  }
  const head = JOURS_C.map(j => `<div class="mc-h">${j}</div>`).join("");
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <button class="btn secondary nav" id="m-prev" aria-label="Mois précédent">${icon("chevL", "icon-sm")}</button>
      <strong style="font-family:var(--font-display);text-transform:capitalize">${title}</strong>
      <button class="btn secondary nav" id="m-next" aria-label="Mois suivant">${icon("chevR", "icon-sm")}</button>
    </div>
    <div class="mc-grid">${head}${cells.join("")}</div>`;
}
