// Onglet SEMAINE — planning + calendrier équipe. Placeholder Sprint 0 (Sprint 4).
export const semaine = {
  id: "semaine",
  label: "Semaine",
  icon: "📅",
  render(root) {
    root.innerHTML = `
      <h2>Ma semaine</h2>
      <div class="placeholder">
        <div class="big">📅</div>
        Le planning de la semaine et le calendrier de l'équipe
        s'afficheront ici (Sprint 4).
      </div>`;
  },
};
