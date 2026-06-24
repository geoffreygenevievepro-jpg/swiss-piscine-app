// Onglet MOI — profil (avatar + taux), soldes en jauges, congés (badges + icônes),
// demande de congé (types curés), fiches de salaire, parcours.
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml, toast } from "../util.js";

const LEAVE_STATE = {
  draft: ["Brouillon", "grey"], confirm: ["À valider", "pending"],
  validate1: ["1re validation", "pending"], validate: ["Validé", "ok"],
  refuse: ["Refusé", "danger"], cancel: ["Annulé", "grey"],
};

let _ctx = { logout: () => {} };

export const moi = {
  id: "moi",
  label: "Moi",
  icon: "👤",

  async render(root, ctx) {
    if (ctx) _ctx = ctx;
    const p = profile.get() || {};
    root.innerHTML = `
      ${profileHeader(p)}
      <div id="rh-zone"><div class="placeholder">Chargement…</div></div>
      <button class="btn secondary" id="logout-btn" style="margin-top:8px">Se déconnecter</button>`;
    root.querySelector("#logout-btn").addEventListener("click", _ctx.logout);

    const zone = root.querySelector("#rh-zone");
    let balances, leaves, payslips, pending = [];
    try {
      [balances, leaves, payslips] = await Promise.all([
        api("/rh/balances"), api("/rh/leaves"), api("/rh/payslips"),
      ]);
      if (p.role === "manager") {
        try { pending = await api("/manager/leaves"); } catch {}
      }
    } catch {
      zone.innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger tes données RH.</div>`;
      return;
    }
    renderRH(root, zone, balances, leaves, payslips, p, pending);
  },
};

function managerCard(pending) {
  if (!pending || !pending.length) return "";
  const rows = pending.map(l => `
    <div style="padding:10px 0;border-top:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between">
        <strong>${escapeHtml(l.who)}</strong>
        <span style="font-size:.8rem;color:var(--muted)">${l.number_of_days} j</span>
      </div>
      <div style="font-size:.84rem;color:var(--muted);margin:2px 0 8px">${l.icon} ${escapeHtml(l.type_label)} · ${l.request_date_from} → ${l.request_date_to}</div>
      <div style="display:flex;gap:8px">
        <button class="btn" data-act="approve" data-id="${l.id}" style="min-height:38px;padding:0 14px">✓ Approuver</button>
        <button class="btn secondary" data-act="refuse" data-id="${l.id}" style="min-height:38px;padding:0 14px;width:auto">Refuser</button>
      </div>
    </div>`).join("");
  return `<div class="card" style="border-color:var(--warn)">
    <strong>📥 À valider (${pending.length})</strong>
    <div style="margin-top:4px">${rows}</div></div>`;
}

function profileHeader(p) {
  const odoo = p.odoo || {};
  const sub = [odoo.job_title || p.role, p.activity_rate ? `${p.activity_rate} %` : null]
    .filter(Boolean).join(" · ");
  const avatar = p.avatar
    ? `<img src="data:image/png;base64,${p.avatar}" alt="" style="width:60px;height:60px;border-radius:50%;object-fit:cover;flex:0 0 auto">`
    : `<div style="width:60px;height:60px;border-radius:50%;background:var(--aqua-dark);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;flex:0 0 auto">${escapeHtml((p.name || "?")[0])}</div>`;
  return `
    <div class="card" style="display:flex;gap:14px;align-items:center">
      ${avatar}
      <div style="min-width:0">
        <strong style="font-size:1.1rem">${escapeHtml(p.name || "—")}</strong>
        <div style="color:var(--muted);font-size:.9rem">${escapeHtml(sub)}</div>
        ${odoo.work_phone ? `<div style="color:var(--muted);font-size:.82rem">${escapeHtml(odoo.work_phone)}</div>` : ""}
      </div>
    </div>`;
}

function renderRH(root, zone, balances, leaves, payslips, p, pending) {
  zone.innerHTML = `
    ${managerCard(pending)}
    ${balanceGauges(balances)}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>Mes congés</strong>
        <button class="btn" id="ask-leave" style="width:auto;min-height:38px;padding:0 14px">＋ Demander</button>
      </div>
      <div style="margin-top:10px">${leaveList(leaves)}</div>
    </div>
    <div class="card">
      <strong>Mes fiches de salaire</strong>
      <div id="payslip-list" style="margin-top:10px">${payslipList(payslips)}</div>
    </div>
    ${resumeCard(p.resume)}`;

  root.querySelector("#ask-leave").addEventListener("click", () => renderLeaveForm(root));
  root.querySelector("#payslip-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-payslip]");
    if (b) downloadPayslip(Number(b.dataset.payslip), b.dataset.name);
  });
  // Validation manager (approuver / refuser un congé).
  zone.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    b.disabled = true;
    try {
      await api(`/manager/leaves/${b.dataset.id}/${b.dataset.act}`, { method: "POST" });
      toast(b.dataset.act === "approve" ? "Congé approuvé ✓" : "Congé refusé");
      moi.render(root, _ctx);
    } catch { b.disabled = false; toast("Action impossible."); }
  });
}

// --- Jauges circulaires (conic-gradient), façon tipee go ---
function balanceGauges(b) {
  const rings = b.leaves.map(l =>
    ring(`${l.remaining}`, l.unit === "hour" ? "h" : "j", `${l.icon} ${l.label}`, l.remaining, l.unit === "hour" ? 40 : 25));
  rings.push(ring((b.overtime_hours || 0).toFixed(1), "h", "⏱️ Solde d'heures", Math.abs(b.overtime_hours || 0), 20));
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">${rings.join("")}</div>`;
}

function ring(value, unit, label, val, refMax) {
  const pct = Math.max(0.04, Math.min(1, (val || 0) / refMax));
  const deg = Math.round(pct * 360);
  return `<div class="card" style="flex:1;min-width:140px;text-align:center;margin:0">
    <div class="ring" style="background:conic-gradient(var(--aqua) ${deg}deg, var(--line) ${deg}deg)">
      <div class="ring-in"><span style="font-size:1.3rem;font-weight:700">${escapeHtml(value)}</span><span style="font-size:.7rem;color:var(--muted)">${unit}</span></div>
    </div>
    <div style="font-size:.8rem;color:var(--muted);margin-top:8px">${escapeHtml(label)}</div>
  </div>`;
}

function leaveList(leaves) {
  if (!leaves.length) return `<p style="color:var(--muted);margin:0">Aucune demande de congé.</p>`;
  return leaves.map(l => {
    const [lbl, cls] = LEAVE_STATE[l.state] || [l.state, "grey"];
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line)">
      <div style="min-width:0"><strong>${l.icon || "🗓️"} ${escapeHtml(l.type_label || "Congé")}</strong>
        <div style="font-size:.82rem;color:var(--muted)">${l.request_date_from} → ${l.request_date_to} · ${l.number_of_days} j</div></div>
      <span class="badge badge-${cls}">${escapeHtml(lbl)}</span>
    </div>`;
  }).join("");
}

function payslipList(payslips) {
  if (!payslips.length) return `<p style="color:var(--muted);margin:0">Aucune fiche de salaire.</p>`;
  return payslips.map(p => {
    const period = p.date_from ? p.date_from.slice(0, 7) : p.name;
    const net = p.net_wage ? p.net_wage.toLocaleString("fr-CH", { minimumFractionDigits: 2 }) + " CHF" : "";
    return `<div data-payslip="${p.id}" data-name="${escapeHtml(p.name)}.pdf"
        style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid var(--line);cursor:pointer">
      <div><strong>${escapeHtml(period)}</strong>
        <div style="font-size:.82rem;color:var(--muted)">Net : ${escapeHtml(net)}</div></div>
      <span style="color:var(--aqua-dark)">⬇️ PDF</span>
    </div>`;
  }).join("");
}

function resumeCard(resume) {
  if (!resume || !resume.length) return "";
  const items = resume.map(r => {
    const desc = (r.description || "").replace(/<[^>]+>/g, " ").trim();
    return `<div style="padding:8px 0;border-top:1px solid var(--line)">
      <strong>${escapeHtml(r.name)}</strong>
      ${r.line_type_id ? `<span style="color:var(--muted);font-size:.8rem"> · ${escapeHtml(r.line_type_id[1])}</span>` : ""}
      ${desc ? `<div style="color:var(--muted);font-size:.84rem;margin-top:2px">${escapeHtml(desc)}</div>` : ""}
    </div>`;
  }).join("");
  return `<div class="card"><strong>Parcours & compétences</strong><div style="margin-top:8px">${items}</div></div>`;
}

async function downloadPayslip(id, name) {
  try {
    const res = await api(`/rh/payslips/${id}/pdf`);
    if (!res.available) { toast("PDF indisponible pour cette fiche."); return; }
    const a = document.createElement("a");
    a.href = `data:application/pdf;base64,${res.datas}`;
    a.download = res.name || name || "fiche-salaire.pdf";
    document.body.appendChild(a); a.click(); a.remove();
  } catch { toast("Téléchargement impossible."); }
}

async function renderLeaveForm(root) {
  const back = () => moi.render(root, _ctx);
  let types = [];
  try { types = await api("/rh/leave-types"); } catch {}

  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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
      <p style="color:var(--muted);font-size:.82rem;text-align:center;margin-top:10px">La demande sera validée par le bureau.</p>
    </form>`;
  root.querySelector("#back").addEventListener("click", back);

  const form = root.querySelector("#leave-form");
  const err = root.querySelector("#leave-error");
  const submit = root.querySelector("#l-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const body = {
      type_id: Number(root.querySelector("#l-type").value),
      date_from: root.querySelector("#l-from").value,
      date_to: root.querySelector("#l-to").value,
      name: root.querySelector("#l-name").value.trim(),
    };
    if (!body.type_id || !body.date_from || !body.date_to) { err.textContent = "Type et dates obligatoires."; return; }
    if (body.date_to < body.date_from) { err.textContent = "La date de fin doit être après le début."; return; }
    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try {
      await api("/rh/leaves", { method: "POST", body });
      back();
      toast("Demande envoyée ✓");
    } catch {
      submit.disabled = false; submit.textContent = "Envoyer la demande";
      err.textContent = "Échec de l'envoi de la demande.";
    }
  });
}