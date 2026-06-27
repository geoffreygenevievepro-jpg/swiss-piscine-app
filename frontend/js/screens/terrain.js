// Onglet « Je fais » — interventions du jour (bascule Jour/Semaine) + détail enrichi
// (historique client, fiche client, Démarrer→Rapport) + création (avec client rapide).
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";
import { renderReport, setupSignature } from "./report.js";
import { semaine } from "./semaine.js";

let selectedDate = null;  // YYYY-MM-DD ; null = aujourd'hui
let mode = "jour";        // "jour" | "semaine" (bascule en tête de l'onglet « Je fais »)
// Permet à l'Accueil d'ouvrir directement le planning (mode semaine) via deep-link.
export function setTerrainMode(m) { mode = m; }
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

function downscale(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 1280; let { width, height } = img;
      if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
      const cv = document.createElement("canvas"); cv.width = width; cv.height = height;
      cv.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(cv.toDataURL("image/jpeg", 0.7)); URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(null); img.src = URL.createObjectURL(file);
  });
}

export const terrain = {
  id: "terrain",
  label: "Rapport",
  icon: "tools",
  async render(root, ctx) {
    if (ctx && ctx.intent === "new") { renderForm(root); return; }
    root.innerHTML = `${modeToggle()}<div id="t-content"></div>`;
    root.querySelectorAll("[data-mode]").forEach(b =>
      b.addEventListener("click", () => { mode = b.dataset.mode; terrain.render(root); }));
    const content = root.querySelector("#t-content");
    if (mode === "semaine") await semaine.render(content);
    else await renderJour(root, content);
  },
};

function modeToggle() {
  return `<div style="display:flex;gap:8px;margin-bottom:14px">
    ${["jour", "semaine"].map(m => `<button class="chip ${m === mode ? "active" : ""}" data-mode="${m}" style="flex:1">${m === "jour" ? "Jour" : "Semaine"}</button>`).join("")}
  </div>`;
}

async function renderJour(root, content) {
  const date = selectedDate || todayISO();
  content.innerHTML = `${dateHeader(date)}<div id="iv-zone"><div class="placeholder"><div class="big">${icon("note")}</div>Chargement…</div></div>`;
  bindDate(root);
  let data;
  try { data = await api(`/interventions/today?date=${date}`); }
  catch { content.querySelector("#iv-zone").innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger les interventions.</div>`; return; }
  renderList(root, data.interventions || []);
}

function dateHeader(date) {
  const d = new Date(date + "T00:00:00");
  const isToday = date === todayISO();
  return `
    <h2 style="margin:0 0 12px">Interventions</h2>
    <button class="btn" id="iv-add" style="min-height:60px;font-size:1.1rem;margin-bottom:14px">${icon("plus")} Ajouter une intervention</button>
    <div style="display:flex;align-items:center;gap:10px;margin:0 0 16px">
      <button class="btn secondary nav" id="d-prev" aria-label="Jour précédent">‹</button>
      <label style="flex:1;position:relative">
        <input id="d-date" type="date" value="${date}" style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;background:#fff;text-align:center;font-weight:600;color:var(--navy);cursor:pointer">
      </label>
      <button class="btn secondary nav" id="d-next" aria-label="Jour suivant">›</button>
    </div>
    ${isToday ? "" : `<p style="text-align:center;margin:-8px 0 12px"><button class="btn secondary" id="d-today" style="width:auto;min-height:34px;padding:0 14px;font-size:.85rem">Revenir à aujourd'hui</button></p>`}`;
}

function bindDate(root) {
  const shift = (days) => { const d = new Date((selectedDate || todayISO()) + "T00:00:00"); d.setDate(d.getDate() + days); selectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; terrain.render(root); };
  root.querySelector("#d-prev").addEventListener("click", () => shift(-1));
  root.querySelector("#d-next").addEventListener("click", () => shift(1));
  const dd = root.querySelector("#d-date");
  dd.addEventListener("change", (e) => { selectedDate = e.target.value || todayISO(); terrain.render(root); });
  // Ouvre le calendrier directement au clic / focus sur la barre de date.
  const openDD = () => { if (typeof dd.showPicker === "function") { try { dd.showPicker(); } catch {} } };
  dd.addEventListener("click", openDD); dd.addEventListener("focus", openDD);
  const t = root.querySelector("#d-today"); if (t) t.addEventListener("click", () => { selectedDate = null; terrain.render(root); });
  root.querySelector("#iv-add").addEventListener("click", () => renderForm(root));
}

function hm(dt) { return dt ? dt.slice(11, 16) : ""; }

// Couleur indicative selon le type d'intervention (déduit du libellé).
function typeColor(label) {
  const t = (label || "").toLowerCase();
  if (t.includes("entretien")) return "var(--ok)";
  if (t.includes("sav")) return "#e08a1e";
  if (t.includes("dépann") || t.includes("depann")) return "#2f7fd1";
  if (t.includes("hivernage")) return "#6c5ce7";
  return "var(--aqua-dark)";
}

function renderList(root, slots) {
  const zone = root.querySelector("#iv-zone");
  if (!slots.length) { zone.innerHTML = `<div class="placeholder"><div class="big">${icon("sun")}</div>Aucune intervention ce jour-là.</div>`; return; }
  zone.innerHTML = `<div id="slot-list">${slots.map(slotCard).join("")}</div>`;
  zone.querySelector("#slot-list").addEventListener("click", (e) => {
    const c = e.target.closest("[data-slot]"); if (c) renderDetail(root, Number(c.dataset.slot));
  });
}

function slotCard(s) {
  const done = s.state === "1_done";
  const accent = done ? "var(--ok)" : typeColor(s.label);
  const client = s.partner_id ? s.partner_id[1] : "";
  return `<div class="card" data-slot="${s.id}" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;border-left:4px solid ${accent}">
    <div style="flex:0 0 auto;text-align:center;min-width:48px">
      <div style="font-weight:700;color:${accent}">${hm(s.start_datetime)}</div>
      <div style="font-size:.72rem;color:var(--muted)">${hm(s.end_datetime)}</div></div>
    <div style="flex:1;min-width:0"><strong>${escapeHtml(s.label)}</strong>
      ${client ? `<div style="color:var(--muted);font-size:.88rem;margin-top:2px">${escapeHtml(client)}</div>` : ""}
      ${done ? `<div style="font-size:.75rem;color:var(--ok);margin-top:4px;display:flex;align-items:center;gap:4px">${icon("check", "icon-sm")} Terminé</div>` : ""}</div>
    <span style="color:var(--muted);align-self:center">›</span></div>`;
}

async function renderDetail(root, slotId) {
  root.innerHTML = `<button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button><div class="placeholder">Chargement…</div>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));
  let s;
  try { s = await api(`/interventions/${slotId}`); }
  catch { root.querySelector(".placeholder").textContent = "Intervention introuvable."; return; }
  const pn = s.partner || {};
  const addr = [pn.street, pn.street2, [pn.zip, pn.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const tel = pn.phone;
  const maps = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
  const accent = s.state === "1_done" ? "var(--ok)" : typeColor(s.label);
  const historyCard = (s.history && s.history.length) ? `
    <div class="card"><strong>Historique client</strong>
      ${s.history.map(h => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--line)">
        <span style="min-width:0">${escapeHtml(h.name || "—")}</span>
        <span style="color:var(--muted);font-size:.82rem;white-space:nowrap">${escapeHtml(h.date || "")}${h.stage ? " · " + escapeHtml(h.stage) : ""}</span>
      </div>`).join("")}
    </div>` : "";
  const ficheCard = s.known_issues ? `
    <details class="card"><summary style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:8px">${icon("note", "icon-sm")} Fiche client</summary>
      <p style="white-space:pre-line;color:var(--muted);font-size:.86rem;margin:10px 0 0">${escapeHtml(s.known_issues)}</p>
    </details>` : "";

  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0;border-left:4px solid ${accent};padding-left:10px">${escapeHtml(s.label)}</h2>
    <div class="card"><strong>Horaire</strong><p style="color:var(--muted);margin:.3rem 0 0">${hm(s.start_datetime)} – ${hm(s.end_datetime)}</p></div>
    ${s.partner_id ? `<div class="card"><strong>${escapeHtml(pn.name || s.partner_id[1])}</strong>${addr ? `<p style="color:var(--muted);margin:.4rem 0 0">${escapeHtml(addr)}</p>` : ""}</div>
    <div style="display:flex;gap:10px">
      ${tel ? `<a class="btn" href="tel:${escapeHtml(tel)}" style="text-decoration:none">${icon("phone", "icon-sm")} Appeler</a>` : ""}
      ${maps ? `<a class="btn secondary" href="${maps}" target="_blank" rel="noopener" style="text-decoration:none">${icon("navigation", "icon-sm")} Itinéraire</a>` : ""}
    </div>` : ""}
    ${ficheCard}
    ${historyCard}
    <button class="btn" id="do-start" style="margin-top:16px">${icon("play", "icon-sm")} Démarrer l'intervention</button>
    <button class="btn secondary" id="do-report" style="margin-top:8px">${icon("note", "icon-sm")} Rapport (sans chrono)</button>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));
  const back = (msg) => { terrain.render(root); if (msg) toast(msg); };
  root.querySelector("#do-start").addEventListener("click", () =>
    renderReport(root, { id: slotId, label: s.label, partner_id: s.partner_id, partner: s.partner, employee_ids: s.employee_ids }, back, { autoStart: true }));
  root.querySelector("#do-report").addEventListener("click", () =>
    renderReport(root, { id: slotId, label: s.label, partner_id: s.partner_id, partner: s.partner, employee_ids: s.employee_ids }, back));
}

async function renderForm(root) {
  const back = () => terrain.render(root);
  let types = [], tags = [], employees = [];
  try { types = await api("/report-types"); } catch {}
  try { tags = await api("/report-tags"); } catch {}
  try { employees = await api("/employees"); } catch {}
  if (!tags.length) tags = [{ id: 67, name: "à facturer" }, { id: 80, name: "SAV SP" }, { id: 81, name: "SAV client" }];

  const meId = (profile.get() || {}).hr_employee_id || null;
  const photos = [];
  const state = { products: [], tags: [], status: null, signed: false, workers: meId ? [meId] : [], next: "rien" };
  const date = selectedDate || todayISO();

  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Annuler</button>
    <h2 style="margin-top:0">Nouvelle intervention</h2>
    <form id="iv-form">
      <p class="form-error" id="iv-error"></p>

      <div class="field"><label>Type d'intervention</label>
        <select id="iv-type" style="width:100%;min-height:52px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;background:#fbfdfe">
          ${types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
        </select></div>

      <div class="card"><strong>Statut <span style="color:var(--danger)">*</span></strong>
        <div id="iv-status" style="display:flex;gap:10px;margin-top:10px">
          <button type="button" class="chip" data-status="done" style="flex:1;min-height:50px;justify-content:center">${icon("check", "icon-sm")} Tâche terminée</button>
          <button type="button" class="chip" data-status="todo" style="flex:1;min-height:50px;justify-content:center">${icon("alert", "icon-sm")} Tâche à terminer</button>
        </div></div>

      <div class="card"><strong>Équipe sur le chantier</strong>
        <div style="font-size:.74rem;color:var(--muted);margin-top:2px">Qui a travaillé sur ce chantier ?</div>
        <div id="iv-workers" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          ${employees.map(e => `<button type="button" class="chip${state.workers.includes(e.id) ? " active" : ""}" data-worker="${e.id}">${escapeHtml(e.name)}</button>`).join("") || `<span style="color:var(--muted);font-size:.85rem">Liste indisponible</span>`}
        </div></div>

      <div class="field"><label>Client <span style="color:var(--danger)">*</span></label>
        <input id="iv-client" type="text" autocomplete="off" placeholder="Nom du client (libre ou recherche Odoo)…" />
        <div id="iv-client-results"></div><input type="hidden" id="iv-partner-id" />
        <div style="font-size:.74rem;color:var(--muted);margin-top:4px">Un client non trouvé est accepté en texte libre (non créé dans Odoo).</div></div>

      <div class="field"><label>Date</label><input id="iv-date" type="date" value="${date}" required style="cursor:pointer" /></div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Début</label><input id="iv-start" type="time" value="08:00" required /></div>
        <div class="field" style="flex:1"><label>Fin</label><input id="iv-end" type="time" value="10:00" required /></div>
      </div>

      <div class="field"><label>Tâches réalisées / description</label>
        <textarea id="iv-desc" rows="3" placeholder="Ce qui a été fait sur le chantier…" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:1rem"></textarea></div>

      <div class="field"><label>Matériel utilisé</label>
        <input id="iv-materials" type="text" placeholder="Ex. 2 sacs de sable, vanne 6 voies…" style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem" /></div>

      <div class="card"><strong>Produits</strong>
        <div id="p-lines" style="margin:10px 0"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1 1 100%;position:relative">
            <input id="p-name" type="text" autocomplete="off" placeholder="Produit (recherche Odoo ou libre)…" style="width:100%;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 10px;font-size:.95rem">
            <div id="p-results"></div>
          </div>
          <input id="p-qty" type="number" min="0" step="any" value="1" aria-label="Quantité" style="width:62px;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 8px;font-size:.95rem;text-align:center">
          <input id="p-price" type="number" min="0" step="any" placeholder="Prix" aria-label="Prix unitaire" style="width:84px;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 8px;font-size:.95rem;text-align:right">
          <button type="button" class="btn" id="p-add" style="width:auto;min-height:44px;padding:0 16px">${icon("plus")}</button>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <label style="flex:1;font-size:.8rem;color:var(--muted)">Remise %<input id="p-disc" type="number" min="0" step="any" value="0" style="width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 8px;font-size:.95rem;margin-top:4px"></label>
          <label style="flex:1;font-size:.8rem;color:var(--muted)">TVA %<input id="p-vat" type="number" min="0" step="any" value="8.1" style="width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 8px;font-size:.95rem;margin-top:4px"></label>
        </div>
        <div id="p-totals" style="margin-top:10px"></div>
      </div>

      <div class="card"><strong>Tags</strong>
        <div id="iv-tags" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          ${tags.map(t => `<button type="button" class="chip" data-tag="${t.id}">${escapeHtml(t.name)}</button>`).join("")}
        </div></div>

      <div class="card"><strong>Prochaine action</strong>
        <div id="iv-next" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          ${[["rien", "Rien"], ["rappel", "Rappel"], ["appel", "Appel client"], ["devis", "Devis SAV"]].map(([v, l]) => `<button type="button" class="chip ${v === "rien" ? "active" : ""}" data-next="${v}">${l}</button>`).join("")}
        </div>
        <div id="iv-next-date" style="display:none;margin-top:10px">
          <label style="font-size:.82rem;color:var(--muted)">Échéance (optionnel)</label>
          <input id="iv-next-when" type="date" style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem" />
        </div></div>

      <div class="card"><strong>Photos</strong>
        <div id="iv-thumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label class="btn secondary" style="cursor:pointer;flex:1">${icon("camera", "icon-sm")} Prendre une photo
            <input id="iv-photo-cam" type="file" accept="image/*" capture="environment" hidden /></label>
          <label class="btn secondary" style="cursor:pointer;flex:1">${icon("image", "icon-sm")} Galerie
            <input id="iv-photo-gal" type="file" accept="image/*" multiple hidden /></label>
        </div></div>

      <div class="card"><strong>Signature du client</strong>
        <canvas id="iv-sign" style="width:100%;height:170px;border:1px dashed var(--line);border-radius:12px;margin-top:10px;touch-action:none;background:#fff"></canvas>
        <button type="button" class="btn secondary" id="iv-sign-clear" style="margin-top:8px">Effacer la signature</button></div>

      <button class="btn" type="submit" id="iv-submit" style="min-height:56px;font-size:1.1rem">Créer l'intervention</button>
    </form>`;

  root.querySelector("#back").addEventListener("click", back);

  // Calendrier direct au clic sur le champ Date.
  const ivDate = root.querySelector("#iv-date");
  const openIv = () => { if (typeof ivDate.showPicker === "function") { try { ivDate.showPicker(); } catch {} } };
  ivDate.addEventListener("click", openIv); ivDate.addEventListener("focus", openIv);

  // Statut (obligatoire)
  const statusWrap = root.querySelector("#iv-status");
  statusWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]"); if (!b) return;
    state.status = b.dataset.status;
    statusWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
  });

  // Prochaine action
  const nextWrap = root.querySelector("#iv-next"), nextDate = root.querySelector("#iv-next-date");
  nextWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-next]"); if (!b) return;
    state.next = b.dataset.next;
    nextWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
    nextDate.style.display = state.next === "rien" ? "none" : "block";
  });

  // Équipe sur le chantier (multi-sélection)
  const workersWrap = root.querySelector("#iv-workers");
  workersWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-worker]"); if (!b) return;
    const id = Number(b.dataset.worker); const i = state.workers.indexOf(id);
    if (i >= 0) { state.workers.splice(i, 1); b.classList.remove("active"); }
    else { state.workers.push(id); b.classList.add("active"); }
  });

  // Tags (multi-sélection)
  const tagsWrap = root.querySelector("#iv-tags");
  tagsWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]"); if (!b) return;
    const id = Number(b.dataset.tag); const i = state.tags.indexOf(id);
    if (i >= 0) { state.tags.splice(i, 1); b.classList.remove("active"); }
    else { state.tags.push(id); b.classList.add("active"); }
  });

  // Client : recherche Odoo optionnelle, texte libre accepté, AUCUNE création.
  const ci = root.querySelector("#iv-client"), results = root.querySelector("#iv-client-results"), pid = root.querySelector("#iv-partner-id");
  let tmr = null;
  ci.addEventListener("input", () => {
    pid.value = ""; clearTimeout(tmr);
    const q = ci.value.trim(); if (q.length < 2) { results.innerHTML = ""; return; }
    tmr = setTimeout(async () => {
      try {
        const list = await api(`/partners/search?q=${encodeURIComponent(q)}`);
        results.innerHTML = list.map(pp => `<div class="card" data-pid="${pp.id}" data-name="${escapeHtml(pp.name)}" style="cursor:pointer;padding:10px;margin:6px 0"><strong>${escapeHtml(pp.name)}</strong><span style="color:var(--muted);font-size:.8rem"> ${escapeHtml(pp.city || "")}</span></div>`).join("");
      } catch { results.innerHTML = ""; }
    }, 300);
  });
  results.addEventListener("click", (e) => {
    const c = e.target.closest("[data-pid]");
    if (c) { pid.value = c.dataset.pid; ci.value = c.dataset.name; results.innerHTML = ""; }
  });

  // Produits (style devis : lignes + sous-total / remise / TVA / total)
  const fmtCHF = (n) => n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pName = root.querySelector("#p-name"), pQty = root.querySelector("#p-qty"), pPrice = root.querySelector("#p-price"), pResults = root.querySelector("#p-results");
  const pLines = root.querySelector("#p-lines"), pTotals = root.querySelector("#p-totals"), pDisc = root.querySelector("#p-disc"), pVat = root.querySelector("#p-vat");
  function renderProducts() {
    pLines.innerHTML = state.products.length
      ? state.products.map((p, i) => {
          const lt = (Number(p.qty) || 0) * (Number(p.price) || 0);
          return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line)">
            <span style="flex:1;min-width:0">${escapeHtml(p.name)}<span style="color:var(--muted);font-size:.8rem"> · ${Number(p.qty) || 0} × ${p.price != null ? fmtCHF(Number(p.price)) : "—"}</span></span>
            <span style="font-weight:600">${fmtCHF(lt)}</span>
            <button type="button" data-rmp="${i}" style="border:0;background:none;cursor:pointer;color:var(--muted);display:flex">${icon("x", "icon-sm")}</button>
          </div>`;
        }).join("")
      : `<p style="color:var(--muted);margin:0;font-size:.86rem">Aucun produit ajouté.</p>`;
    const subtotal = state.products.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
    const disc = Number(pDisc.value) || 0, vat = Number(pVat.value) || 0;
    const discAmt = subtotal * disc / 100, after = subtotal - discAmt, vatAmt = after * vat / 100, total = after + vatAmt;
    const line = (l, v, strong) => `<div style="display:flex;justify-content:space-between;${strong ? "font-weight:700;font-size:1.05rem;margin-top:4px;color:var(--navy)" : "color:var(--muted);font-size:.88rem"}"><span>${l}</span><span>${fmtCHF(v)} CHF</span></div>`;
    pTotals.innerHTML = state.products.length
      ? line("Sous-total", subtotal) + (disc ? line(`Remise ${disc}%`, -discAmt) : "") + line(`TVA ${vat}%`, vatAmt) + line("Total", total, true)
      : "";
  }
  pDisc.addEventListener("input", renderProducts);
  pVat.addEventListener("input", renderProducts);
  root.querySelector("#p-add").addEventListener("click", () => {
    const name = pName.value.trim(); if (!name) return;
    state.products.push({ name, qty: Number(pQty.value) || 1, price: pPrice.value !== "" ? Number(pPrice.value) : null, product_id: selProductId });
    pName.value = ""; pQty.value = "1"; pPrice.value = ""; pResults.innerHTML = ""; selProductId = null; renderProducts(); pName.focus();
  });
  pLines.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rmp]"); if (!b) return;
    state.products.splice(Number(b.dataset.rmp), 1); renderProducts();
  });
  let pTmr = null, selProductId = null;
  pName.addEventListener("input", () => {
    selProductId = null;  // saisie manuelle → on perd le lien produit Odoo
    clearTimeout(pTmr); const q = pName.value.trim();
    if (q.length < 2) { pResults.innerHTML = ""; return; }
    pTmr = setTimeout(async () => {
      try {
        const list = await api(`/products/search?q=${encodeURIComponent(q)}`);
        pResults.innerHTML = list.map(p => `<div class="card" data-pid="${p.id}" data-pname="${escapeHtml(p.name)}" data-pprice="${p.list_price != null ? p.list_price : ""}" style="cursor:pointer;padding:8px 10px;margin:6px 0">${escapeHtml(p.name)}${p.list_price ? `<span style="color:var(--muted);font-size:.8rem"> · ${fmtCHF(p.list_price)} CHF</span>` : ""}</div>`).join("");
      } catch { pResults.innerHTML = ""; }
    }, 300);
  });
  pResults.addEventListener("click", (e) => {
    const d = e.target.closest("[data-pname]"); if (!d) return;
    pName.value = d.dataset.pname; selProductId = d.dataset.pid ? Number(d.dataset.pid) : null;
    if (d.dataset.pprice) pPrice.value = d.dataset.pprice; pResults.innerHTML = ""; pPrice.focus();
  });
  renderProducts();

  // Photos (caméra + galerie)
  const thumbs = root.querySelector("#iv-thumbs");
  const addPhotos = async (files) => {
    for (const f of files) {
      const data = await downscale(f); if (!data) continue;
      const i = photos.push(data) - 1;
      const w = document.createElement("div"); w.style.cssText = "position:relative";
      w.innerHTML = `<img src="${data}" style="width:72px;height:72px;object-fit:cover;border-radius:8px"><button type="button" data-rm="${i}" style="position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:22px;height:22px;background:var(--danger);color:#fff;cursor:pointer">×</button>`;
      thumbs.appendChild(w);
    }
  };
  root.querySelector("#iv-photo-cam").addEventListener("change", async (e) => { await addPhotos(e.target.files); e.target.value = ""; });
  root.querySelector("#iv-photo-gal").addEventListener("change", async (e) => { await addPhotos(e.target.files); e.target.value = ""; });
  thumbs.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; photos[Number(b.dataset.rm)] = null; b.parentElement.remove(); });

  // Signature
  const signCv = root.querySelector("#iv-sign");
  setupSignature(signCv, state);
  root.querySelector("#iv-sign-clear").addEventListener("click", () => {
    signCv.getContext("2d").clearRect(0, 0, signCv.width, signCv.height); state.signed = false;
  });

  // Submit
  const form = root.querySelector("#iv-form"), err = root.querySelector("#iv-error"), submit = root.querySelector("#iv-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    const clientName = ci.value.trim();
    if (!clientName) { err.textContent = "Indique un client (nom libre accepté)."; return; }
    if (!state.status) { err.textContent = "Choisis le statut de la tâche."; return; }
    const body = {
      type: root.querySelector("#iv-type").value,
      partner_id: pid.value ? Number(pid.value) : null,
      client_name: clientName,
      name: root.querySelector("#iv-desc").value.trim(),
      materials: root.querySelector("#iv-materials").value.trim() || null,
      date: root.querySelector("#iv-date").value,
      start_time: root.querySelector("#iv-start").value,
      end_time: root.querySelector("#iv-end").value,
      photos: photos.filter(Boolean),
      products: state.products,
      discount: Number(pDisc.value) || 0,
      vat_rate: Number(pVat.value) || 8.1,
      tag_ids: state.tags,
      worker_ids: state.workers,
      signature: state.signed ? signCv.toDataURL("image/png") : null,
      status: state.status,
      next_action: state.next === "rien" ? null : state.next,
      next_action_date: (state.next !== "rien" && root.querySelector("#iv-next-when").value) ? root.querySelector("#iv-next-when").value : null,
    };
    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try {
      const res = await api("/interventions", { method: "POST", body });
      selectedDate = body.date; terrain.render(root);
      let msg = "Intervention créée";
      if (res && res.worksheet) msg += " · fiche de chantier remplie";
      if (res && res.invoice) msg += " · facture brouillon";
      toast(msg);
    }
    catch (e2) { submit.disabled = false; submit.textContent = "Créer l'intervention"; err.textContent = (e2 && e2.message) ? e2.message : "Échec de la création."; }
  });
}
