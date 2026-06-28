// Applique le thème de la société (couleur d'accent) via les variables CSS.
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : null;
}
export function applyTheme(company) {
  const color = company && company.color;
  const r = document.documentElement;
  if (!color) { // repli : thème par défaut (ne rien forcer)
    r.style.removeProperty("--aqua-dark"); r.style.removeProperty("--aqua"); r.style.removeProperty("--aqua-soft");
    r.style.removeProperty("--navy");
    return;
  }
  r.style.setProperty("--aqua-dark", color);
  r.style.setProperty("--aqua", color);
  const rgb = hexToRgb(color);
  if (rgb) {
    r.style.setProperty("--aqua-soft", `rgba(${rgb[0]},${rgb[1]},${rgb[2]},.12)`);
    // Surfaces « fortes » (boutons, puces actives, titres) : nuance foncée de la
    // couleur société (≈ même obscurité que le navy par défaut) → la marque ressort.
    const d = rgb.map(c => Math.round(c * 0.52));
    r.style.setProperty("--navy", `rgb(${d[0]},${d[1]},${d[2]})`);
  }
}
