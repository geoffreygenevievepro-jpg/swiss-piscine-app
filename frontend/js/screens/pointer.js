// Onglet POINTER — timbrage contextuel + géoloc + pauses + détail des pointages.
import { api } from "../api.js";
import { fmtDuration, fmtClock, escapeHtml } from "../util.js";

let timer = null;
const clearTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
const DAY_START = 6, DAY_END = 20, SPAN = DAY_END - DAY_START;

// Position GPS ponctuelle (uniquement au moment du pointage). Jamais bloquant.
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
    );
  });
}

export const pointer = {
  id: "pointer",
  label: "Pointer",
  icon: "⏱️",

  async render(root) {
    clearTimer();
    root.innerHTML = `<h2>Pointer</h2><div class="placeholder"><div class="big">⏱️</div>Chargement…</div>`;
    let status, slots = [];
    try {
      status = await api("/attendance/status");
      try { slots = (await api("/interventions/today")).interventions || []; } catch {}
    } catch {
      root.innerHTML = `<h2>Pointer</h2><div class="card" style="border-color:var(--danger)">Impossible de joindre le serveur.</div>`;
      return;
    }
    draw(root, status, slots);
  },
};

function localHour(dt) {
  const d = new Date(dt.replace(" ", "T") + "Z");
  return d.getHours() + d.getMinutes() / 60;
}
function plannedSeconds(slots) {
  return slots.reduce((acc, s) => {
    const a = new Date(s.start_datetime.replace(" ", "T") + "Z");
    const b = new Date(s.end_datetime.replace(" ", "T") + "Z");
    return acc + Math.max(0, (b - a) / 1000);
  }, 0);
}
function timeline(slots) {
  if (!slots.length) return "";
  const bars = slots.map(s => {
    const a = Math.max(DAY_START, localHour(s.start_datetime));
    const b = Math.min(DAY_END, localHour(s.end_datetime));
    const left = ((a - DAY_START) / SPAN) * 100;
    const width = Math.max(3, ((b - a) / SPAN) * 100);
    return `<div title="${escapeHtml(s.label || "")}" style="position:absolute;left:${left}%;width:${width}%;top:0;bottom:0;background:var(--aqua);border-radius:6px;opacity:.85"></div>`;
  }).join("");
  return `
    <div style="font-size:.8rem;color:var(--muted);margin:2px 0 4px">Planifié</div>
    <div style="position:relative;height:26px;background:var(--aqua-soft);border-radius:6px;margin-bottom:4px">${bars}</div>
    <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--muted)">
      <span>${DAY_START}h</span><span>${Math.round((DAY_START + DAY_END) / 2)}h</span><span>${DAY_END}h</span>
    </div>`;
}
function segmentsCard(segments) {
  if (!segments || !segments.length) return "";
  const rows = segments.map(s =>
    `<div style="display:flex;justify-content:space-between;font-size:.88rem;padding:5px 0;border-top:1px solid var(--line)">
      <span>${s.in} → ${s.out || "<em style='color:var(--aqua-dark)'>en cours</em>"}</span></div>`).join("");
  return `<div class="card" style="margin-top:12px"><strong style="font-size:.92rem">Pointages du jour</strong>${rows}</div>`;
}

function draw(root, status, slots) {
  clearTimer();
  const isIn = status.state === "in";
  const openStart = isIn ? new Date(status.open_since).getTime() : null;
  const baseToday = status.today_seconds;
  const planned = plannedSeconds(slots);
  const t0 = Date.now();
  const dateStr = new Date().toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long" });
  const mainLabel = isIn ? "⏹️ Pointer la sortie" : (status.count > 0 ? "▶️ Reprendre" : "▶️ Commencer ma journée");

  const remainTile = planned > 0
    ? `<div class="card" style="flex:1;margin:0;text-align:center">
         <div style="font-size:1.3rem;font-weight:700" id="reste">${fmtDuration(Math.max(0, planned - baseToday))}</div>
         <div style="font-size:.78rem;color:var(--muted)">Reste à faire</div></div>`
    : "";

  root.innerHTML = `
    <h2 style="margin-bottom:2px">Pointer</h2>
    <p style="color:var(--muted);margin:0 0 14px;text-transform:capitalize">${dateStr}</p>
    ${timeline(slots)}
    <div style="display:flex;gap:10px;margin:12px 0">
      <div class="card" style="flex:1;margin:0;text-align:center;${isIn ? "border-color:var(--aqua)" : ""}">
        <div id="elapsed" style="font-size:1.3rem;font-weight:700">${isIn ? fmtClock(elapsed(openStart)) : "—"}</div>
        <div style="font-size:.78rem;color:var(--muted)">${isIn ? "En cours" : "En pause"}</div>
      </div>
      <div class="card" style="flex:1;margin:0;text-align:center">
        <div id="today-total" style="font-size:1.3rem;font-weight:700">${fmtDuration(baseToday)}</div>
        <div style="font-size:.78rem;color:var(--muted)">Réalisé</div>
      </div>
      ${remainTile}
    </div>
    <button class="btn" id="punch" style="${isIn ? "background:var(--danger)" : ""}">${mainLabel}</button>
    <p id="punch-msg" style="text-align:center;color:var(--ok);margin-top:12px;min-height:1.1em;font-size:.9rem"></p>
    ${segmentsCard(status.segments)}`;

  if (isIn) {
    timer = setInterval(() => {
      const el = root.querySelector("#elapsed");
      if (!el) return clearTimer();
      const total = baseToday + Math.floor((Date.now() - t0) / 1000);
      el.textContent = fmtClock(elapsed(openStart));
      root.querySelector("#today-total").textContent = fmtDuration(total);
      const reste = root.querySelector("#reste");
      if (reste) reste.textContent = fmtDuration(Math.max(0, planned - total));
    }, 1000);
  }

  const btn = root.querySelector("#punch");
  const msg = root.querySelector("#punch-msg");
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> localisation…`;
    const pos = await getPosition();
    try {
      const next = await api(isIn ? "/attendance/check-out" : "/attendance/check-in",
        { method: "POST", body: pos || {} });
      draw(root, next, slots);
      const m = root.querySelector("#punch-msg");
      if (m) m.textContent = (isIn ? "Sortie enregistrée ✓" : "Entrée enregistrée ✓") + (pos ? " 📍" : "");
    } catch {
      btn.disabled = false; btn.textContent = mainLabel;
      msg.style.color = "var(--danger)"; msg.textContent = "Échec du pointage. Réessaie.";
    }
  });
}

function elapsed(startMs) { return Math.floor((Date.now() - startMs) / 1000); }
