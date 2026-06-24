// Onglet « Mes congés » — soldes par type, liste des demandes, demande de congé.
// (Extrait de « Mes heures » lors du passage à la nav du brief.)
import { api } from "../api.js";
import { escapeHtml, toast } from "../util.js";

export const conges = {
  id: "conges",
  label: "Mes congés",
  icon: "🌴",
  async render(root) {
    root.innerHTML = `<h2>Mes congés</h2><div class="placeholder"><div class="big">🌴</div>Chargement…</div>`;
    let balances, leaves;
    try {
      [balances, leaves] = await Promise.all([api("/rh/balances"), api("/rh/leaves")]);
    } catch {
      root.innerHTML = `<h2>Mes congés</h2><div class="card" style="border-color:var(--danger)">Impossible de charger tes congés.</div>`;
      return;
    }
    draw(root, balances, leaves);
  },
};

function draw(root, balances, leaves) {
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h2 style="margin:0">Mes congés</h2>
      <button class="btn" id="ask-leave" style="width:auto;min-height:40px;padding:0 16px">＋ Demander</button>
    </div>
    ${balancesCard(balances)}
    <div class="card">
      <strong>Mes demandes</strong>
      <div style="margin-top:10px">${leaveList(leaves)}</div>
    </div>`;
  root.querySelector("#ask-leave").addEventListener("click", () => renderLeaveForm(root));
}

function balancesCard(balances) {
  const items = (balances.leaves || []).map(l => `
    <div style="flex:1;min-width:120px;text-align:center;padding:12px 8px;background:var(--aqua-soft);border-radius:14px">
      <div style="font-size:1.5rem">${l.icon || "🗓️"}</div>
      <div style="font-size:1.4rem;font-weight:700;font-family:var(--font-display);color:var(--navy)">${l.remaining}</div>
      <div style="font-size:.74rem;color:var(--muted)">${escapeHtml(l.label)}${l.unit === "day" ? "" : " (h)"}</div>
    </div>`).join("");
  const ot = balances.overtime_hours
    ? `<p style="margin:10px 0 0;font-size:.85rem;color:var(--muted)">Heures supplémentaires : <strong style="color:var(--ink)">${balances.overtime_hours.toFixed(1)} h</strong></p>`
    : "";
  return `<div class="card">
    <strong>Soldes</strong>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">${items || `<p style="color:var(--muted);margin:0">Aucun solde.</p>`}</div>
    ${ot}
  </div>`;
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
  const back = () => conges.render(root);
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
