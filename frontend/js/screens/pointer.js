// Onglet « Mes heures » (ex-Pointer) — timbrage + résumé heures (jour/semaine/mois,
// façon Tipee : demi-jauges + tableau) + soldes + mes congés.
import { api } from "../api.js";
import { fmtClock, escapeHtml, toast } from "../util.js";

let timer = null;
const clearTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
let period = "week", offset = 0;

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
  });
}
function fmtH(h) {
  const sign = h < 0 ? "-" : "";
  const a = Math.abs(h), hh = Math.floor(a), mm = Math.round((a - hh) * 60);
  return `${sign}${hh}h${String(mm).padStart(2, "0")}`;
}

export const pointer = {
  id: "pointer",
  label: "Mes heures",
  icon: "🕐",
  async render(root) {
    clearTimer();
    root.innerHTML = `<h2>Mes heures</h2><div class="placeholder"><div class="big">🕐</div>Chargement…</div>`;
    let status, summary, balances, leaves;
    try {
      [status, summary, balances, leaves] = await Promise.all([
        api("/attendance/status"),
        api(`/attendance/summary?period=${period}&offset=${offset}`),
        api("/rh/balances"), api("/rh/leaves"),
      ]);
    } catch {
      root.innerHTML = `<h2>Mes heures</h2><div class="card" style="border-color:var(--danger)">Impossible de joindre le serveur.</div>`;
      return;
    }
    draw(root, status, summary, balances, leaves);
  },
};

function halfGauge(valueHtml, sublabel) {
  return `<div class="card" style="flex:1;margin:0;text-align:center;padding-bottom:14px">
    <svg viewBox="0 0 100 54" style="width:120px;max-width:100%;overflow:visible">
      <path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="var(--aqua-soft)" stroke-width="9" stroke-linecap="round"/>
      <path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="var(--aqua)" stroke-width="9" stroke-linecap="round" stroke-dasharray="138" stroke-dashoffset="34"/>
    </svg>
    <div style="font-size:1.45rem;font-weight:700;margin-top:-22px;font-family:var(--font-display)">${valueHtml}</div>
    <div style="font-size:.76rem;color:var(--muted);margin-top:4px">${escapeHtml(sublabel)}</div>
  </div>`;
}

function periodTitle(start) {
  const d = new Date(start + "T00:00:00");
  if (period === "day") return offset === 0 ? "Aujourd'hui" : d.toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long" });
  if (period === "month") return d.toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
  const end = new Date(d.getTime() + 6 * 86400000);
  return offset === 0 ? "Cette semaine"
    : `${d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })}`;
}

function summaryTable(buckets) {
  const todayIso = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; })();
  const rows = buckets.map(b => {
    const d = new Date(b.date + "T00:00:00");
    const isToday = b.date === todayIso;
    const soldeColor = b.solde < 0 ? "var(--danger)" : "var(--ok)";
    return `<tr style="${isToday ? "background:var(--aqua-soft)" : ""}">
      <td style="padding:7px 8px;white-space:nowrap">${d.toLocaleDateString("fr-CH", { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
      <td style="text-align:right;padding:7px 8px;font-weight:600">${fmtH(b.worked)}</td>
      <td style="text-align:right;padding:7px 8px;color:var(--muted)">${b.due ? fmtH(b.due) : "—"}</td>
      <td style="text-align:right;padding:7px 8px;color:${soldeColor};font-weight:600">${fmtH(b.solde)}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.86rem">
    <thead><tr style="color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em">
      <th style="text-align:left;padding:4px 8px">Date</th><th style="text-align:right;padding:4px 8px">Réalisé</th>
      <th style="text-align:right;padding:4px 8px">À faire</th><th style="text-align:right;padding:4px 8px">Solde</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function draw(root, status, summary, balances, leaves) {
  clearTimer();
  const isIn = status.state === "in";
  const openStart = isIn ? new Date(status.open_since).getTime() : null;
  const baseToday = status.today_seconds, t0 = Date.now();
  const mainLabel = isIn ? "⏹️ Pointer la sortie" : (status.count > 0 ? "▶️ Reprendre" : "▶️ Commencer ma journée");
  const vac = balances.leaves.find(l => l.unit === "day");

  root.innerHTML = `
    <h2 style="margin-bottom:10px">Mes heures</h2>

    <button class="btn" id="punch" style="${isIn ? "background:var(--danger)" : ""}">${mainLabel}</button>
    <div style="display:flex;gap:10px;margin:12px 0">
      <div class="card" style="flex:1;margin:0;text-align:center;${isIn ? "border-color:var(--aqua)" : ""}">
        <div id="elapsed" style="font-size:1.2rem;font-weight:700">${isIn ? fmtClock(Math.floor((Date.now() - openStart) / 1000)) : "—"}</div>
        <div style="font-size:.76rem;color:var(--muted)">${isIn ? "En cours" : "Au repos"}</div></div>
      <div class="card" style="flex:1;margin:0;text-align:center">
        <div id="today-total" style="font-size:1.2rem;font-weight:700">${fmtH(baseToday / 3600)}</div>
        <div style="font-size:.76rem;color:var(--muted)">Aujourd'hui</div></div>
    </div>
    <p id="punch-msg" style="text-align:center;color:var(--ok);margin:0 0 8px;min-height:1.1em;font-size:.9rem"></p>

    <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px">
      <button class="btn secondary nav" id="prev">‹</button>
      <strong style="font-family:var(--font-display);text-transform:capitalize">${periodTitle(summary.start)}</strong>
      <button class="btn secondary nav" id="next">›</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      ${["day", "week", "month"].map(p => `<button class="chip ${p === period ? "active" : ""}" data-period="${p}" style="flex:1">${{ day: "Jour", week: "Semaine", month: "Mois" }[p]}</button>`).join("")}
    </div>

    <div style="display:flex;gap:12px;margin-bottom:14px">
      ${halfGauge(`<span style="color:${summary.solde_total < 0 ? "var(--danger)" : "var(--ok)"}">${fmtH(summary.solde_total)}</span>`, "Solde de travail")}
      ${halfGauge(`${vac ? vac.remaining : 0}`, "Jours de vacances")}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:8px">
        <span style="color:var(--muted)">Réalisé <strong style="color:var(--ink)">${fmtH(summary.worked_total)}</strong></span>
        <span style="color:var(--muted)">À faire <strong style="color:var(--ink)">${fmtH(summary.due_total)}</strong></span>
      </div>
      ${summaryTable(summary.buckets)}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>Mes congés</strong>
        <button class="btn" id="ask-leave" style="width:auto;min-height:38px;padding:0 14px">＋ Demander</button>
      </div>
      <div style="margin-top:10px">${leaveList(leaves)}</div>
    </div>`;

  // Timbrage
  if (isIn) {
    timer = setInterval(() => {
      const el = root.querySelector("#elapsed");
      if (!el) return clearTimer();
      el.textContent = fmtClock(Math.floor((Date.now() - openStart) / 1000));
      root.querySelector("#today-total").textContent = fmtH((baseToday + Math.floor((Date.now() - t0) / 1000)) / 3600);
    }, 1000);
  }
  const btn = root.querySelector("#punch"), msg = root.querySelector("#punch-msg");
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> localisation…`;
    const pos = await getPosition();
    try {
      await api(isIn ? "/attendance/check-out" : "/attendance/check-in", { method: "POST", body: pos || {} });
      pointer.render(root);
    } catch {
      btn.disabled = false; btn.textContent = mainLabel;
      msg.style.color = "var(--danger)"; msg.textContent = "Échec du pointage. Réessaie.";
    }
  });

  // Période
  root.querySelector("#prev").addEventListener("click", () => { offset -= 1; pointer.render(root); });
  root.querySelector("#next").addEventListener("click", () => { offset += 1; pointer.render(root); });
  root.querySelectorAll("[data-period]").forEach(b =>
    b.addEventListener("click", () => { period = b.dataset.period; offset = 0; pointer.render(root); }));

  // Congés
  root.querySelector("#ask-leave").addEventListener("click", () => renderLeaveForm(root));
}

const LEAVE_STATE = {
  draft: ["Brouillon", "grey"], confirm: ["À valider", "pending"], validate1: ["1re validation", "pending"],
  validate: ["Validé", "ok"], refuse: ["Refusé", "danger"], cancel: ["Annulé", "grey"],
};
function leaveList(leaves) {
  if (!leaves.length) return `<p style="color:var(--muted);margin:0">Aucune demande de congé.</p>`;
  return leaves.map(l => {
    const [lbl, cls] = LEAVE_STATE[l.state] || [l.state, "grey"];
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line)">
      <div style="min-width:0"><strong>${l.icon || "🗓️"} ${escapeHtml(l.type_label || "Congé")}</strong>
        <div style="font-size:.82rem;color:var(--muted)">${l.request_date_from} → ${l.request_date_to} · ${l.number_of_days} j</div></div>
      <span class="badge badge-${cls}">${escapeHtml(lbl)}</span></div>`;
  }).join("");
}

async function renderLeaveForm(root) {
  const back = () => pointer.render(root);
  let types = [];
  try { types = await api("/rh/leave-types"); } catch {}
  const n = new Date();
  const iso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0">Demander un congé</h2>
    <form id="leave-form">
      <p class="form-error" id="leave-error"></p>
      <div class="field"><label>Type</label>
        <select id="l-type" style="width:100%;min-height:52px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;background:#fbfdfe">
          ${types.map(t => `<option value="${t.id}">${t.icon} ${escapeHtml(t.label)}${t.remaining ? ` (${t.remaining} restant)` : ""}</option>`).join("")}
        </select></div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Du</label><input id="l-from" type="date" value="${iso}" required /></div>
        <div class="field" style="flex:1"><label>Au</label><input id="l-to" type="date" value="${iso}" required /></div>
      </div>
      <div class="field"><label>Motif (optionnel)</label><input id="l-name" type="text" placeholder="Ex. vacances d'été" /></div>
      <button class="btn" type="submit" id="l-submit">Envoyer la demande</button>
    </form>`;
  root.querySelector("#back").addEventListener("click", back);
  const form = root.querySelector("#leave-form"), err = root.querySelector("#leave-error"), submit = root.querySelector("#l-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    const body = { type_id: Number(form.querySelector("#l-type").value), date_from: form.querySelector("#l-from").value, date_to: form.querySelector("#l-to").value, name: form.querySelector("#l-name").value.trim() };
    if (!body.type_id || !body.date_from || !body.date_to) { err.textContent = "Type et dates obligatoires."; return; }
    if (body.date_to < body.date_from) { err.textContent = "La date de fin doit être après le début."; return; }
    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try { await api("/rh/leaves", { method: "POST", body }); back(); toast("Demande envoyée ✓"); }
    catch { submit.disabled = false; submit.textContent = "Envoyer la demande"; err.textContent = "Échec de l'envoi."; }
  });
}
