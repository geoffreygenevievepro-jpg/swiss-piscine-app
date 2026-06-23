// Onglet MOI — profil, soldes, congés, documents. Sprint 0 : profil + déconnexion.
import { profile } from "../store.js";

export const moi = {
  id: "moi",
  label: "Moi",
  icon: "👤",
  render(root, ctx) {
    const p = profile.get() || {};
    const odoo = p.odoo || {};
    root.innerHTML = `
      <h2>Mon profil</h2>
      <div class="card">
        <strong>${p.name || "—"}</strong>
        <p style="color:var(--muted);margin:.3rem 0 0">
          ${odoo.job_title || p.role || ""}<br>
          ${odoo.work_email || ""}<br>
          ${odoo.work_phone || ""}
        </p>
      </div>
      <div class="card">
        <strong>Bientôt ici</strong>
        <p style="color:var(--muted);margin:.4rem 0 0">
          Soldes (heures + vacances), demande de congé, fiches de salaire
          et certifications (Sprint 3).
        </p>
      </div>
      <button class="btn secondary" id="logout-btn">Se déconnecter</button>`;
    root.querySelector("#logout-btn").addEventListener("click", ctx.logout);
  },
};
