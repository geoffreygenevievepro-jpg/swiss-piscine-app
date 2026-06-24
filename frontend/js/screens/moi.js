// Onglet MOI — profil, validation manager, fiches de salaire, parcours.
// (Les soldes et congés sont dans l'onglet « Mes heures ».)
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml, toast } from "../util.js";

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
    let payslips, pending = [];
    try {
      payslips = await api("/rh/payslips");
      if (p.role === "manager") { try { pending = await api("/manager/leaves"); } catch {} }
    } catch {
      zone.innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger tes données.</div>`;
      return;
    }
    renderRH(root, zone, payslips, pending, p);
  },
};

function profileHeader(p) {
  const odoo = p.odoo || {};
  const sub = [odoo.job_title || p.role, p.activity_rate ? `${p.activity_rate} %` : null].filter(Boolean).join(" · ");
  const avatar = p.avatar
    ? `<img src="data:image/png;base64,${p.avatar}" alt="" style="width:60px;height:60px;border-radius:50%;object-fit:cover;flex:0 0 auto">`
    : `<div style="width:60px;height:60px;border-radius:50%;background:var(--aqua-dark);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;flex:0 0 auto">${escapeHtml((p.name || "?")[0])}</div>`;
  return `<div class="card" style="display:flex;gap:14px;align-items:center">
    ${avatar}
    <div style="min-width:0">
      <strong style="font-size:1.1rem">${escapeHtml(p.name || "—")}</strong>
      <div style="color:var(--muted);font-size:.9rem">${escapeHtml(sub)}</div>
      ${odoo.work_phone ? `<div style="color:var(--muted);font-size:.82rem">${escapeHtml(odoo.work_phone)}</div>` : ""}
    </div></div>`;
}

function renderRH(root, zone, payslips, pending, p) {
  zone.innerHTML = `
    ${managerCard(pending)}
    <div class="card">
      <strong>Mes fiches de salaire</strong>
      <div id="payslip-list" style="margin-top:10px">${payslipList(payslips)}</div>
    </div>
    ${resumeCard(p.resume)}`;

  zone.querySelector("#payslip-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-payslip]");
    if (b) downloadPayslip(Number(b.dataset.payslip), b.dataset.name);
  });
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

function managerCard(pending) {
  if (!pending || !pending.length) return "";
  const rows = pending.map(l => `
    <div style="padding:10px 0;border-top:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between">
        <strong>${escapeHtml(l.who)}</strong><span style="font-size:.8rem;color:var(--muted)">${l.number_of_days} j</span>
      </div>
      <div style="font-size:.84rem;color:var(--muted);margin:2px 0 8px">${l.icon} ${escapeHtml(l.type_label)} · ${l.request_date_from} → ${l.request_date_to}</div>
      <div style="display:flex;gap:8px">
        <button class="btn" data-act="approve" data-id="${l.id}" style="min-height:38px;padding:0 14px">✓ Approuver</button>
        <button class="btn secondary" data-act="refuse" data-id="${l.id}" style="min-height:38px;padding:0 14px;width:auto">Refuser</button>
      </div></div>`).join("");
  return `<div class="card" style="border-color:var(--warn)"><strong>📥 À valider (${pending.length})</strong><div style="margin-top:4px">${rows}</div></div>`;
}

function payslipList(payslips) {
  if (!payslips.length) return `<p style="color:var(--muted);margin:0">Aucune fiche de salaire.</p>`;
  return payslips.map(p => {
    const period = p.date_from ? p.date_from.slice(0, 7) : p.name;
    const net = p.net_wage ? p.net_wage.toLocaleString("fr-CH", { minimumFractionDigits: 2 }) + " CHF" : "";
    return `<div data-payslip="${p.id}" data-name="${escapeHtml(p.name)}.pdf"
        style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid var(--line);cursor:pointer">
      <div><strong>${escapeHtml(period)}</strong><div style="font-size:.82rem;color:var(--muted)">Net : ${escapeHtml(net)}</div></div>
      <span style="color:var(--aqua-dark)">⬇️ PDF</span></div>`;
  }).join("");
}

function resumeCard(resume) {
  if (!resume || !resume.length) return "";
  const items = resume.map(r => {
    const desc = (r.description || "").replace(/<[^>]+>/g, " ").trim();
    return `<div style="padding:8px 0;border-top:1px solid var(--line)">
      <strong>${escapeHtml(r.name)}</strong>${r.line_type_id ? `<span style="color:var(--muted);font-size:.8rem"> · ${escapeHtml(r.line_type_id[1])}</span>` : ""}
      ${desc ? `<div style="color:var(--muted);font-size:.84rem;margin-top:2px">${escapeHtml(desc)}</div>` : ""}</div>`;
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
