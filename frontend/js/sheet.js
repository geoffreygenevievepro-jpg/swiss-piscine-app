// Feuille mobile (bottom sheet) : se lève depuis le bas, se redescend au doigt.
export function openSheet({ title = "", bodyHTML = "", onMount } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle" aria-hidden="true"><span></span></div>
      ${title ? `<div class="sheet-head"><h3>${title}</h3></div>` : ""}
      <div class="sheet-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  const sheet = overlay.querySelector(".sheet");
  const handle = overlay.querySelector(".sheet-handle");
  const bodyEl = overlay.querySelector(".sheet-body");
  bodyEl.innerHTML = bodyHTML;

  // Animation d'entrée.
  requestAnimationFrame(() => overlay.classList.add("open"));

  let startY = null, dy = 0;
  const onMove = (e) => {
    if (startY == null) return;
    dy = Math.max(0, (e.touches ? e.touches[0] : e).clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    if (startY == null) return;
    sheet.style.transition = "";
    if (dy > 110) close(); else sheet.style.transform = "";
    startY = null; dy = 0;
  };
  const close = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    overlay.classList.remove("open");
    sheet.style.transform = "";
    setTimeout(() => overlay.remove(), 300);
  };
  const onDown = (e) => { startY = (e.touches ? e.touches[0] : e).clientY; dy = 0; sheet.style.transition = "none"; };

  handle.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  if (onMount) onMount(bodyEl, close);
  return close;
}
