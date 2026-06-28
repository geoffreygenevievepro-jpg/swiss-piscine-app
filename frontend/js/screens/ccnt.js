// Section « Ma CCNT » de l'onglet Présence — HHC uniquement.
// Heures timbrées (total + par mois) + calendrier des types de jour. Données : /attendance/ccnt.
import { api } from "../api.js";

const MN = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MI = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const f1 = (v) => v == null ? "—" : Number(v).toLocaleString("fr-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function injectStyle() {
  if (document.getElementById("ccnt-style")) return;
  const s = document.createElement("style");
  s.id = "ccnt-style";
  s.textContent = `
   .ccnt-hero{border-radius:14px;padding:16px;color:#fff;background:linear-gradient(150deg,var(--aqua),var(--aqua-dark));margin-bottom:12px}
   .ccnt-hero .eb{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;opacity:.85}
   .ccnt-hero .big{font-size:2.2rem;font-weight:800;line-height:1.1}.ccnt-hero .big span{font-size:1rem;opacity:.8}
   .ccnt-hero .sub{font-size:.82rem;opacity:.92}
   .ccnt-mbars{display:flex;gap:4px;align-items:flex-end;height:84px;padding-top:4px}
   .ccnt-mb{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:100%}
   .ccnt-mb .bv{font-size:.5rem;color:var(--muted);font-weight:700;height:9px}
   .ccnt-mb .b{width:100%;max-width:15px;background:linear-gradient(180deg,var(--aqua),var(--aqua-dark));border-radius:3px}
   .ccnt-mb .ml{font-size:.52rem;color:var(--muted);font-weight:600}
   .ccnt-stats{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin:12px 0}
   .ccnt-stats .s{background:var(--white);border:1px solid var(--line);border-radius:11px;padding:9px;text-align:center}
   .ccnt-stats .s b{display:block;font-size:1.1rem;color:var(--navy);font-family:var(--font-display)}
   .ccnt-stats .s span{font-size:.62rem;color:var(--muted)}
   .ccnt-months{display:flex;gap:4px;overflow-x:auto;padding-bottom:8px;margin-bottom:8px}
   .ccnt-months button{flex:0 0 auto;border:1px solid var(--line);background:#fff;color:var(--muted);font-size:.7rem;padding:5px 9px;border-radius:8px;cursor:pointer}
   .ccnt-months button.on{background:var(--aqua-dark);color:#fff;border-color:var(--aqua-dark)}
   .ccnt-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
   .ccnt-cw{text-align:center;font-size:.58rem;color:var(--muted);font-weight:700}
   .ccnt-dz{aspect-ratio:1;border-radius:8px;background:#f3f6f6;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:.6rem;color:var(--muted)}
   .ccnt-dz b{font-size:.7rem;font-weight:600;color:var(--ink)}.ccnt-dz i{font-size:.5rem;font-weight:700;font-style:normal}
   .ccnt-dz.work{background:var(--aqua-dark);color:#fff}.ccnt-dz.work b{color:#fff}.ccnt-dz.work i{color:#bfe7ec}
   .ccnt-dz.ferie{background:#e7b13a}.ccnt-dz.ferie b{color:#3a2c08}
   .ccnt-dz.vac{background:#3d7fc4;color:#fff}.ccnt-dz.vac b{color:#fff}
   .ccnt-dz.mal{background:var(--danger);color:#fff}.ccnt-dz.mal b{color:#fff}
   .ccnt-dz.acc{background:#e0814a;color:#fff}.ccnt-dz.acc b{color:#fff}
   .ccnt-dz.mat{background:#b06ec0;color:#fff}.ccnt-dz.mat b{color:#fff}
   .ccnt-dz.mil{background:#6b7b9c;color:#fff}.ccnt-dz.mil b{color:#fff}
   .ccnt-dz.conge{background:#9aa7ab;color:#fff}.ccnt-dz.conge b{color:#fff}
   .ccnt-leg{display:flex;flex-wrap:wrap;gap:7px 11px;margin-top:11px;font-size:.66rem;color:var(--muted)}
   .ccnt-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:middle}`;
  document.head.appendChild(s);
}

const LEG = [["work", "Travaillé", "var(--aqua-dark)"], ["ferie", "Férié", "#e7b13a"],
  ["vac", "Vacances", "#3d7fc4"], ["mal", "Maladie", "var(--danger)"], ["acc", "Accident", "#e0814a"]];

function calMonth(year, mo, byDay) {
  const first = new Date(year, mo - 1, 1);
  const wd = (first.getDay() + 6) % 7;           // lundi = 0
  const dim = new Date(year, mo, 0).getDate();
  let cells = ["L", "M", "M", "J", "V", "S", "D"].map((c) => `<div class="ccnt-cw">${c}</div>`).join("");
  for (let i = 0; i < wd; i++) cells += `<div class="ccnt-dz" style="background:transparent"></div>`;
  for (let d = 1; d <= dim; d++) {
    const iso = `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const info = byDay[iso];
    const cl = info ? info.type : "";
    const lab = (info && info.type === "work" && info.hours) ? `<i>${f1(info.hours)}</i>` : "";
    cells += `<div class="ccnt-dz ${cl}"><b>${d}</b>${lab}</div>`;
  }
  return `<div class="ccnt-cal">${cells}</div>`;
}

export async function renderCcnt(host) {
  injectStyle();
  let data;
  try { data = await api("/attendance/ccnt"); } catch { return; }
  if (!data || !data.enabled) { host.innerHTML = ""; return; }

  const byDay = {};
  (data.calendar || []).forEach((c) => { byDay[c.date] = c; });
  const count = (t) => (data.calendar || []).filter((c) => c.type === t).length;
  const maxH = Math.max(...(data.months || []).map((m) => m.hours || 0), 1);
  const bars = (data.months || []).map((m) => {
    const h = Math.round((m.hours || 0) / maxH * 64);
    return `<div class="ccnt-mb"><span class="bv">${m.hours > 0 ? Math.round(m.hours) : ""}</span><span class="b" style="height:${Math.max(h, 2)}px"></span><span class="ml">${MI[m.m - 1]}</span></div>`;
  }).join("");

  const curMonth = new Date().getMonth() + 1;
  const monthBtns = (data.months || []).map((m) =>
    `<button data-m="${m.m}" class="${m.m === curMonth ? "on" : ""}">${MN[m.m - 1]}</button>`).join("");

  host.innerHTML = `
    <div class="card">
      <div class="card-head"><div class="t"><b>Ma CCNT ${data.year}</b></div></div>
      <div class="ccnt-hero">
        <span class="eb">Heures timbrées ${data.year}</span>
        <div class="big">${f1(data.worked_total)} <span>h</span></div>
        <div class="sub">${data.worked_days} jours travaillés${data.hourly ? " · payé à l'heure" : ""}</div>
      </div>
      <div class="ccnt-mbars">${bars}</div>
      <div class="ccnt-stats">
        <div class="s"><b>${data.worked_days}</b><span>Jours</span></div>
        <div class="s"><b>${count("vac")}</b><span>Vacances</span></div>
        <div class="s"><b>${count("mal")}</b><span>Maladie</span></div>
        <div class="s"><b>${count("ferie")}</b><span>Fériés</span></div>
      </div>
      <div style="font-size:.8rem;font-weight:700;color:var(--navy);margin:6px 0 8px">📆 Mon calendrier</div>
      <div class="ccnt-months">${monthBtns}</div>
      <div id="ccnt-calwrap">${calMonth(data.year, curMonth, byDay)}</div>
      <div class="ccnt-leg">${LEG.map(([, lab, col]) => `<span><i style="background:${col}"></i>${lab}</span>`).join("")}</div>
    </div>`;

  const wrap = host.querySelector("#ccnt-calwrap");
  host.querySelectorAll(".ccnt-months button").forEach((b) => b.addEventListener("click", () => {
    host.querySelectorAll(".ccnt-months button").forEach((x) => x.classList.toggle("on", x === b));
    wrap.innerHTML = calMonth(data.year, Number(b.dataset.m), byDay);
  }));
}
