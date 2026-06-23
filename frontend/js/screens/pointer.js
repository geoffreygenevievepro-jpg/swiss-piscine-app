// Onglet POINTER — timbrage. Placeholder Sprint 0 (hr.attendance au Sprint 1).
export const pointer = {
  id: "pointer",
  label: "Pointer",
  icon: "⏱️",
  render(root) {
    root.innerHTML = `
      <h2>Pointer</h2>
      <div class="placeholder">
        <div class="big">⏱️</div>
        Le bouton de pointage entrée/sortie arrive au Sprint 1.
      </div>
      <button class="btn" disabled>Commencer ma journée</button>`;
  },
};
