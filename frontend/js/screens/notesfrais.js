// Onglet « Notes de frais » — liste de mes notes + création (photo reçu, montant TTC,
// catégorie, TVA) → hr.expense créée EN BROUILLON dans Odoo. Pas de comptabilité.
import { api } from "../api.js";
import { escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";

const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
const fmtCHF = (n) => (n || 0).toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATE_CLS = {
  Brouillon: "grey", Soumise: "pending", Approuvée: "ok", Comptabilisée: "ok",
  "En paiement": "ok", Payée: "ok", Refusée: "danger",
};

function downscale(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 1600; let { width, height } = img;
      if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
      const cv = document.createElement("canvas"); cv.width = width; cv.height = height;
      cv.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(cv.toDataURL("image/jpeg", 0.8)); URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(null); img.src = URL.createObjectURL(file);
  });
}

export const notesfrais = {
  id: "notesfrais",
  label: "Notes de frais",
  icon: "receipt",
  async render(root) {
    root.innerHTML = `<h2>Notes de frais</h2><div id="nf-zone"><div class="placeholder"><div class="big">${icon("receipt")}</div>Chargement…</div></div>`;
    const zone = root.querySelector("#nf-zone");
    let expenses = [];
    try { expenses = await api("/expenses"); } catch {}
    drawList(root, zone, expenses);
  },
};

function drawList(root, zone, expenses) {
  const rows = expenses.length
    ? expenses.map(e => {
        const cls = STATE_CLS[e.state_label] || "grey";
        return `<div class="row" style="padding:11px 0;justify-content:space-between">
          <div style="min-width:0;display:flex;align-items:center;gap:10px">
            <span style="color:var(--aqua-dark);display:flex">${icon("receipt", "icon-sm")}</span>
            <div style="min-width:0"><strong>${escapeHtml(e.name || "Note")}</strong>
              <div class="muted" style="font-size:.8rem">${escapeHtml(e.category || "")}${e.date ? " · " + e.date : ""}</div></div>
          </div>
          <div style="text-align:right;flex:0 0 auto">
            <div style="font-weight:700" class="tabular">${fmtCHF(e.amount)} CHF</div>
            <span class="badge badge-${cls}">${escapeHtml(e.state_label || "")}</span>
          </div></div>`;
      }).join("")
    : `<p class="muted" style="margin:0">Aucune note de frais.</p>`;

  zone.innerHTML = `
    <button class="btn" id="nf-add" style="min-height:54px;margin-bottom:16px">${icon("plus")} Nouvelle note de frais</button>
    <div class="card"><strong>Mes notes</strong><div style="margin-top:8px">${rows}</div></div>`;
  zone.querySelector("#nf-add").addEventListener("click", () => renderForm(root, zone));
}

async function renderForm(root, zone) {
  let opts = { categories: [], taxes: [] };
  try { opts = await api("/expenses/options"); } catch {}
  const photos = [];
  zone.innerHTML = `
    <button class="btn secondary" id="nf-back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h3 style="margin:0 0 12px">Nouvelle note de frais</h3>
    <form id="nf-form">
      <p class="form-error" id="nf-err"></p>
      <div class="card"><strong>Reçu</strong>
        <div id="nf-thumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label class="btn secondary" style="cursor:pointer;flex:1">${icon("camera", "icon-sm")} Prendre une photo
            <input id="nf-cam" type="file" accept="image/*" capture="environment" hidden></label>
          <label class="btn secondary" style="cursor:pointer;flex:1">${icon("image", "icon-sm")} Galerie
            <input id="nf-gal" type="file" accept="image/*" multiple hidden></label>
        </div>
      </div>
      <div class="field"><label>Montant (TTC)</label>
        <input id="nf-amount" type="number" min="0" step="0.05" inputmode="decimal" placeholder="0.00" required></div>
      <div class="field"><label>Catégorie</label>
        <select id="nf-cat">${opts.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>TVA</label>
        <select id="nf-tax">${opts.taxes.map(t => `<option value="${t.id}" ${t.rate === 8.1 ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Date</label><input id="nf-date" type="date" value="${todayISO()}" style="cursor:pointer"></div>
      <div class="field"><label>Description (optionnel)</label>
        <input id="nf-desc" type="text" placeholder="Ex. consommables chantier Dupont"></div>
      <button class="btn" type="submit" id="nf-submit" style="min-height:54px">${icon("check", "icon-sm")} Créer (brouillon)</button>
    </form>`;

  zone.querySelector("#nf-back").addEventListener("click", () => notesfrais.render(root));

  const dateInput = zone.querySelector("#nf-date");
  const openP = () => { if (typeof dateInput.showPicker === "function") { try { dateInput.showPicker(); } catch {} } };
  dateInput.addEventListener("click", openP); dateInput.addEventListener("focus", openP);

  const thumbs = zone.querySelector("#nf-thumbs");
  const addPhotos = async (files) => {
    for (const f of files) {
      const data = await downscale(f); if (!data) continue;
      const i = photos.push(data) - 1;
      const w = document.createElement("div"); w.style.cssText = "position:relative";
      w.innerHTML = `<img src="${data}" style="width:72px;height:72px;object-fit:cover;border-radius:8px"><button type="button" data-rm="${i}" style="position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:22px;height:22px;background:var(--danger);color:#fff;cursor:pointer">×</button>`;
      thumbs.appendChild(w);
    }
  };
  zone.querySelector("#nf-cam").addEventListener("change", async (e) => { await addPhotos(e.target.files); e.target.value = ""; });
  zone.querySelector("#nf-gal").addEventListener("change", async (e) => { await addPhotos(e.target.files); e.target.value = ""; });
  thumbs.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; photos[Number(b.dataset.rm)] = null; b.parentElement.remove(); });

  const form = zone.querySelector("#nf-form"), err = zone.querySelector("#nf-err"), submit = zone.querySelector("#nf-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    const amount = Number(zone.querySelector("#nf-amount").value);
    if (!amount || amount <= 0) { err.textContent = "Indique un montant."; return; }
    const body = {
      name: zone.querySelector("#nf-desc").value.trim() || (zone.querySelector("#nf-cat").selectedOptions[0]?.text || "Note de frais"),
      amount,
      category_id: Number(zone.querySelector("#nf-cat").value) || null,
      tax_id: Number(zone.querySelector("#nf-tax").value) || null,
      date: zone.querySelector("#nf-date").value || null,
      description: zone.querySelector("#nf-desc").value.trim() || null,
      photos: photos.filter(Boolean),
    };
    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try { await api("/expenses", { method: "POST", body }); toast("Note de frais créée"); notesfrais.render(root); }
    catch (e2) { submit.disabled = false; submit.innerHTML = `${icon("check", "icon-sm")} Créer (brouillon)`; err.textContent = (e2 && e2.message) ? e2.message : "Échec de la création."; }
  });
}
