// Feuille « Chronomètre » (mobile) : gros bouton Entrer/Sortie + résumé hier /
// aujourd'hui + heures supplémentaires. Ouverte depuis la barre du bas.
import { api } from "../api.js";
import { icon } from "../icons.js";

function fmtH(h) {
  const sign = h < 0 ? "-" : "";
  const a = Math.abs(h || 0), hh = Math.floor(a), mm = Math.round((a - hh) * 60);
  return `${sign}${hh}h${String(mm).padStart(2, "0")}`;
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
  });
}

export async function renderChrono(body) {
  body.innerHTML = `<div class="placeholder">Chargement…</div>`;
  let status, overview, days;
  try {
    [status, overview, days] = await Promise.all([
      api("/attendance/status"),
      api("/attendance/overview"),
      api("/attendance/days?num=2"),
    ]);
  } catch {
    body.innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger le timbrage.</div>`;
    return;
  }

  const isIn = status.state === "in";
  const arr = days.days || [];
  const yWorked = arr.length >= 2 ? arr[0].worked : 0;
  const tWorked = arr.length ? arr[arr.length - 1].worked : 0;
  const d = overview.day || {}, mo = overview.month || {};
  const supToday = (d.overtime || 0) > 0 ? `+${fmtH(d.overtime)}` : "—";
  const supMonth = (mo.overtime || 0) > 0 ? `+${fmtH(mo.overtime)}` : "—";

  body.innerHTML = `
    <button class="btn chrono-btn ${isIn ? "out" : ""}" id="chrono-punch">${isIn ? icon("stop") : icon("play")} ${isIn ? "Sortie" : "Entrer"}</button>
    <p id="chrono-msg" style="text-align:center;color:var(--ok);min-height:1.1em;margin:10px 0 6px;font-size:.9rem"></p>
    <div style="display:flex;gap:12px">
      <div class="card" style="flex:1;text-align:center;margin-bottom:12px">
        <div class="eyebrow">Hier</div>
        <div class="tabular" style="font-family:var(--font-display);font-weight:700;font-size:1.5rem;margin-top:6px">${fmtH(yWorked)}</div>
      </div>
      <div class="card" style="flex:1;text-align:center;margin-bottom:12px;${isIn ? "border-color:var(--aqua)" : ""}">
        <div class="eyebrow">Aujourd'hui</div>
        <div class="tabular" style="font-family:var(--font-display);font-weight:700;font-size:1.5rem;margin-top:6px">${fmtH(tWorked)}</div>
        <div class="muted" style="font-size:.76rem">/ ${fmtH(d.due || 0)} dû</div>
      </div>
    </div>
    <div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <span class="muted">Heures sup</span>
      <span style="display:flex;gap:16px">
        <span><span class="muted" style="font-size:.74rem">Auj. </span><b style="color:var(--ok)">${supToday}</b></span>
        <span><span class="muted" style="font-size:.74rem">Mois </span><b style="color:var(--ok)">${supMonth}</b></span>
      </span>
    </div>`;

  const btn = body.querySelector("#chrono-punch"), msg = body.querySelector("#chrono-msg");
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> localisation…`;
    const pos = await getPosition();
    try {
      await api(isIn ? "/attendance/check-out" : "/attendance/check-in", { method: "POST", body: pos || {} });
      renderChrono(body);
    } catch {
      btn.disabled = false; btn.innerHTML = `${isIn ? icon("stop") : icon("play")} ${isIn ? "Sortie" : "Entrer"}`;
      msg.style.color = "var(--danger)"; msg.textContent = "Échec du pointage. Réessaie.";
    }
  });
}
