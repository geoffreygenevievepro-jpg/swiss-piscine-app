// Onglet TERRAIN — « Ma journée » : interventions PLANIFIÉES du jour (planning.slot)
// + ajout d'une intervention. Le détail montre les infos client (appel, itinéraire).
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml, toast } from "../util.js";
import { renderReport } from "./report.js";

export const terrain = {
  id: "terrain",
  label: "Terrain",
  icon: "🧰",

  async render(root) {
    const p = profile.get();
    const prenom = p?.name?.split(" ").slice(-1)[0] || "";
    root.innerHTML = `<h2>Ma journée</h2>
      <div class="placeholder"><div class="big">📋</div>Chargement…</div>`;
    let data;
    try {
      data = await api("/interventions/today");
    } catch {
      root.querySelector(".placeholder").innerHTML = `<div class="big">⚠️</div>Impossible de charger le planning.`;
      return;
    }
    renderList(root, prenom, data.interventions || []);
  },
};

function hm(dt) { return dt ? dt.slice(11, 16) : ""; }

function renderList(root, prenom, slots) {
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <h2 style="margin:0">Ma journée</h2>
      <button class="btn" id="add-btn" style="width:auto;min-height:40px;padding:0 14px">＋ Ajouter</button>
    </div>
    <p style="color:var(--muted);margin:.2rem 0 16px;font-size:.9rem">
      ${new Date().toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long" })}
    </p>`;

  const body = slots.length === 0
    ? `<div class="placeholder"><div class="big">☀️</div>Aucune intervention planifiée aujourd'hui.</div>`
    : `<div id="slot-list">${slots.map(slotCard).join("")}</div>`;

  root.innerHTML = header + body;
  root.querySelector("#add-btn").addEventListener("click", () => renderForm(root, prenom));
  const list = root.querySelector("#slot-list");
  if (list) list.addEventListener("click", (e) => {
    const card = e.target.closest("[data-slot]");
    if (card) renderDetail(root, prenom, Number(card.dataset.slot));
  });
}

function slotCard(s) {
  const done = s.state === "1_done";
  const color = done ? "var(--ok)" : "var(--aqua-dark)";
  const client = s.partner_id ? s.partner_id[1] : "";
  return `
    <div class="card" data-slot="${s.id}" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start">
      <div style="flex:0 0 auto;text-align:center;min-width:48px">
        <div style="font-weight:700;color:${color}">${hm(s.start_datetime)}</div>
        <div style="font-size:.72rem;color:var(--muted)">${hm(s.end_datetime)}</div>
      </div>
      <div style="flex:1;min-width:0">
        <strong>${escapeHtml(s.label)}</strong>
        ${client ? `<div style="color:var(--muted);font-size:.88rem;margin-top:2px">${escapeHtml(client)}</div>` : ""}
        ${done ? `<div style="font-size:.75rem;color:var(--ok);margin-top:4px">Terminé ✓</div>` : ""}
      </div>
      <span style="color:var(--muted);align-self:center">›</span>
    </div>`;
}

async function renderDetail(root, prenom, slotId) {
  root.innerHTML = `<button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <div class="placeholder">Chargement…</div>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));

  let s;
  try { s = await api(`/interventions/${slotId}`); }
  catch { root.querySelector(".placeholder").textContent = "Intervention introuvable."; return; }

  const pn = s.partner || {};
  const addr = [pn.street, pn.street2, [pn.zip, pn.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const tel = pn.phone || pn.mobile;
  const maps = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;

  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0">${escapeHtml(s.label)}</h2>
    <div class="card"><strong>Horaire</strong>
      <p style="color:var(--muted);margin:.3rem 0 0">${hm(s.start_datetime)} – ${hm(s.end_datetime)}</p></div>
    ${s.partner_id ? `<div class="card">
      <strong>${escapeHtml(pn.name || s.partner_id[1])}</strong>
      ${addr ? `<p style="color:var(--muted);margin:.4rem 0 0">${escapeHtml(addr)}</p>` : ""}
    </div>
    <div style="display:flex;gap:10px">
      ${tel ? `<a class="btn" href="tel:${escapeHtml(tel)}" style="text-decoration:none">📞 Appeler</a>` : ""}
      ${maps ? `<a class="btn secondary" href="${maps}" target="_blank" rel="noopener" style="text-decoration:none">🗺️ Itinéraire</a>` : ""}
    </div>` : ""}
    <button class="btn" id="do-report" style="margin-top:16px">📝 Faire le rapport</button>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));
  root.querySelector("#do-report").addEventListener("click", () =>
    renderReport(root, { id: slotId, label: s.label }, (msg) => {
      terrain.render(root);
      if (msg) toast(msg);
    }));
}

function renderForm(root, prenom) {
  const today = new Date().toISOString().slice(0, 10);
  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Annuler</button>
    <h2 style="margin-top:0">Nouvelle intervention</h2>
    <form id="iv-form">
      <p class="form-error" id="iv-error"></p>
      <div class="field"><label>Description</label>
        <input id="iv-name" type="text" placeholder="Ex. Mise en service, dépannage…" required /></div>
      <div class="field"><label>Client (optionnel)</label>
        <input id="iv-client" type="text" autocomplete="off" placeholder="Rechercher un client…" />
        <div id="iv-client-results"></div>
        <input type="hidden" id="iv-partner-id" /></div>
      <div class="field"><label>Date</label>
        <input id="iv-date" type="date" value="${today}" required /></div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Début</label><input id="iv-start" type="time" value="08:00" required /></div>
        <div class="field" style="flex:1"><label>Fin</label><input id="iv-end" type="time" value="09:00" required /></div>
      </div>
      <button class="btn" type="submit" id="iv-submit">Enregistrer l'intervention</button>
    </form>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));

  // Recherche client (debounce léger).
  const clientInput = root.querySelector("#iv-client");
  const results = root.querySelector("#iv-client-results");
  const partnerIdEl = root.querySelector("#iv-partner-id");
  let tmr = null;
  clientInput.addEventListener("input", () => {
    partnerIdEl.value = "";
    clearTimeout(tmr);
    const q = clientInput.value.trim();
    if (q.length < 2) { results.innerHTML = ""; return; }
    tmr = setTimeout(async () => {
      try {
        const list = await api(`/partners/search?q=${encodeURIComponent(q)}`);
        results.innerHTML = list.map(p =>
          `<div class="card" data-pid="${p.id}" style="cursor:pointer;padding:10px;margin:6px 0">
            <strong>${escapeHtml(p.name)}</strong>
            <span style="color:var(--muted);font-size:.8rem"> ${escapeHtml(p.city || "")}</span>
          </div>`).join("");
      } catch { results.innerHTML = ""; }
    }, 300);
  });
  results.addEventListener("click", (e) => {
    const c = e.target.closest("[data-pid]");
    if (!c) return;
    partnerIdEl.value = c.dataset.pid;
    clientInput.value = c.querySelector("strong").textContent;
    results.innerHTML = "";
  });

  const form = root.querySelector("#iv-form");
  const err = root.querySelector("#iv-error");
  const submit = root.querySelector("#iv-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const body = {
      name: root.querySelector("#iv-name").value.trim(),
      date: root.querySelector("#iv-date").value,
      start_time: root.querySelector("#iv-start").value,
      end_time: root.querySelector("#iv-end").value,
    };
    const pid = partnerIdEl.value;
    if (pid) body.partner_id = Number(pid);
    if (!body.name || !body.date) { err.textContent = "Description et date obligatoires."; return; }
    submit.disabled = true;
    submit.innerHTML = `<span class="spinner"></span>`;
    try {
      await api("/interventions", { method: "POST", body });
      terrain.render(root);
    } catch (e2) {
      submit.disabled = false;
      submit.textContent = "Enregistrer l'intervention";
      err.textContent = "Échec de l'enregistrement. Réessaie.";
    }
  });
}
