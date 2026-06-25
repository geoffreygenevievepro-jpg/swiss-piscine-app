// Onglet « Mon résumé » — profil, informations personnelles éditables (écrites
// sur la fiche hr.employee de l'employé), validation manager, parcours.
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";

let _ctx = { logout: () => {} };

const SELECT_OPTS = {
  marital: [["single", "Célibataire"], ["married", "Marié·e"], ["cohabitant", "Concubinage"],
    ["registered_partnership", "Partenariat enregistré"], ["divorced", "Divorcé·e"],
    ["separated", "Séparé·e"], ["widower", "Veuf·ve"]],
  certificate: [["mandatorySchoolOnly", "École obligatoire"], ["vocEducationCompl", "CFC / Apprentissage"],
    ["higherVocEducation", "Formation prof. supérieure"], ["bachelor", "Bachelor"],
    ["master", "Master"], ["doctor", "Doctorat"], ["other", "Autre"]],
  lang: [["fr_FR", "Français"], ["de_CH", "Allemand (CH)"], ["en_GB", "Anglais (GB)"], ["en_US", "Anglais (US)"]],
};

const GROUPS = [
  ["Coordonnées", [
    ["private_street", "Rue", "text"], ["private_zip", "NPA", "text"], ["private_city", "Ville", "text"],
    ["private_country_id", "Pays", "country"], ["private_phone", "Téléphone privé", "tel"],
    ["private_email", "Email privé", "email"], ["work_phone", "Téléphone pro", "tel"],
  ]],
  ["Identité & famille", [
    ["birthday", "Date de naissance", "date"], ["place_of_birth", "Lieu de naissance", "text"],
    ["country_id", "Nationalité", "country"], ["country_of_birth", "Pays de naissance", "country"],
    ["marital", "État civil", "select"], ["children", "Nombre d'enfants", "number"],
    ["spouse_complete_name", "Nom du conjoint", "text"], ["spouse_birthdate", "Naissance du conjoint", "date"],
  ]],
  ["Permis de séjour / pièces", [
    ["permit_no", "N° permis de travail", "text"], ["work_permit_expiration_date", "Expiration du permis", "date"],
    ["visa_no", "N° de visa", "text"], ["visa_expire", "Expiration du visa", "date"],
    ["passport_id", "N° de passeport", "text"], ["identification_id", "N° d'identification", "text"],
  ]],
  ["Contact d'urgence", [
    ["emergency_contact", "Nom", "text"], ["emergency_phone", "Téléphone", "tel"],
  ]],
  ["Formation & langue", [
    ["certificate", "Niveau de formation", "select"], ["study_field", "Domaine d'études", "text"],
    ["study_school", "École", "text"], ["lang", "Langue", "select"],
  ]],
];

export const moi = {
  id: "moi",
  label: "Mon résumé",
  icon: "user",

  async render(root, ctx) {
    if (ctx) _ctx = ctx;
    const p = profile.get() || {};
    root.innerHTML = `
      ${profileHeader(p)}
      <div id="rh-zone"><div class="placeholder">Chargement…</div></div>
      <button class="btn secondary" id="logout-btn" style="margin-top:8px">Se déconnecter</button>`;
    root.querySelector("#logout-btn").addEventListener("click", _ctx.logout);

    const zone = root.querySelector("#rh-zone");
    const [details, countries, pending] = await Promise.all([
      api("/me/details").catch(() => ({})),
      api("/me/countries").catch(() => []),
      ["manager", "admin"].includes(p.role) ? api("/manager/leaves").catch(() => []) : Promise.resolve([]),
    ]);
    renderRH(root, zone, { details, countries, pending }, p);
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

function renderRH(root, zone, data, p) {
  zone.innerHTML = `
    ${managerCard(data.pending)}
    ${infoForm(data.details, data.countries)}
    ${resumeCard(p.resume)}`;

  // Validation manager
  zone.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    b.disabled = true;
    try {
      await api(`/manager/leaves/${b.dataset.id}/${b.dataset.act}`, { method: "POST" });
      toast(b.dataset.act === "approve" ? "Congé approuvé" : "Congé refusé");
      moi.render(root, _ctx);
    } catch { b.disabled = false; toast("Action impossible."); }
  });

  // Ouverture directe du calendrier sur les champs date
  zone.querySelectorAll('input[type="date"]').forEach(d => {
    const open = () => { if (typeof d.showPicker === "function") { try { d.showPicker(); } catch {} } };
    d.addEventListener("focus", open); d.addEventListener("click", open);
  });

  // Enregistrement des informations
  const form = zone.querySelector("#info-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const save = zone.querySelector("#info-save");
    const payload = {};
    for (const [, fields] of GROUPS) {
      for (const [key] of fields) {
        const el = zone.querySelector(`#f-${key}`);
        if (el) payload[key] = el.value;
      }
    }
    save.disabled = true; save.innerHTML = `<span class="spinner"></span>`;
    try { await api("/me/details", { method: "PATCH", body: payload }); toast("Informations enregistrées"); }
    catch { toast("Échec de l'enregistrement."); }
    save.disabled = false; save.innerHTML = `${icon("save", "icon-sm")} Enregistrer mes informations`;
  });

  // Dépôt du scan de permis
  const onPermit = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) await uploadPermit(f, () => moi.render(root, _ctx)); };
  const pc = zone.querySelector("#permit-cam"), pg = zone.querySelector("#permit-gal");
  if (pc) pc.addEventListener("change", onPermit);
  if (pg) pg.addEventListener("change", onPermit);
}

function infoForm(details, countries) {
  details = details || {};
  const groups = GROUPS.map(([title, fields]) => `
    <div class="card">
      <strong>${title}</strong>
      ${title.startsWith("Permis") ? permitScanBlock(details) : ""}
      <div style="margin-top:12px">${fields.map(f => fieldRow(f, details, countries)).join("")}</div>
    </div>`).join("");
  return `<form id="info-form">
    <h3 style="margin:6px 0 10px;color:var(--navy)">Mes informations</h3>
    ${groups}
    <button class="btn" type="submit" id="info-save" style="min-height:52px;margin-bottom:6px">${icon("save", "icon-sm")} Enregistrer mes informations</button>
  </form>`;
}

const INPUT_STYLE = "width:100%;min-height:46px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font-size:1rem;background:#fbfdfe";

function fieldRow([key, label, type], details, countries) {
  const v = details[key];
  let control;
  if (type === "country") {
    const cur = v && v.id ? v.id : "";
    control = `<select id="f-${key}" style="${INPUT_STYLE}">
      <option value="">—</option>
      ${(countries || []).map(c => `<option value="${c.id}" ${c.id === cur ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
    </select>`;
  } else if (type === "select") {
    control = `<select id="f-${key}" style="${INPUT_STYLE}">
      <option value="">—</option>
      ${(SELECT_OPTS[key] || []).map(([val, lbl]) => `<option value="${val}" ${val === v ? "selected" : ""}>${escapeHtml(lbl)}</option>`).join("")}
    </select>`;
  } else {
    const val = v == null ? "" : String(v);
    control = `<input id="f-${key}" type="${type}" value="${escapeHtml(val)}" style="${INPUT_STYLE}${type === "date" ? ";cursor:pointer" : ""}">`;
  }
  return `<div style="margin-bottom:10px">
    <label style="display:block;font-size:.8rem;font-weight:600;color:var(--ink);margin-bottom:5px">${label}</label>
    ${control}</div>`;
}

function permitScanBlock(details) {
  return `<div style="margin-top:8px;padding:10px;background:var(--aqua-soft);border-radius:10px">
    <div style="font-size:.84rem;display:flex;align-items:center;gap:7px">${details.has_permit_scan ? `<span style="color:var(--ok);display:flex">${icon("check", "icon-sm")}</span>Scan du permis déposé` : "Aucun scan déposé"}</div>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <label class="btn secondary" style="cursor:pointer;flex:1">${icon("camera", "icon-sm")} Photo du permis
        <input id="permit-cam" type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn secondary" style="cursor:pointer;flex:1">${icon("image", "icon-sm")} Fichier
        <input id="permit-gal" type="file" accept="image/*,application/pdf" hidden></label>
    </div></div>`;
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
        <button class="btn" data-act="approve" data-id="${l.id}" style="min-height:38px;padding:0 14px">${icon("check", "icon-sm")} Approuver</button>
        <button class="btn secondary" data-act="refuse" data-id="${l.id}" style="min-height:38px;padding:0 14px;width:auto">Refuser</button>
      </div></div>`).join("");
  return `<div class="card" style="border-color:var(--warn)"><strong style="display:inline-flex;align-items:center;gap:7px">${icon("inbox", "icon-sm")} À valider (${pending.length})</strong><div style="margin-top:4px">${rows}</div></div>`;
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

// --- Dépôt du scan de permis -------------------------------------------------
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
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(file); });
}
async function uploadPermit(file, onDone) {
  const isImg = (file.type || "").startsWith("image/");
  const data = isImg ? await downscale(file) : await readRaw(file);
  if (!data) { toast("Fichier illisible."); return; }
  toast("Envoi du permis…");
  try { await api("/me/permit-scan", { method: "POST", body: { data } }); toast("Scan du permis déposé"); onDone(); }
  catch { toast("Échec du dépôt."); }
}
