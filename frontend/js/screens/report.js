// Écran « Rapport d'intervention » — une seule form simple, complète.
// Type · chrono Démarrer/Terminer · notes · matériel · photos · signature tactile.
import { api } from "../api.js";
import { enqueue, sync } from "../outbox.js";
import { fmtClock, escapeHtml } from "../util.js";

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

export async function renderReport(root, slot, onDone, opts = {}) {
  let types = [];
  try { types = await api("/report-types"); } catch { types = []; }

  const state = { type: null, photos: [], start: null, end: null, timer: null, parts: [], next: "rien" };

  root.innerHTML = `
    <button class="btn secondary" id="r-back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Annuler</button>
    <h2 style="margin-top:0">Rapport d'intervention</h2>
    <p style="color:var(--muted);margin:.2rem 0 16px">${escapeHtml(slot.label || "Intervention")}</p>
    <p class="form-error" id="r-error"></p>

    <div class="card">
      <strong>Type d'intervention</strong>
      <div id="r-types" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${types.map(t => `<button type="button" class="chip" data-type="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>
    </div>

    <div class="card" style="text-align:center">
      <strong>Temps d'intervention</strong>
      <div id="r-clock" style="font-size:2rem;font-weight:700;margin:.3rem 0">00:00:00</div>
      <button class="btn" id="r-timer" style="width:auto;padding:0 22px">▶️ Démarrer</button>
    </div>

    <div class="field"><label>Notes</label>
      <textarea id="r-notes" rows="3" placeholder="Observations, travaux réalisés…"
        style="width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:1rem"></textarea></div>

    <div class="field"><label>Matériel utilisé</label>
      <input id="r-materials" type="text" placeholder="Ex. 2 sacs de sable, vanne 6 voies…" /></div>

    <div class="card">
      <strong>Pièces utilisées</strong>
      <div id="r-parts" style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0"></div>
      <input id="r-part-search" type="text" autocomplete="off" placeholder="Rechercher une pièce (filtre, chlore…)"
        style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem" />
      <div id="r-part-results"></div>
    </div>

    <div class="card">
      <strong>Photos</strong>
      <div id="r-thumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"></div>
      <label class="btn secondary" style="cursor:pointer">
        📷 Ajouter des photos
        <input id="r-photo-input" type="file" accept="image/*" capture="environment" multiple hidden />
      </label>
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

    <div class="card">
      <strong>Signature du client</strong>
      <canvas id="r-sign" style="width:100%;height:170px;border:1px dashed var(--line);border-radius:12px;margin-top:10px;touch-action:none;background:#fff"></canvas>
      <button class="btn secondary" id="r-sign-clear" style="margin-top:8px">Effacer la signature</button>
    </div>

    <button class="btn" id="r-submit" style="margin-top:6px">✓ Valider le rapport</button>`;

  root.querySelector("#r-back").addEventListener("click", onDone);

  // --- Type (chips) ---
  const typesWrap = root.querySelector("#r-types");
  typesWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    state.type = b.dataset.type;
    typesWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
  });

  // --- Timer ---
  const clockEl = root.querySelector("#r-clock");
  const timerBtn = root.querySelector("#r-timer");
  function startChrono() {
    if (state.start) return;
    state.start = Date.now();
    timerBtn.textContent = "⏹️ Terminer";
    timerBtn.style.background = "var(--danger)";
    state.timer = setInterval(() => {
      clockEl.textContent = fmtClock(Math.floor((Date.now() - state.start) / 1000));
    }, 1000);
  }
  function stopChrono() {
    if (!state.start || state.end) return;
    state.end = Date.now();
    clearInterval(state.timer); state.timer = null;
    timerBtn.textContent = "✓ Temps enregistré";
    timerBtn.disabled = true;
  }
  timerBtn.addEventListener("click", () => { if (!state.start) startChrono(); else stopChrono(); });
  if (opts.autoStart) startChrono();  // ouvert via « ▶️ Démarrer l'intervention »

  // --- Photos ---
  const thumbs = root.querySelector("#r-thumbs");
  root.querySelector("#r-photo-input").addEventListener("change", async (e) => {
    for (const file of e.target.files) {
      const data = await downscale(file);
      if (!data) continue;
      const idx = state.photos.push(data) - 1;
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative";
      wrap.innerHTML = `<img src="${data}" style="width:72px;height:72px;object-fit:cover;border-radius:8px" />
        <button data-rm="${idx}" style="position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:22px;height:22px;background:var(--danger);color:#fff;cursor:pointer">×</button>`;
      thumbs.appendChild(wrap);
    }
    e.target.value = "";
  });
  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    state.photos[Number(b.dataset.rm)] = null;  // marque supprimé (compacté à l'envoi)
    b.parentElement.remove();
  });

  // --- Pièces utilisées ---
  const partsWrap = root.querySelector("#r-parts");
  const partSearch = root.querySelector("#r-part-search");
  const partResults = root.querySelector("#r-part-results");
  function renderParts() {
    partsWrap.innerHTML = state.parts.map((p, i) =>
      `<span class="chip active" data-rmpart="${i}" style="cursor:pointer">${escapeHtml(p)} ✕</span>`).join("");
  }
  function addPart(name) {
    name = (name || "").trim();
    if (!name || state.parts.includes(name)) return;
    state.parts.push(name); renderParts(); partResults.innerHTML = ""; partSearch.value = "";
  }
  partsWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rmpart]"); if (!b) return;
    state.parts.splice(Number(b.dataset.rmpart), 1); renderParts();
  });
  let partTmr = null;
  partSearch.addEventListener("input", () => {
    clearTimeout(partTmr); const q = partSearch.value.trim();
    if (q.length < 2) { partResults.innerHTML = ""; return; }
    partTmr = setTimeout(async () => {
      try {
        const list = await api(`/products/search?q=${encodeURIComponent(q)}`);
        partResults.innerHTML = list.map(p => `<div class="card" data-part="${escapeHtml(p.name)}" style="cursor:pointer;padding:8px 10px;margin:6px 0">${escapeHtml(p.name)}</div>`).join("")
          + `<button type="button" class="btn secondary" id="r-part-add" style="margin:6px 0">➕ Ajouter « ${escapeHtml(q)} »</button>`;
      } catch { partResults.innerHTML = ""; }
    }, 300);
  });
  partResults.addEventListener("click", (e) => {
    const d = e.target.closest("[data-part]"); if (d) { addPart(d.dataset.part); return; }
    if (e.target.closest("#r-part-add")) addPart(partSearch.value);
  });

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

  // --- Submit ---
  const err = root.querySelector("#r-error");
  const submit = root.querySelector("#r-submit");
  submit.addEventListener("click", async () => {
    err.textContent = "";
    if (!state.type) { err.textContent = "Choisis un type d'intervention."; return; }

    const photos = state.photos.filter(Boolean);
    if (photos.length < 2) { err.textContent = "Ajoute au moins 2 photos."; return; }
    const signCv = root.querySelector("#r-sign");
    const hours = state.start && state.end ? (state.end - state.start) / 3600000 : null;
    const schedule = state.start && state.end
      ? `${tHM(state.start)} – ${tHM(state.end)}` : null;
    const nextWhen = root.querySelector("#r-next-when");

    const payload = {
      type: state.type,
      notes: root.querySelector("#r-notes").value.trim() || null,
      materials: root.querySelector("#r-materials").value.trim() || null,
      schedule,
      hours: hours ? Number(hours.toFixed(2)) : null,
      photos,
      signature: state.signed ? signCv.toDataURL("image/png") : null,
      parts: state.parts,
      next_action: state.next === "rien" ? null : state.next,
      next_action_date: (state.next !== "rien" && nextWhen && nextWhen.value) ? nextWhen.value : null,
    };

    submit.disabled = true;
    submit.innerHTML = `<span class="spinner"></span>`;
    try {
      await enqueue(slot.id, payload);   // toujours mis en file (sécurité offline)
      const remaining = await sync();    // tentative d'envoi immédiat
      onDone(remaining > 0
        ? "Rapport enregistré — il sera envoyé dès le retour du réseau."
        : "Rapport envoyé ✓");
    } catch {
      submit.disabled = false;
      submit.textContent = "✓ Valider le rapport";
      err.textContent = "Impossible d'enregistrer le rapport.";
    }
  });
}

function tHM(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function setupSignature(canvas, state) {
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
