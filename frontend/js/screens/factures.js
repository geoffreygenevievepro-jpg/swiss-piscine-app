// Onglet « Devis & Factures » — lecture seule (bureau / managers / admin).
// Liste des devis et factures de la société ; ouverture du PDF Odoo si stocké,
// sinon fiche résumé (en-tête + totaux). Jamais de mode « fabrication ».
import { api } from "../api.js";
import { escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";

let kind = "devis";
let q = "";

export const factures = {
  id: "factures",
  label: "Devis & Factures",
  icon: "receipt",
  async render(root) {
    renderList(root);
  },
};

function chf(n) {
  return (n || 0).toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " CHF";
}

async function renderList(root) {
  root.innerHTML = `<h2>Devis & Factures</h2>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="chip ${kind === "devis" ? "active" : ""}" data-kind="devis" style="flex:1;justify-content:center">Devis</button>
      <button class="chip ${kind === "facture" ? "active" : ""}" data-kind="facture" style="flex:1;justify-content:center">Factures</button>
    </div>
    <input id="fx-search" type="search" inputmode="search" autocomplete="off"
           placeholder="Rechercher (n°, client…)" value="${escapeHtml(q)}"
           style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:11px;padding:0 14px;font-size:.95rem;margin-bottom:14px">
    <div id="fx-list"><div class="placeholder"><div class="big">${icon("receipt")}</div>Chargement…</div></div>`;

  const list = root.querySelector("#fx-list");
  const search = root.querySelector("#fx-search");

  const load = async () => {
    list.innerHTML = `<div class="placeholder">Chargement…</div>`;
    try {
      const data = await api(`/sales-docs?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      list.innerHTML = data.length
        ? data.map(row).join("")
        : `<p style="color:var(--muted)">Aucun ${kind === "devis" ? "devis" : "facture"}.</p>`;
      list.querySelectorAll("[data-id]").forEach(el =>
        el.addEventListener("click", () => renderDetail(root, kind, Number(el.dataset.id), el.dataset.name)));
    } catch (e) {
      list.innerHTML = `<div class="card" style="border-color:var(--danger)">${e && e.status === 403 ? "Accès réservé au bureau et au management." : "Impossible de charger les documents."}</div>`;
    }
  };

  root.querySelectorAll("[data-kind]").forEach(b =>
    b.addEventListener("click", () => { if (kind !== b.dataset.kind) { kind = b.dataset.kind; q = ""; renderList(root); } }));
  let t;
  search.addEventListener("input", () => { q = search.value.trim(); clearTimeout(t); t = setTimeout(load, 300); });
  load();
}

function row(d) {
  const pdf = d.has_pdf ? `<span class="fx-pdf">${icon("doc", "icon-sm")} PDF</span>` : "";
  return `<div class="card fx-row" data-id="${d.id}" data-name="${escapeHtml(d.name)}">
    <div style="min-width:0">
      <strong>${escapeHtml(d.name)}</strong>
      <div class="ct-sub">${escapeHtml(d.partner || "—")}</div>
      <div class="ct-sub">${escapeHtml(d.date || "")} · ${escapeHtml(d.state || "")}</div>
    </div>
    <div style="text-align:right;flex:0 0 auto">
      <div style="font-weight:700">${chf(d.amount)}</div>
      ${pdf}
    </div>
  </div>`;
}

async function renderDetail(root, k, id, name) {
  root.innerHTML = `<button class="btn secondary" id="fx-back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <div id="fx-detail"><div class="placeholder">Chargement…</div></div>`;
  root.querySelector("#fx-back").addEventListener("click", () => renderList(root));
  const zone = root.querySelector("#fx-detail");
  let d;
  try {
    d = await api(`/sales-docs/${k}/${id}`);
  } catch {
    zone.innerHTML = `<div class="card" style="border-color:var(--danger)">Document introuvable.</div>`;
    return;
  }
  const lines = (d.items || []).map(l => `
    <tr>
      <td style="padding:6px 8px">${escapeHtml(l.name)}</td>
      <td style="padding:6px 8px;text-align:right;white-space:nowrap">${(l.qty || 0)}</td>
      <td style="padding:6px 8px;text-align:right;white-space:nowrap">${chf(l.subtotal)}</td>
    </tr>`).join("");
  zone.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
        <div><h2 style="margin:0">${escapeHtml(d.name || name || "")}</h2>
          <div class="ct-sub">${escapeHtml(d.partner || "")}</div></div>
        <span class="chip" style="pointer-events:none">${escapeHtml(d.state || "")}</span>
      </div>
      <div class="ct-sub" style="margin-top:8px">${k === "facture" ? "Date" : "Date"} : ${escapeHtml(d.date || "—")}${d.due ? ` · ${k === "facture" ? "Échéance" : "Validité"} : ${escapeHtml(d.due)}` : ""}</div>
      <button class="btn" id="fx-pdf" style="margin-top:14px">${icon("doc", "icon-sm")} Voir le PDF</button>
    </div>
    ${lines ? `<div class="card"><table style="width:100%;border-collapse:collapse;font-size:.88rem">
        <thead><tr style="color:var(--muted);font-size:.72rem;text-transform:uppercase">
          <th style="text-align:left;padding:4px 8px">Désignation</th><th style="text-align:right;padding:4px 8px">Qté</th><th style="text-align:right;padding:4px 8px">Total</th></tr></thead>
        <tbody>${lines}</tbody></table></div>`
      : `<div class="card" style="color:var(--muted);font-size:.86rem">Détail des lignes non disponible ici — ouvre le PDF pour le document complet.</div>`}
    <div class="card">
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span class="ct-sub">Montant HT</span><span>${chf(d.untaxed)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span class="ct-sub">TVA</span><span>${chf(d.tax)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--line);font-weight:700;font-size:1.05rem"><span>Total</span><span>${chf(d.total)}</span></div>
    </div>`;
  root.querySelector("#fx-pdf").addEventListener("click", () => openPdf(k, id));
}

function b64ToBlobUrl(b64, type = "application/pdf") {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type }));
}

async function openPdf(k, id) {
  try {
    const res = await api(`/sales-docs/${k}/${id}/pdf`);
    if (!res.available) { toast("Pas de PDF stocké pour ce document — résumé ci-dessus."); return; }
    window.open(b64ToBlobUrl(res.datas), "_blank");
  } catch {
    toast("PDF indisponible.");
  }
}
