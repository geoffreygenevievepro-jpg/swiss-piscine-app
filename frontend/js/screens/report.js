// Écran « Rapport d'intervention » — formulaire adaptatif unifié.
// ctx.slot  → rapport sur un créneau planning existant (client verrouillé)
// ctx.create → nouveau chantier (client éditable)
import { api } from "../api.js";
import { profile } from "../store.js";
import { enqueue, sync } from "../outbox.js";
import { fmtClock, escapeHtml } from "../util.js";
import { icon } from "../icons.js";

const hm = (dt) => (dt ? String(dt).slice(11, 16) : "");

// Réduit une image (max 1280px, JPEG 0.7) pour limiter le poids upload/offline.
function downscale(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      let { width, height } = img;
      if (width > max || height > max) {
        const r = Math.min(max / width, max / height);
        width = Math.round(width * r); height = Math.round(height * r);
      }
      const cv = document.createElement("canvas");
      cv.width = width; cv.height = height;
      cv.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(cv.toDataURL("image/jpeg", 0.7));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

export async function renderReport(root, ctx = {}) {
  const create = !!ctx.create;
  const slot = ctx.slot || { id: null, label: create ? "Nouvelle intervention" : "Intervention", partner_id: null };
  const onDone = ctx.onDone || (() => {});
  const opts = { autoStart: !!ctx.autoStart };

  let types = [];
  try { types = await api("/report-types"); } catch { types = []; }
  let tags = [];
  try { tags = await api("/report-tags"); } catch { tags = []; }
  if (!tags.length) tags = [{ id: 67, name: "à facturer" }, { id: 80, name: "SAV SP" }, { id: 81, name: "SAV client" }];
  let resources = [];
  try { resources = await api("/resources"); } catch {}

  const meEmp = (profile.get() || {}).hr_employee_id || null;
  const slotWorkers = Array.isArray(slot.employee_ids) ? slot.employee_ids.map(Number) : [];
  const state = {
    type: null, photos: [], start: null, end: null, timer: null, products: [], tags: [], next: "rien",
    status: null, signed: false,
    workers: slotWorkers.length ? [...slotWorkers] : (meEmp ? [meEmp] : []),  // employee_ids
    resources: [],                                                            // resource_ids (mode create)
    project: null, projectName: "", task: null,                              // projet / tâche Odoo
  };

  root.innerHTML = `
    <button class="btn secondary" id="r-back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Annuler</button>
    <h2 style="margin-top:0">Rapport d'intervention</h2>
    ${create ? "" : `<p style="color:var(--muted);margin:.2rem 0 16px">${escapeHtml(slot.label || "Intervention")}</p>`}
    ${create ? clientEditable() : clientCard(slot)}
    <div class="card"><strong>Projet <span class="muted" style="font-weight:400;font-size:.8rem">(optionnel)</span></strong>
      <input id="r-project" type="text" autocomplete="off" placeholder="Rechercher un projet (nom client)…"
        style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;margin-top:8px" />
      <div id="r-project-results"></div>
      <div id="r-task-wrap" style="display:none;margin-top:10px">
        <label style="font-size:.82rem;color:var(--muted)">Tâche</label>
        <select id="r-task" style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;background:#fbfdfe"><option value="">— Choisir une tâche —</option></select>
      </div>
      ${create ? `<div style="font-size:.74rem;color:var(--muted);margin-top:6px">Choisir un projet pré-remplit le client.</div>` : ""}
    </div>
    <p class="form-error" id="r-error"></p>

    <div class="card"><strong>Statut <span style="color:var(--danger)">*</span></strong>
      <div id="r-status" style="display:flex;gap:10px;margin-top:10px">
        <button type="button" class="chip" data-status="done" style="flex:1;min-height:50px;justify-content:center">${icon("check", "icon-sm")} Tâche terminée</button>
        <button type="button" class="chip" data-status="todo" style="flex:1;min-height:50px;justify-content:center">${icon("alert", "icon-sm")} Tâche à terminer</button>
      </div></div>

    <div class="card">
      <strong>Type d'intervention</strong>
      <div id="r-types" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${types.map(t => `<button type="button" class="chip" data-type="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>
    </div>

    <div class="card">
      <strong>Tags</strong>
      <div id="r-tags" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${tags.map(t => `<button type="button" class="chip" data-tag="${t.id}">${escapeHtml(t.name)}</button>`).join("")}
      </div>
    </div>

    <div class="card">
      <strong>Équipe sur le chantier</strong>
      <div style="font-size:.74rem;color:var(--muted);margin-top:2px">Qui a travaillé sur ce chantier ?</div>
      <div id="r-workers" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${resources.map(r => `<button type="button" class="chip${state.workers.includes(r.employee_id) ? " active" : ""}" data-rid="${r.resource_id}" data-eid="${r.employee_id ?? ""}">${escapeHtml(r.name)}</button>`).join("") || `<span style="color:var(--muted);font-size:.85rem">Liste indisponible</span>`}
      </div>
    </div>

    ${opts.autoStart ? `
    <div class="card" style="text-align:center">
      <strong>Temps d'intervention</strong>
      <div id="r-clock" style="font-size:2rem;font-weight:700;margin:.3rem 0">00:00:00</div>
      <button class="btn" id="r-timer" style="width:auto;padding:0 22px">${icon("play", "icon-sm")} Démarrer</button>
    </div>` : (create ? "" : `
    <div class="card"><strong>Horaire</strong>
      <div style="display:flex;gap:10px;margin-top:10px">
        <div class="field" style="flex:1;margin:0"><label>Début</label><input id="r-start-t" type="time" value="${hm(slot.start_datetime) || "08:00"}" /></div>
        <div class="field" style="flex:1;margin:0"><label>Fin</label><input id="r-end-t" type="time" value="${hm(slot.end_datetime) || "10:00"}" /></div>
      </div></div>`)}

    <div class="field"><label>Notes</label>
      <textarea id="r-notes" rows="3" placeholder="Observations, travaux réalisés…"
        style="width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:1rem"></textarea></div>

    <div class="field"><label>Matériel utilisé</label>
      <input id="r-materials" type="text" placeholder="Ex. 2 sacs de sable, vanne 6 voies…" /></div>

    <div class="card">
      <strong>Pièces / produits</strong>
      <div id="r-plines" style="margin:10px 0"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1 1 100%;position:relative">
          <input id="rp-name" type="text" autocomplete="off" placeholder="Pièce/produit (recherche Odoo ou libre)…" style="width:100%;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 10px;font-size:.95rem">
          <div id="rp-results"></div>
        </div>
        <input id="rp-qty" type="number" min="0" step="any" value="1" aria-label="Quantité" style="width:62px;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 8px;text-align:center">
        <input id="rp-price" type="number" min="0" step="any" placeholder="Prix" aria-label="Prix" style="width:84px;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 8px;text-align:right">
        <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;color:var(--muted)"><input id="rp-bill" type="checkbox" style="width:18px;height:18px;accent-color:var(--aqua-dark)">à facturer</label>
        <button type="button" class="btn" id="rp-add" style="width:auto;min-height:44px;padding:0 16px">${icon("plus")}</button>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <label style="flex:1;font-size:.8rem;color:var(--muted)">Remise %<input id="rp-disc" type="number" min="0" step="any" value="0" style="width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 8px;margin-top:4px"></label>
        <label style="flex:1;font-size:.8rem;color:var(--muted)">TVA %<input id="rp-vat" type="number" min="0" step="any" value="8.1" style="width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 8px;margin-top:4px"></label>
      </div>
      <div id="rp-totals" style="margin-top:10px"></div>
    </div>

    <div class="card">
      <strong>Photos</strong>
      <div id="r-thumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label class="btn secondary" style="cursor:pointer;flex:1">${icon("camera", "icon-sm")} Prendre une photo
          <input id="r-photo-cam" type="file" accept="image/*" capture="environment" hidden /></label>
        <label class="btn secondary" style="cursor:pointer;flex:1">${icon("image", "icon-sm")} Galerie
          <input id="r-photo-gal" type="file" accept="image/*" multiple hidden /></label>
      </div>
    </div>

    <div class="card">
      <strong>Prochaine action</strong>
      <div id="r-next" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${[["rien", "Rien"], ["rappel", "Rappel"], ["appel", "Appel client"], ["devis", "Devis SAV"]].map(([v, l]) => `<button type="button" class="chip ${v === "rien" ? "active" : ""}" data-next="${v}">${l}</button>`).join("")}
      </div>
      <div id="r-next-date" style="display:none;margin-top:10px">
        <label style="font-size:.82rem;color:var(--muted)">Échéance (optionnel)</label>
        <input id="r-next-when" type="date" style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem" />
      </div>
    </div>

    <div class="field"><label>Remarques</label>
      <textarea id="r-remarques" rows="2" placeholder="Remarque libre (interne)…"
        style="width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:1rem"></textarea></div>

    <div class="card">
      <strong>Signature du client</strong>
      <canvas id="r-sign" style="width:100%;height:170px;border:1px dashed var(--line);border-radius:12px;margin-top:10px;touch-action:none;background:#fff"></canvas>
      <button class="btn secondary" id="r-sign-clear" style="margin-top:8px">Effacer la signature</button>
    </div>

    <button class="btn" id="r-submit" style="margin-top:6px">${icon("check", "icon-sm")} Valider le rapport</button>`;

  root.querySelector("#r-back").addEventListener("click", onDone);

  // Ouvre le calendrier/sélecteur d'heure directement au clic sur le champ.
  root.querySelectorAll('input[type="date"], input[type="time"]').forEach(inp => {
    const open = () => { if (typeof inp.showPicker === "function") { try { inp.showPicker(); } catch {} } };
    inp.addEventListener("click", open);
  });

  // --- Client (mode create) ---
  if (create) {
    const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; };
    const cdate = root.querySelector("#r-date"); if (cdate) cdate.value = todayISO();
    const ci = root.querySelector("#r-client"), cres = root.querySelector("#r-client-results"), cpid = root.querySelector("#r-partner-id");
    let ctmr = null;
    ci.addEventListener("input", () => {
      cpid.value = ""; clearTimeout(ctmr);
      const q = ci.value.trim(); if (q.length < 2) { cres.innerHTML = ""; return; }
      ctmr = setTimeout(async () => {
        try {
          const list = await api(`/partners/search?q=${encodeURIComponent(q)}`);
          cres.innerHTML = list.map(p => `<div class="card" data-pid="${p.id}" data-name="${escapeHtml(p.name)}" style="cursor:pointer;padding:10px;margin:6px 0"><strong>${escapeHtml(p.name)}</strong><span style="color:var(--muted);font-size:.8rem"> ${escapeHtml(p.city || "")}</span></div>`).join("");
        } catch { cres.innerHTML = ""; }
      }, 300);
    });
    cres.addEventListener("click", (e) => {
      const c = e.target.closest("[data-pid]");
      if (c) { cpid.value = c.dataset.pid; ci.value = c.dataset.name; cres.innerHTML = ""; }
    });
  }

  // --- Statut ---
  const statusWrap = root.querySelector("#r-status");
  statusWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]"); if (!b) return;
    state.status = b.dataset.status;
    statusWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
  });

  // --- Projet (recherche) → Tâches + pré-remplissage client (mode create) ---
  const pj = root.querySelector("#r-project"), pjRes = root.querySelector("#r-project-results");
  const taskWrap = root.querySelector("#r-task-wrap"), taskSel = root.querySelector("#r-task");
  let pjTmr = null;
  pj.addEventListener("input", () => {
    state.project = null; state.projectName = ""; state.task = null;
    taskWrap.style.display = "none"; clearTimeout(pjTmr);
    const q = pj.value.trim(); if (q.length < 2) { pjRes.innerHTML = ""; return; }
    pjTmr = setTimeout(async () => {
      try {
        const list = await api(`/projects/search?q=${encodeURIComponent(q)}`);
        pjRes.innerHTML = list.map(p => `<div class="card" data-pjid="${p.id}" data-pjname="${escapeHtml(p.name)}" data-partid="${p.partner_id ?? ""}" data-partname="${escapeHtml(p.partner_name || "")}" style="cursor:pointer;padding:10px;margin:6px 0"><strong>${escapeHtml(p.name)}</strong>${p.partner_name ? `<span style="color:var(--muted);font-size:.8rem"> · ${escapeHtml(p.partner_name)}</span>` : ""}</div>`).join("");
      } catch { pjRes.innerHTML = ""; }
    }, 300);
  });
  pjRes.addEventListener("click", async (e) => {
    const d = e.target.closest("[data-pjid]"); if (!d) return;
    state.project = Number(d.dataset.pjid); state.projectName = d.dataset.pjname;
    pj.value = d.dataset.pjname; pjRes.innerHTML = "";
    if (create && d.dataset.partid) {
      const ci = root.querySelector("#r-client"), pid = root.querySelector("#r-partner-id");
      if (pid) pid.value = d.dataset.partid;
      if (ci && d.dataset.partname) ci.value = d.dataset.partname;
    }
    state.task = null; taskSel.innerHTML = `<option value="">— Choisir une tâche —</option>`;
    try {
      const tasks = await api(`/projects/${state.project}/tasks`);
      taskSel.innerHTML += tasks.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
      taskWrap.style.display = tasks.length ? "block" : "none";
    } catch { taskWrap.style.display = "none"; }
  });
  taskSel.addEventListener("change", () => { state.task = taskSel.value ? Number(taskSel.value) : null; });

  // --- Type (chips) ---
  const typesWrap = root.querySelector("#r-types");
  typesWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    state.type = b.dataset.type;
    typesWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
  });

  // --- Tags (multi-sélection) ---
  const tagsWrap = root.querySelector("#r-tags");
  tagsWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]");
    if (!b) return;
    const id = Number(b.dataset.tag);
    const i = state.tags.indexOf(id);
    if (i >= 0) { state.tags.splice(i, 1); b.classList.remove("active"); }
    else { state.tags.push(id); b.classList.add("active"); }
  });

  // --- Équipe sur le chantier (ressources) ---
  const workersWrap = root.querySelector("#r-workers");
  workersWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rid]"); if (!b) return;
    const rid = Number(b.dataset.rid);
    const eid = b.dataset.eid ? Number(b.dataset.eid) : null;
    const on = b.classList.toggle("active");
    const setOf = (arr, v) => { const i = arr.indexOf(v); if (on && i < 0) arr.push(v); if (!on && i >= 0) arr.splice(i, 1); };
    setOf(state.resources, rid);
    if (eid != null) setOf(state.workers, eid);
  });

  // --- Timer (conditionnel) ---
  const timerBtn = root.querySelector("#r-timer");
  if (timerBtn) {
    const clockEl = root.querySelector("#r-clock");
    function startChrono() {
      if (state.start) return;
      state.start = Date.now();
      timerBtn.innerHTML = `${icon("stop", "icon-sm")} Terminer`;
      timerBtn.style.background = "var(--danger)";
      state.timer = setInterval(() => { clockEl.textContent = fmtClock(Math.floor((Date.now() - state.start) / 1000)); }, 1000);
    }
    function stopChrono() {
      if (!state.start || state.end) return;
      state.end = Date.now();
      clearInterval(state.timer); state.timer = null;
      timerBtn.innerHTML = `${icon("check", "icon-sm")} Temps enregistré`;
      timerBtn.disabled = true;
    }
    timerBtn.addEventListener("click", () => { if (!state.start) startChrono(); else stopChrono(); });
    if (opts.autoStart) startChrono();
  }

  // --- Photos (caméra + galerie) ---
  const thumbs = root.querySelector("#r-thumbs");
  const addPhotos = async (files) => {
    for (const file of files) {
      const data = await downscale(file);
      if (!data) continue;
      const idx = state.photos.push(data) - 1;
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative";
      wrap.innerHTML = `<img src="${data}" style="width:72px;height:72px;object-fit:cover;border-radius:8px" />
        <button data-rm="${idx}" style="position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:22px;height:22px;background:var(--danger);color:#fff;cursor:pointer">×</button>`;
      thumbs.appendChild(wrap);
    }
  };
  root.querySelector("#r-photo-cam").addEventListener("change", async (e) => { await addPhotos(e.target.files); e.target.value = ""; });
  root.querySelector("#r-photo-gal").addEventListener("change", async (e) => { await addPhotos(e.target.files); e.target.value = ""; });
  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    state.photos[Number(b.dataset.rm)] = null;  // marque supprimé (compacté à l'envoi)
    b.parentElement.remove();
  });

  // --- Pièces / produits facturables ---
  const fmtCHF = (n) => n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pName = root.querySelector("#rp-name"), pQty = root.querySelector("#rp-qty"), pPrice = root.querySelector("#rp-price");
  const pBill = root.querySelector("#rp-bill"), pResults = root.querySelector("#rp-results");
  const pLines = root.querySelector("#r-plines"), pTotals = root.querySelector("#rp-totals");
  const pDisc = root.querySelector("#rp-disc"), pVat = root.querySelector("#rp-vat");
  let selPid = null;
  function renderProducts() {
    pLines.innerHTML = state.products.length
      ? state.products.map((p, i) => {
          return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line)">
            <span style="flex:1;min-width:0">${escapeHtml(p.name)}${p.billable ? ` <span class="chip active" style="padding:1px 6px;font-size:.7rem">à facturer</span>` : ""}<span style="color:var(--muted);font-size:.8rem"> · ${Number(p.qty) || 0} × ${p.price != null ? fmtCHF(Number(p.price)) : "—"}</span></span>
            <button type="button" data-rmp="${i}" style="border:0;background:none;cursor:pointer;color:var(--muted);display:flex">${icon("x", "icon-sm")}</button>
          </div>`;
        }).join("")
      : `<p style="color:var(--muted);margin:0;font-size:.86rem">Aucune pièce ajoutée.</p>`;
    const bill = state.products.filter(p => p.billable);
    const subtotal = bill.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
    const disc = Number(pDisc.value) || 0, vat = Number(pVat.value) || 0;
    const discAmt = subtotal * disc / 100, after = subtotal - discAmt, vatAmt = after * vat / 100, total = after + vatAmt;
    const line = (l, v, strong) => `<div style="display:flex;justify-content:space-between;${strong ? "font-weight:700;font-size:1.05rem;margin-top:4px;color:var(--navy)" : "color:var(--muted);font-size:.88rem"}"><span>${l}</span><span>${fmtCHF(v)} CHF</span></div>`;
    pTotals.innerHTML = bill.length ? line("Sous-total à facturer", subtotal) + (disc ? line(`Remise ${disc}%`, -discAmt) : "") + line(`TVA ${vat}%`, vatAmt) + line("Total", total, true) : "";
  }
  pDisc.addEventListener("input", renderProducts);
  pVat.addEventListener("input", renderProducts);
  root.querySelector("#rp-add").addEventListener("click", () => {
    const name = pName.value.trim(); if (!name) return;
    state.products.push({ name, qty: Number(pQty.value) || 1, price: pPrice.value !== "" ? Number(pPrice.value) : null, product_id: selPid, billable: pBill.checked });
    pName.value = ""; pQty.value = "1"; pPrice.value = ""; pBill.checked = false; pResults.innerHTML = ""; selPid = null; renderProducts(); pName.focus();
  });
  pLines.addEventListener("click", (e) => { const b = e.target.closest("[data-rmp]"); if (!b) return; state.products.splice(Number(b.dataset.rmp), 1); renderProducts(); });
  let pTmr = null;
  pName.addEventListener("input", () => {
    selPid = null; clearTimeout(pTmr); const q = pName.value.trim();
    if (q.length < 2) { pResults.innerHTML = ""; return; }
    pTmr = setTimeout(async () => {
      try {
        const list = await api(`/products/search?q=${encodeURIComponent(q)}`);
        pResults.innerHTML = list.map(p => `<div class="card" data-pid="${p.id}" data-pname="${escapeHtml(p.name)}" data-pprice="${p.list_price != null ? p.list_price : ""}" style="cursor:pointer;padding:8px 10px;margin:6px 0">${escapeHtml(p.name)}${p.list_price ? `<span style="color:var(--muted);font-size:.8rem"> · ${fmtCHF(p.list_price)} CHF</span>` : ""}</div>`).join("");
      } catch { pResults.innerHTML = ""; }
    }, 300);
  });
  pResults.addEventListener("click", (e) => { const d = e.target.closest("[data-pname]"); if (!d) return; pName.value = d.dataset.pname; selPid = d.dataset.pid ? Number(d.dataset.pid) : null; if (d.dataset.pprice) pPrice.value = d.dataset.pprice; pResults.innerHTML = ""; pPrice.focus(); });
  renderProducts();

  // --- Prochaine action ---
  const nextWrap = root.querySelector("#r-next");
  const nextDate = root.querySelector("#r-next-date");
  nextWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-next]"); if (!b) return;
    state.next = b.dataset.next;
    nextWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
    nextDate.style.display = state.next === "rien" ? "none" : "block";
  });

  // --- Signature ---
  setupSignature(root.querySelector("#r-sign"), state);
  root.querySelector("#r-sign-clear").addEventListener("click", () => {
    const cv = root.querySelector("#r-sign");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    state.signed = false;
  });

  // --- Submit (routage unifié) ---
  const err = root.querySelector("#r-error");
  const submit = root.querySelector("#r-submit");
  submit.addEventListener("click", async () => {
    err.textContent = "";
    if (!state.type) { err.textContent = "Choisis un type d'intervention."; return; }
    if (!state.status) { err.textContent = "Choisis le statut de la tâche."; return; }
    const photos = state.photos.filter(Boolean);

    const parts = state.products.map(p => p.name).filter(Boolean);
    const billable = state.products.filter(p => p.billable);
    const remarques = root.querySelector("#r-remarques").value.trim() || null;
    const notes = root.querySelector("#r-notes").value.trim() || null;
    const materials = root.querySelector("#r-materials").value.trim() || null;
    const discount = Number(root.querySelector("#rp-disc").value) || 0;
    const vat = Number(root.querySelector("#rp-vat").value) || 8.1;
    const signCv = root.querySelector("#r-sign");
    const signature = state.signed ? signCv.toDataURL("image/png") : null;
    const nextWhen = root.querySelector("#r-next-when");
    const next_action = state.next === "rien" ? null : state.next;
    const next_action_date = (state.next !== "rien" && nextWhen && nextWhen.value) ? nextWhen.value : null;

    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try {
      if (create) {
        const cname = root.querySelector("#r-client").value.trim();
        if (!cname) { throw new Error("Indique un client (nom libre accepté)."); }
        const pid = root.querySelector("#r-partner-id").value;
        const body = {
          type: state.type, name: notes || "", materials,
          date: root.querySelector("#r-date").value,
          start_time: root.querySelector("#r-start-t").value,
          end_time: root.querySelector("#r-end-t").value,
          partner_id: pid ? Number(pid) : null, client_name: cname,
          photos, parts, products: billable, discount, vat_rate: vat,
          tag_ids: state.tags, worker_ids: state.workers, resource_ids: state.resources,
          project_id: state.project, task_id: state.task,
          signature, status: state.status, remarques,
          next_action, next_action_date,
        };
        const res = await api("/interventions", { method: "POST", body });
        let msg = "Intervention créée";
        if (res && res.worksheet) msg += " · fiche remplie";
        if (res && res.invoice) msg += " · facture brouillon";
        onDone(msg);
      } else {
        // schedule/hours : depuis le chrono si présent, sinon depuis les heures saisies.
        let schedule = null, hours = null;
        if (state.start && state.end) {
          schedule = `${tHM(state.start)} – ${tHM(state.end)}`;
          hours = Number(((state.end - state.start) / 3600000).toFixed(2));
        } else {
          const st = root.querySelector("#r-start-t"), en = root.querySelector("#r-end-t");
          if (st && en && st.value && en.value) {
            schedule = `${st.value} – ${en.value}`;
            const [sh, sm] = st.value.split(":").map(Number), [eh, em] = en.value.split(":").map(Number);
            const diff = (eh * 60 + em) - (sh * 60 + sm);
            if (diff > 0) hours = Number((diff / 60).toFixed(2));
          }
        }
        const payload = {
          type: state.type, notes, materials, schedule, hours, photos, signature,
          parts, products: billable, discount, vat_rate: vat,
          tag_ids: state.tags, worker_ids: state.workers, resource_ids: state.resources,
          project_id: state.project, task_id: state.task,
          status: state.status, remarques, next_action, next_action_date,
        };
        await enqueue(slot.id, payload);
        const remaining = await sync();
        onDone(remaining > 0
          ? "Rapport enregistré — il sera envoyé dès le retour du réseau."
          : "Rapport envoyé");
      }
    } catch (e) {
      submit.disabled = false;
      submit.innerHTML = `${icon("check", "icon-sm")} Valider le rapport`;
      err.textContent = (e && e.message) ? e.message : "Impossible d'enregistrer le rapport.";
    }
  });
}

function tHM(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Carte client (pré-remplie depuis les données Odoo du chantier) : nom, adresse, contact.
function clientCard(slot) {
  const pn = slot.partner || {};
  const name = pn.name || (slot.partner_id ? slot.partner_id[1] : null);
  if (!name) return "";
  const addr = [pn.street, pn.street2, [pn.zip, pn.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const tel = pn.phone;
  const maps = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
  return `<div class="card">
    <strong>${escapeHtml(name)}</strong>
    ${addr ? `<p style="color:var(--muted);margin:.3rem 0 0">${escapeHtml(addr)}</p>` : ""}
    ${(tel || maps) ? `<div style="display:flex;gap:10px;margin-top:10px">
      ${tel ? `<a class="btn" href="tel:${escapeHtml(tel)}" style="text-decoration:none;width:auto;flex:1">${icon("phone", "icon-sm")} Appeler</a>` : ""}
      ${maps ? `<a class="btn secondary" href="${maps}" target="_blank" rel="noopener" style="text-decoration:none;width:auto;flex:1">${icon("navigation", "icon-sm")} Itinéraire</a>` : ""}
    </div>` : ""}
  </div>`;
}

// Saisie client (mode create) : recherche Odoo, texte libre accepté.
function clientEditable() {
  return `<div class="card"><strong>Client <span style="color:var(--danger)">*</span></strong>
    <input id="r-client" type="text" autocomplete="off" placeholder="Nom du client (recherche Odoo ou libre)…"
      style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;margin-top:8px" />
    <div id="r-client-results"></div><input type="hidden" id="r-partner-id" />
    <div style="display:flex;gap:10px;margin-top:10px">
      <div class="field" style="flex:1;margin:0"><label>Date</label><input id="r-date" type="date" required /></div>
      <div class="field" style="flex:1;margin:0"><label>Début</label><input id="r-start-t" type="time" value="08:00" required /></div>
      <div class="field" style="flex:1;margin:0"><label>Fin</label><input id="r-end-t" type="time" value="10:00" required /></div>
    </div>
    <div style="font-size:.74rem;color:var(--muted);margin-top:4px">Client non trouvé = accepté en texte libre (créé seulement si facturation).</div>
  </div>`;
}

export function setupSignature(canvas, state) {
  // Ajuste la résolution interne du canvas à sa taille affichée.
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#0c2233";
  let drawing = false;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const start = (e) => { e.preventDefault(); drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => { if (!drawing) return; e.preventDefault(); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); state.signed = true; };
  const end = () => { drawing = false; };

  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointerleave", end);
}
