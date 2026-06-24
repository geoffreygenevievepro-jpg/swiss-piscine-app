// Onglet MOI — profil, soldes, congés (consultation + demande), fiches de salaire.
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml, toast } from "../util.js";

const LEAVE_STATE = {
  draft: "Brouillon", confirm: "À approuver", validate1: "1re validation",
  validate: "Approuvé", refuse: "Refusé", cancel: "Annulé",
};

let _ctx = { logout: () => {} };  // conservé pour les sous-vues

export const moi = {
  id: "moi",
  label: "Moi",
  icon: "👤",

  async render(root, ctx) {
    if (ctx) _ctx = ctx;
    const p = profile.get() || {};
    const odoo = p.odoo || {};
    root.innerHTML = `
      <h2>Mon profil</h2>
      <div class="card">
        <strong>${escapeHtml(p.name || "—")}</strong>
        <p style="color:var(--muted);margin:.3rem 0 0">
          ${escapeHtml(odoo.job_title || p.role || "")}<br>
          ${escapeHtml(odoo.work_email || "")}<br>${escapeHtml(odoo.work_phone || "")}
        </p>
      </div>
      <div id="rh-zone"><div class="placeholder">Chargement…</div></div>
      <button class="btn secondary" id="logout-btn" style="margin-top:8px">Se déconnecter</button>`;
    root.querySelector("#logout-btn").addEventListener("click", _ctx.logout);

    const zone = root.querySelector("#rh-zone");
    let balances, leaves, payslips;
    try {
      [balances, leaves, payslips] = await Promise.all([
        api("/rh/balances"), api("/rh/leaves"), api("/rh/payslips"),
      ]);
    } catch {
      zone.innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger tes données RH.</div>`;
      return;
    }
    renderRH(root, zone, balances, leaves, payslips);
  },
};

function renderRH(root, zone, balances, leaves, payslips) {
  zone.innerHTML = `
    ${balanceCards(balances)}
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
    </div>`;

  root.querySelector("#ask-leave").addEventListener("click", () => renderLeaveForm(root));
  root.querySelector("#payslip-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-payslip]");
    if (b) downloadPayslip(Number(b.dataset.payslip), b.dataset.name);
  });
}

function balanceCards(b) {
  const items = b.leaves.map(l => gauge(l.name, `${l.remaining} ${l.unit === "hour" ? "h" : "j"}`));
  items.push(gauge("Heures supp.", `${(b.overtime_hours || 0).toFixed(1)} h`));
  return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${items.join("")}</div>`;
}

function gauge(label, value) {
  return `<div class="card" style="flex:1;min-width:130px;text-align:center;margin:0">
    <div style="font-size:1.6rem;font-weight:700;color:var(--aqua-dark)">${escapeHtml(value)}</div>
    <div style="font-size:.8rem;color:var(--muted)">${escapeHtml(label)}</div>
  </div>`;
}

function leaveList(leaves) {
  if (!leaves.length) return `<p style="color:var(--muted);margin:0">Aucune demande de congé.</p>`;
  return leaves.map(l => {
    const type = l.work_entry_type_id ? l.work_entry_type_id[1] : "Congé";
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)">
      <div><strong>${escapeHtml(type)}</strong>
        <div style="font-size:.82rem;color:var(--muted)">${l.request_date_from} → ${l.request_date_to} · ${l.number_of_days} j</div></div>
      <span style="font-size:.78rem;align-self:center;color:var(--muted)">${escapeHtml(LEAVE_STATE[l.state] || l.state)}</span>
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

  const today = new Date().toISOString().slice(0, 10);
  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0">Demander un congé</h2>
    <form id="leave-form">
      <p class="form-error" id="leave-error"></p>
      <div class="field"><label>Type</label>
        <select id="l-type" style="width:100%;min-height:52px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;background:#fbfdfe">
          ${types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}${t.remaining ? ` (${t.remaining} restant)` : ""}</option>`).join("")}
        </select></div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Du</label><input id="l-from" type="date" value="${today}" required /></div>
        <div class="field" style="flex:1"><label>Au</label><input id="l-to" type="date" value="${today}" required /></div>
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
