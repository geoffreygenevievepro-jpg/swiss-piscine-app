// Onglet POINTER — bouton de timbrage contextuel (Tipee-like).
// Un seul gros bouton qui affiche Entrée OU Sortie selon l'état réel côté Odoo.
import { api } from "../api.js";
import { fmtDuration, fmtClock } from "../util.js";

let timer = null;

function clearTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

export const pointer = {
  id: "pointer",
  label: "Pointer",
  icon: "⏱️",

  async render(root) {
    clearTimer();
    root.innerHTML = `<h2>Pointer</h2><div class="placeholder"><div class="big">⏱️</div>Chargement…</div>`;
    let status;
    try {
      status = await api("/attendance/status");
    } catch {
      root.innerHTML = `<h2>Pointer</h2>
        <div class="card" style="border-color:var(--danger)">
          Impossible de joindre le serveur. Vérifie ta connexion et réessaie.
        </div>`;
      return;
    }
    draw(root, status);
  },
};

function draw(root, status) {
  clearTimer();
  const isIn = status.state === "in";
  const openStart = isIn ? new Date(status.open_since).getTime() : null;
  const baseToday = status.today_seconds;
  const t0 = Date.now();

  root.innerHTML = `
    <h2>Pointer</h2>
    <div class="card" style="text-align:center;${isIn ? "border-color:var(--aqua)" : ""}">
      <div style="color:var(--muted);font-size:.85rem">${isIn ? "Session en cours depuis" : "Tu n'es pas pointé"}</div>
      <div id="elapsed" style="font-size:2.4rem;font-weight:700;margin:.2rem 0;color:var(--ink)">
        ${isIn ? fmtClock(elapsedSince(openStart)) : "—"}
      </div>
      <div style="color:var(--muted);font-size:.9rem">
        Total aujourd'hui : <strong id="today-total">${fmtDuration(baseToday)}</strong>
      </div>
    </div>
    <button class="btn" id="punch" style="${isIn ? "background:var(--danger)" : ""}">
      ${isIn ? "⏹️ Pointer la sortie" : "▶️ Commencer ma journée"}
    </button>
    <p id="punch-msg" class="form-error" style="text-align:center;color:var(--ok);margin-top:14px"></p>`;

  // Timer live (seconde par seconde) quand on est pointé.
  if (isIn) {
    timer = setInterval(() => {
      const elapsedEl = root.querySelector("#elapsed");
      const totalEl = root.querySelector("#today-total");
      if (!elapsedEl) return clearTimer();
      const extra = Math.floor((Date.now() - t0) / 1000);
      elapsedEl.textContent = fmtClock(elapsedSince(openStart));
      totalEl.textContent = fmtDuration(baseToday + extra);
    }, 1000);
  }

  const btn = root.querySelector("#punch");
  const msg = root.querySelector("#punch-msg");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const next = await api(isIn ? "/attendance/check-out" : "/attendance/check-in", { method: "POST" });
      draw(root, next);
      const m = root.querySelector("#punch-msg");
      if (m) m.textContent = isIn ? "Sortie enregistrée ✓" : "Entrée enregistrée ✓";
    } catch (e) {
      btn.disabled = false;
      btn.textContent = isIn ? "⏹️ Pointer la sortie" : "▶️ Commencer ma journée";
      msg.style.color = "var(--danger)";
      msg.textContent = "Échec du pointage. Réessaie.";
    }
  });
}

function elapsedSince(startMs) {
  return Math.floor((Date.now() - startMs) / 1000);
}
