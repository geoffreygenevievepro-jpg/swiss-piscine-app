// Onglet TERRAIN — interventions du jour choisi (défaut aujourd'hui) + détail + création.
import { api } from "../api.js";
import { escapeHtml, toast } from "../util.js";
import { renderReport } from "./report.js";

let selectedDate = null;  // YYYY-MM-DD ; null = aujourd'hui
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
  label: "Terrain",
  icon: "🧰",
  async render(root) {
    const date = selectedDate || todayISO();
    root.innerHTML = `${dateHeader(date)}<div id="iv-zone"><div class="placeholder"><div class="big">📋</div>Chargement…</div></div>`;
    bindDate(root);
    let data;
    try { data = await api(`/interventions/today?date=${date}`); }
    catch { root.querySelector("#iv-zone").innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger les interventions.</div>`; return; }
    renderList(root, data.interventions || []);
  },
};

function dateHeader(date) {
  const d = new Date(date + "T00:00:00");
  const isToday = date === todayISO();
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px">
      <h2 style="margin:0">Interventions</h2>
      <button class="btn" id="iv-add" style="width:auto;min-height:40px;padding:0 16px">＋ Ajouter</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0 16px">
      <button class="btn secondary nav" id="d-prev" aria-label="Jour précédent">‹</button>
      <label style="flex:1;position:relative">
        <input id="d-date" type="date" value="${date}" style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;background:#fff;text-align:center;font-weight:600;color:var(--navy)">
      </label>
      <button class="btn secondary nav" id="d-next" aria-label="Jour suivant">›</button>
    </div>
    ${isToday ? "" : `<p style="text-align:center;margin:-8px 0 12px"><button class="btn secondary" id="d-today" style="width:auto;min-height:34px;padding:0 14px;font-size:.85rem">Revenir à aujourd'hui</button></p>`}`;
}

function bindDate(root) {
  const shift = (days) => { const d = new Date((selectedDate || todayISO()) + "T00:00:00"); d.setDate(d.getDate() + days); selectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; terrain.render(root); };
  root.querySelector("#d-prev").addEventListener("click", () => shift(-1));
  root.querySelector("#d-next").addEventListener("click", () => shift(1));
  root.querySelector("#d-date").addEventListener("change", (e) => { selectedDate = e.target.value || todayISO(); terrain.render(root); });
  const t = root.querySelector("#d-today"); if (t) t.addEventListener("click", () => { selectedDate = null; terrain.render(root); });
  root.querySelector("#iv-add").addEventListener("click", () => renderForm(root));
}

function hm(dt) { return dt ? dt.slice(11, 16) : ""; }

function renderList(root, slots) {
  const zone = root.querySelector("#iv-zone");
  if (!slots.length) { zone.innerHTML = `<div class="placeholder"><div class="big">☀️</div>Aucune intervention ce jour-là.</div>`; return; }
  zone.innerHTML = `<div id="slot-list">${slots.map(slotCard).join("")}</div>`;
  zone.querySelector("#slot-list").addEventListener("click", (e) => {
    const c = e.target.closest("[data-slot]"); if (c) renderDetail(root, Number(c.dataset.slot));
  });
}

function slotCard(s) {
  const done = s.state === "1_done";
  const color = done ? "var(--ok)" : "var(--aqua-dark)";
  const client = s.partner_id ? s.partner_id[1] : "";
  return `<div class="card" data-slot="${s.id}" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start">
    <div style="flex:0 0 auto;text-align:center;min-width:48px">
      <div style="font-weight:700;color:${color}">${hm(s.start_datetime)}</div>
      <div style="font-size:.72rem;color:var(--muted)">${hm(s.end_datetime)}</div></div>
    <div style="flex:1;min-width:0"><strong>${escapeHtml(s.label)}</strong>
      ${client ? `<div style="color:var(--muted);font-size:.88rem;margin-top:2px">${escapeHtml(client)}</div>` : ""}
      ${done ? `<div style="font-size:.75rem;color:var(--ok);margin-top:4px">Terminé ✓</div>` : ""}</div>
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
  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0">${escapeHtml(s.label)}</h2>
    <div class="card"><strong>Horaire</strong><p style="color:var(--muted);margin:.3rem 0 0">${hm(s.start_datetime)} – ${hm(s.end_datetime)}</p></div>
    ${s.partner_id ? `<div class="card"><strong>${escapeHtml(pn.name || s.partner_id[1])}</strong>${addr ? `<p style="color:var(--muted);margin:.4rem 0 0">${escapeHtml(addr)}</p>` : ""}</div>
    <div style="display:flex;gap:10px">
      ${tel ? `<a class="btn" href="tel:${escapeHtml(tel)}" style="text-decoration:none">📞 Appeler</a>` : ""}
      ${maps ? `<a class="btn secondary" href="${maps}" target="_blank" rel="noopener" style="text-decoration:none">🗺️ Itinéraire</a>` : ""}
    </div>` : ""}
    <button class="btn" id="do-report" style="margin-top:16px">📝 Faire le rapport</button>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));
  root.querySelector("#do-report").addEventListener("click", () =>
    renderReport(root, { id: slotId, label: s.label }, (msg) => { terrain.render(root); if (msg) toast(msg); }));
}

async function renderForm(root) {
  const back = () => terrain.render(root);
  let types = [];
  try { types = await api("/report-types"); } catch {}
  const photos = [];
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
      <div class="field"><label>Client <span style="color:var(--danger)">*</span></label>
        <input id="iv-client" type="text" autocomplete="off" placeholder="Rechercher un client…" />
        <div id="iv-client-results"></div><input type="hidden" id="iv-partner-id" /></div>
      <div class="field"><label>Date</label><input id="iv-date" type="date" value="${date}" required /></div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Début</label><input id="iv-start" type="time" value="08:00" required /></div>
        <div class="field" style="flex:1"><label>Fin</label><input id="iv-end" type="time" value="10:00" required /></div>
      </div>
      <div class="field"><label>Description</label>
        <textarea id="iv-desc" rows="3" placeholder="Détails de l'intervention…" style="width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:1rem"></textarea></div>
      <div class="card"><strong>Photos</strong>
        <div id="iv-thumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"></div>
        <label class="btn secondary" style="cursor:pointer">📷 Ajouter des photos
          <input id="iv-photo" type="file" accept="image/*" capture="environment" multiple hidden /></label></div>
      <button class="btn" type="submit" id="iv-submit">Créer l'intervention</button>
    </form>`;
  root.querySelector("#back").addEventListener("click", back);

  // Recherche client
  const ci = root.querySelector("#iv-client"), results = root.querySelector("#iv-client-results"), pid = root.querySelector("#iv-partner-id");
  let tmr = null;
  ci.addEventListener("input", () => {
    pid.value = ""; clearTimeout(tmr);
    const q = ci.value.trim(); if (q.length < 2) { results.innerHTML = ""; return; }
    tmr = setTimeout(async () => {
      try {
        const list = await api(`/partners/search?q=${encodeURIComponent(q)}`);
        results.innerHTML = list.map(pp => `<div class="card" data-pid="${pp.id}" style="cursor:pointer;padding:10px;margin:6px 0"><strong>${escapeHtml(pp.name)}</strong><span style="color:var(--muted);font-size:.8rem"> ${escapeHtml(pp.city || "")}</span></div>`).join("");
      } catch { results.innerHTML = ""; }
    }, 300);
  });
  results.addEventListener("click", (e) => { const c = e.target.closest("[data-pid]"); if (!c) return; pid.value = c.dataset.pid; ci.value = c.querySelector("strong").textContent; results.innerHTML = ""; });

  // Photos
  const thumbs = root.querySelector("#iv-thumbs");
  root.querySelector("#iv-photo").addEventListener("change", async (e) => {
    for (const f of e.target.files) { const data = await downscale(f); if (!data) continue; const i = photos.push(data) - 1;
      const w = document.createElement("div"); w.style.cssText = "position:relative";
      w.innerHTML = `<img src="${data}" style="width:72px;height:72px;object-fit:cover;border-radius:8px"><button data-rm="${i}" style="position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:22px;height:22px;background:var(--danger);color:#fff;cursor:pointer">×</button>`;
      thumbs.appendChild(w); }
    e.target.value = "";
  });
  thumbs.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; photos[Number(b.dataset.rm)] = null; b.parentElement.remove(); });

  // Submit
  const form = root.querySelector("#iv-form"), err = root.querySelector("#iv-error"), submit = root.querySelector("#iv-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!pid.value) { err.textContent = "Le client est obligatoire."; return; }
    const body = {
      type: root.querySelector("#iv-type").value,
      partner_id: Number(pid.value),
      name: root.querySelector("#iv-desc").value.trim(),
      date: root.querySelector("#iv-date").value,
      start_time: root.querySelector("#iv-start").value,
      end_time: root.querySelector("#iv-end").value,
      photos: photos.filter(Boolean),
    };
    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try { await api("/interventions", { method: "POST", body }); selectedDate = body.date; terrain.render(root); toast("Intervention créée ✓"); }
    catch { submit.disabled = false; submit.textContent = "Créer l'intervention"; err.textContent = "Échec de la création."; }
  });
}
