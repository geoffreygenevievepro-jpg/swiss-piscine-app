// Onglet TERRAIN — « Ma journée » : interventions du jour + détail client.
import { api } from "../api.js";
import { profile } from "../store.js";
import { deadlineStatus, fmtDate, escapeHtml } from "../util.js";

export const terrain = {
  id: "terrain",
  label: "Terrain",
  icon: "🧰",

  async render(root) {
    const p = profile.get();
    const prenom = p?.name?.split(" ").slice(-1)[0] || "";
    root.innerHTML = `
      <h2>Bonjour ${escapeHtml(prenom)} 👋</h2>
      <div class="placeholder"><div class="big">📋</div>Chargement de tes interventions…</div>`;

    let data;
    try {
      data = await api("/tasks/today");
    } catch {
      root.querySelector(".placeholder").innerHTML =
        `<div class="big">⚠️</div>Impossible de charger les interventions.`;
      return;
    }
    renderList(root, prenom, data);
  },
};

function renderList(root, prenom, data) {
  if (!data.user_linked) {
    root.innerHTML = `
      <h2>Bonjour ${escapeHtml(prenom)} 👋</h2>
      <div class="card">
        <strong>Compte non relié au planning</strong>
        <p style="color:var(--muted);margin:.4rem 0 0">
          Ton compte n'est pas encore associé à un utilisateur Odoo, donc tes
          interventions ne peuvent pas s'afficher. Préviens le bureau pour l'activer.
        </p>
      </div>`;
    return;
  }
  const tasks = data.tasks || [];
  if (tasks.length === 0) {
    root.innerHTML = `
      <h2>Bonjour ${escapeHtml(prenom)} 👋</h2>
      <div class="placeholder"><div class="big">✅</div>Aucune intervention assignée pour le moment.</div>`;
    return;
  }

  root.innerHTML = `
    <h2>Mes interventions</h2>
    <div id="task-list">${tasks.map(taskCard).join("")}</div>`;

  root.querySelector("#task-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-task]");
    if (card) renderDetail(root, prenom, Number(card.dataset.task));
  });
}

function taskCard(t) {
  const st = deadlineStatus(t.date_deadline);
  const client = t.partner_id ? t.partner_id[1] : "Sans client";
  return `
    <div class="card" data-task="${t.id}" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start">
      <span style="width:10px;height:10px;border-radius:50%;background:${st.color};margin-top:6px;flex:0 0 auto"></span>
      <div style="flex:1;min-width:0">
        <strong>${escapeHtml(t.name)}</strong>
        <div style="color:var(--muted);font-size:.88rem;margin-top:2px">${escapeHtml(client)}</div>
        <div style="font-size:.8rem;color:${st.color};margin-top:4px">${st.label}${t.date_deadline ? " · " + fmtDate(t.date_deadline) : ""}</div>
      </div>
      <span style="color:var(--muted);align-self:center">›</span>
    </div>`;
}

async function renderDetail(root, prenom, taskId) {
  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <div class="placeholder">Chargement…</div>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));

  let t;
  try {
    t = await api(`/tasks/${taskId}`);
  } catch {
    root.querySelector(".placeholder").textContent = "Intervention introuvable.";
    return;
  }

  const pn = t.partner || {};
  const addrParts = [pn.street, pn.street2, [pn.zip, pn.city].filter(Boolean).join(" ")].filter(Boolean);
  const addr = addrParts.join(", ");
  const tel = pn.phone || pn.mobile;
  const mapsHref = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;

  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0">${escapeHtml(t.name)}</h2>
    <div class="card">
      <strong>${escapeHtml(pn.name || (t.partner_id ? t.partner_id[1] : "Sans client"))}</strong>
      ${addr ? `<p style="color:var(--muted);margin:.4rem 0 0">${escapeHtml(addr)}</p>` : ""}
    </div>
    <div style="display:flex;gap:10px">
      ${tel ? `<a class="btn" href="tel:${escapeHtml(tel)}" style="text-decoration:none">📞 Appeler</a>` : ""}
      ${mapsHref ? `<a class="btn secondary" href="${mapsHref}" target="_blank" rel="noopener" style="text-decoration:none">🗺️ Itinéraire</a>` : ""}
    </div>
    ${t.date_deadline ? `<div class="card" style="margin-top:14px"><strong>Échéance</strong><p style="color:var(--muted);margin:.3rem 0 0">${fmtDate(t.date_deadline)}</p></div>` : ""}
    ${t.description ? `<div class="card"><strong>Détails</strong><div style="color:var(--muted);margin:.4rem 0 0">${t.description}</div></div>` : ""}
    <div class="card" style="text-align:center;color:var(--muted)">
      Le rapport d'intervention (photos, signature) arrive au Sprint 2.
    </div>`;
  root.querySelector("#back").addEventListener("click", () => terrain.render(root));
}
