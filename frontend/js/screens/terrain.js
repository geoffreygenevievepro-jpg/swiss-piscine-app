// Onglet TERRAIN — « Ma journée ». Placeholder Sprint 0 (rempli au Sprint 1).
import { profile } from "../store.js";

export const terrain = {
  id: "terrain",
  label: "Terrain",
  icon: "🧰",
  render(root) {
    const p = profile.get();
    const prenom = p?.name?.split(" ").slice(-1)[0] || "";
    root.innerHTML = `
      <h2>Bonjour ${prenom} 👋</h2>
      <div class="card">
        <strong>Ma journée</strong>
        <p style="color:var(--muted);margin:.4rem 0 0">
          Tes interventions du jour s'afficheront ici (Sprint 1) :
          chantier, client, adresse, et le bouton Démarrer → Terminer.
        </p>
      </div>
      <div class="placeholder">
        <div class="big">📋</div>
        Aucune intervention chargée pour l'instant.
      </div>`;
  },
};
