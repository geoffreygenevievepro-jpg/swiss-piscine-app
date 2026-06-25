// Onglet « Documents » — 5 sous-onglets : fiches de salaire, documents personnels,
// contrat, certificats de salaire, certificats médicaux (avec dépôt photo/fichier
// qui arrive dans le dossier « Maladie » de l'employé sur Odoo).
import { api } from "../api.js";
import { escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";

let view = "payslips";

// Sous-onglets actifs. Les documents RH (perso/contrat/certif/médical) dépendent
// de dossiers Odoo verrouillés inaccessibles au compte de service → masqués pour
// l'instant (réactivables si un accès Documents dédié est mis en place).
const TABS = [
  ["payslips", "Fiches de salaire"],
];

const EMPTY = { personal: [], contract: [], salary_certificates: [], medical: [] };

export const documents = {
  id: "documents",
  label: "Documents",
  icon: "doc",
  async render(root) {
    root.innerHTML = `<h2>Documents</h2><div id="doc-zone"><div class="placeholder"><div class="big">${icon("doc")}</div>Chargement…</div></div>`;
    const zone = root.querySelector("#doc-zone");
    const [payslips, docs] = await Promise.all([
      api("/rh/payslips").catch(() => []),
      api("/documents/all").catch(() => ({ ...EMPTY })),
    ]);
    draw(root, zone, payslips, docs);
  },
};

function draw(root, zone, payslips, docs) {
  const switcher = TABS.map(([v, l]) =>
    `<button class="chip ${v === view ? "active" : ""}" data-doc="${v}" style="white-space:nowrap;flex:0 0 auto">${l}</button>`).join("");

  let body;
  if (view === "payslips") body = `<div class="card">${payslipList(payslips)}</div>`;
  else if (view === "medical") body = medicalView(docs.medical);
  else body = `<div class="card">${docList(docs[view] || [])}</div>`;

  zone.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:14px">${switcher}</div>
    ${body}`;

  zone.querySelectorAll("[data-doc]").forEach(b =>
    b.addEventListener("click", () => { view = b.dataset.doc; draw(root, zone, payslips, docs); }));

  zone.addEventListener("click", (e) => {
    const f = e.target.closest("[data-file]");
    if (f) { downloadDoc(Number(f.dataset.file)); return; }
    const p = e.target.closest("[data-payslip]");
    if (p) { downloadPayslip(Number(p.dataset.payslip), p.dataset.name); }
  });

  // Dépôt d'un certificat médical (caméra / fichier).
  const cam = zone.querySelector("#med-cam"), gal = zone.querySelector("#med-gal");
  const onPick = async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    await uploadMedical(file, () => documents.render(root));
  };
  if (cam) cam.addEventListener("change", onPick);
  if (gal) gal.addEventListener("change", onPick);
}

function mimeIcon(mt) {
  if (mt && mt.startsWith("image/")) return "image";
  return "doc";
}

function docList(items) {
  if (!items.length) return `<p style="color:var(--muted);margin:0">Aucun document.</p>`;
  return items.map(d => `
    <div data-file="${d.id}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line-soft);cursor:pointer">
      <div style="min-width:0;display:flex;align-items:center;gap:9px"><span style="color:var(--aqua-dark);display:flex">${icon(mimeIcon(d.mimetype), "icon-sm")}</span>
        <div style="min-width:0"><strong style="font-weight:600">${escapeHtml(d.name)}</strong>
        ${d.date ? `<div style="font-size:.78rem;color:var(--muted)">${escapeHtml(d.date)}</div>` : ""}</div></div>
      <span style="color:var(--aqua-dark);flex:0 0 auto;display:flex">${icon("download", "icon-sm")}</span>
    </div>`).join("");
}

function medicalView(items) {
  return `
    <div class="card" style="background:var(--aqua-soft);border-color:var(--aqua)">
      <strong>Déposer un certificat médical</strong>
      <div style="font-size:.78rem;color:var(--muted);margin:4px 0 10px">Il arrive directement dans ton dossier « Maladie » sur Odoo.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label class="btn" style="cursor:pointer;flex:1">${icon("camera", "icon-sm")} Prendre une photo
          <input id="med-cam" type="file" accept="image/*" capture="environment" hidden /></label>
        <label class="btn secondary" style="cursor:pointer;flex:1">${icon("image", "icon-sm")} Choisir un fichier
          <input id="med-gal" type="file" accept="image/*,application/pdf" hidden /></label>
      </div>
    </div>
    <div class="card">${docList(items)}</div>`;
}

function payslipList(payslips) {
  if (!payslips.length) return `<p style="color:var(--muted);margin:0">Aucune fiche de salaire.</p>`;
  return payslips.map(p => {
    const period = p.date_from ? p.date_from.slice(0, 7) : p.name;
    const net = p.net_wage ? p.net_wage.toLocaleString("fr-CH", { minimumFractionDigits: 2 }) + " CHF" : "";
    return `<div data-payslip="${p.id}" data-name="${escapeHtml(p.name)}.pdf"
        style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid var(--line);cursor:pointer">
      <div><strong>${escapeHtml(period)}</strong><div style="font-size:.82rem;color:var(--muted)">Net : ${escapeHtml(net)}</div></div>
      <span style="color:var(--aqua-dark);display:inline-flex;align-items:center;gap:5px">${icon("download", "icon-sm")} PDF</span></div>`;
  }).join("");
}

// --- Téléchargements --------------------------------------------------------
async function downloadDoc(id) {
  try {
    const res = await api(`/documents/file/${id}`);
    if (!res.available) { toast("Fichier indisponible."); return; }
    triggerDownload(`data:${res.mimetype};base64,${res.datas}`, res.name || "document");
  } catch { toast("Téléchargement impossible."); }
}

async function downloadPayslip(id, name) {
  try {
    const res = await api(`/rh/payslips/${id}/pdf`);
    if (!res.available) { toast("PDF indisponible pour cette fiche."); return; }
    triggerDownload(`data:application/pdf;base64,${res.datas}`, res.name || name || "fiche-salaire.pdf");
  } catch { toast("Téléchargement impossible."); }
}

function triggerDownload(href, name) {
  const a = document.createElement("a");
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

// --- Dépôt certificat médical ----------------------------------------------
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

function readRaw(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

async function uploadMedical(file, onDone) {
  const isImg = (file.type || "").startsWith("image/");
  const data = isImg ? await downscale(file) : await readRaw(file);
  if (!data) { toast("Fichier illisible."); return; }
  toast("Envoi du certificat…");
  try {
    await api("/documents/medical", {
      method: "POST",
      body: {
        name: file.name || "certificat-medical.jpg",
        mimetype: isImg ? "image/jpeg" : (file.type || "application/octet-stream"),
        data,
      },
    });
    toast("Certificat médical déposé");
    onDone();
  } catch (e) {
    toast(e && e.message ? e.message : "Échec du dépôt.");
  }
}
