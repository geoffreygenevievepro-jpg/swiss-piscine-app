// Onglet « Présence » — timbrage + résumé heures (jour/semaine/mois,
// façon Tipee : demi-jauges + tableau). Les congés sont dans l'onglet « Mes congés ».
import { api } from "../api.js";
import { fmtClock, escapeHtml, toast } from "../util.js";
import { icon } from "../icons.js";
import { profile } from "../store.js";
import { renderCcnt } from "./ccnt.js";

let timer = null;
const clearTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
let period = "week", offset = 0;
let selectedDay = null;   // YYYY-MM-DD du jour sélectionné dans la bande (null = aujourd'hui)
let calOffset = 0;        // décalage du calendrier mensuel (0 = mois courant)

const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
const calMonthStr = (off) => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth() + off, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
  });
}
function fmtH(h) {
  const sign = h < 0 ? "-" : "";
  const a = Math.abs(h), hh = Math.floor(a), mm = Math.round((a - hh) * 60);
  return `${sign}${hh}h${String(mm).padStart(2, "0")}`;
}

export const pointer = {
  id: "pointer",
  label: "Présence",
  icon: "clock",
  async render(root) {
    clearTimer();
    root.innerHTML = `<h2>Présence</h2><div class="placeholder"><div class="big">${icon("clock")}</div>Chargement…</div>`;
    let status, summary, balances, today, days, overview, cal;
    try {
      [status, summary, balances, today, days, overview, cal] = await Promise.all([
        api("/attendance/status"),
        api(`/attendance/summary?period=${period}&offset=${offset}`),
        api("/rh/balances"),
        api(`/attendance/today${selectedDay ? `?date=${selectedDay}` : ""}`),
        api("/attendance/days?num=30"),
        api("/attendance/overview"),
        api(`/attendance/calendar?month=${calMonthStr(calOffset)}`).catch(() => null),
      ]);
    } catch {
      root.innerHTML = `<h2>Présence</h2><div class="card" style="border-color:var(--danger)">Impossible de joindre le serveur.</div>`;
      return;
    }
    draw(root, status, summary, balances, today, days, overview, cal);
    // Section « Ma CCNT » — HHC uniquement (le backend renvoie enabled:false ailleurs)
    const me = profile.get();
    if (me && me.company && me.company.id === 1) {
      const host = document.createElement("div");
      root.appendChild(host);
      renderCcnt(host);
    }
  },
};

function halfGauge(valueHtml, sublabel) {
  return `<div class="card" style="flex:1;margin:0;text-align:center;padding-bottom:14px">
    <svg viewBox="0 0 100 54" style="width:120px;max-width:100%;overflow:visible">
      <path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="var(--aqua-soft)" stroke-width="9" stroke-linecap="round"/>
      <path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="var(--aqua)" stroke-width="9" stroke-linecap="round" stroke-dasharray="138" stroke-dashoffset="34"/>
    </svg>
    <div style="font-size:1.45rem;font-weight:700;margin-top:-22px;font-family:var(--font-display)">${valueHtml}</div>
    <div style="font-size:.76rem;color:var(--muted);margin-top:4px">${escapeHtml(sublabel)}</div>
  </div>`;
}

function periodTitle(start) {
  const d = new Date(start + "T00:00:00");
  if (period === "day") return offset === 0 ? "Aujourd'hui" : d.toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long" });
  if (period === "month") return d.toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
  const end = new Date(d.getTime() + 6 * 86400000);
  return offset === 0 ? "Cette semaine"
    : `${d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })}`;
}

function summaryTable(buckets) {
  const todayIso = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; })();
  const rows = buckets.map(b => {
    const d = new Date(b.date + "T00:00:00");
    const isToday = b.date === todayIso;
    const soldeColor = b.solde < 0 ? "var(--danger)" : "var(--ok)";
    return `<tr style="${isToday ? "background:var(--aqua-soft)" : ""}">
      <td style="padding:7px 8px;white-space:nowrap">${d.toLocaleDateString("fr-CH", { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
      <td style="text-align:right;padding:7px 8px;font-weight:600">${fmtH(b.worked)}</td>
      <td style="text-align:right;padding:7px 8px;color:var(--muted)">${b.due ? fmtH(b.due) : "—"}</td>
      <td style="text-align:right;padding:7px 8px;color:${soldeColor};font-weight:600">${fmtH(b.solde)}</td>
    </tr>`;
  }).join("");
  const tw = buckets.reduce((s, b) => s + (b.worked || 0), 0);
  const td = buckets.reduce((s, b) => s + (b.due || 0), 0);
  const ts = buckets.reduce((s, b) => s + (b.solde || 0), 0);
  const tsCol = ts < 0 ? "var(--danger)" : "var(--ok)";
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.86rem">
    <thead><tr style="color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em">
      <th style="text-align:left;padding:4px 8px">Date</th><th style="text-align:right;padding:4px 8px">Réalisé</th>
      <th style="text-align:right;padding:4px 8px">À faire</th><th style="text-align:right;padding:4px 8px">Solde</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--line);font-weight:700">
      <td style="padding:8px">Total</td>
      <td style="text-align:right;padding:8px">${fmtH(tw)}</td>
      <td style="text-align:right;padding:8px;color:var(--muted)">${fmtH(td)}</td>
      <td style="text-align:right;padding:8px;color:${tsCol}">${fmtH(ts)}</td>
    </tr></tfoot></table></div>`;
}

// Bande horizontale défilable : un jour par cellule, avec les heures timbrées.
function dayStrip(days, selectedISO) {
  const list = Array.isArray(days) ? days : (days && days.days) || [];
  const sel = selectedISO || todayISO();
  const tISO = todayISO();
  const cells = list.map(d => {
    const dt = new Date(d.date + "T00:00:00");
    const wd = dt.toLocaleDateString("fr-CH", { weekday: "short" }).replace(".", "");
    const worked = d.worked ? fmtH(d.worked) : "·";
    const cls = `day-cell${d.date === sel ? " sel" : ""}${d.date === tISO ? " today" : ""}`;
    return `<button class="${cls}" data-day="${d.date}">
      <span class="wd">${wd}</span><span class="dn">${dt.getDate()}</span><span class="wh">${worked}</span>
    </button>`;
  }).join("");
  return `<div class="day-strip" id="day-strip">${cells}</div>`;
}

function gaugeHtml(label, x) {
  if (!x) return "";
  const solde = (x.worked || 0) - (x.due || 0);   // heures sup (+) ou déficit (−)
  const over = solde > 0.001, under = solde < -0.001;
  const L = 132;
  const off = (L * (1 - Math.min(100, x.pct) / 100)).toFixed(1);
  const col = under ? "var(--danger)" : (over ? "#2f8f63" : "#127d89");
  const soldeHtml = over ? ` · <span style="color:#2f8f63;font-weight:700">+${fmtH(solde)}</span>`
    : (under ? ` · <span style="color:var(--danger);font-weight:700">${fmtH(solde)}</span>` : "");
  return `<div class="halfg">
    <div class="halfg-label">${label}</div>
    <svg viewBox="0 0 100 58" class="halfg-svg">
      <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="var(--aqua-soft)" stroke-width="9" stroke-linecap="round"/>
      <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${off}"/>
      <text x="50" y="47" text-anchor="middle" class="halfg-pct" fill="${under ? "var(--danger)" : (over ? col : "#0c2b38")}">${x.pct}%</text>
    </svg>
    <div class="halfg-sub tabular">${fmtH(x.worked)} / ${fmtH(x.due)}${soldeHtml}</div>
  </div>`;
}

function monthCalendar(cal) {
  if (!cal || !Array.isArray(cal.days)) return "";
  const label = new Date(cal.year, cal.month - 1, 1).toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
  const firstWd = (new Date(cal.year, cal.month - 1, 1).getDay() + 6) % 7;  // Lun=0
  const tISO = todayISO();
  const bgOf = (t) => ({ vacances: "var(--ok-soft)", conge: "var(--violet-soft)", ferie: "var(--aqua-soft)", weekend: "var(--line-soft)" }[t] || "#fff");
  const fgOf = (t) => ({ vacances: "var(--ok)", conge: "var(--violet)", ferie: "var(--aqua-dark)", weekend: "var(--muted)" }[t] || "var(--ink)");
  const wdHead = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    .map(w => `<div style="text-align:center;font-size:.64rem;color:var(--muted);text-transform:uppercase">${w}</div>`).join("");
  const blanks = Array(firstWd).fill("<div></div>").join("");
  const cells = cal.days.map(d => {
    const dn = Number(d.date.slice(8, 10));
    const isToday = d.date === tISO;
    const h = d.worked > 0 ? fmtH(d.worked) : "";
    return `<div style="background:${bgOf(d.type)};color:${fgOf(d.type)};border-radius:8px;min-height:44px;padding:3px 1px;text-align:center;${isToday ? "outline:2px solid var(--aqua-dark);outline-offset:-2px" : "border:1px solid var(--line-soft)"}">
      <div style="font-size:.74rem;font-weight:700">${dn}</div>
      <div style="font-size:.64rem" class="tabular">${h}</div>
    </div>`;
  }).join("");
  const legend = [["Vacances", "vacances"], ["Congé / maladie", "conge"], ["Férié", "ferie"], ["Week-end", "weekend"]]
    .map(([l, t]) => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:.72rem;color:var(--muted)"><span style="width:12px;height:12px;border-radius:3px;background:${bgOf(t)};border:1px solid var(--line)"></span>${l}</span>`).join("");
  return `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <button class="btn secondary nav" id="cal-prev">‹</button>
      <strong style="font-family:var(--font-display);text-transform:capitalize">${label}</strong>
      <button class="btn secondary nav" id="cal-next">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px">${wdHead}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${blanks}${cells}</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:14px">${legend}</div>
  </div>`;
}

function draw(root, status, summary, balances, today, days, overview, cal) {
  clearTimer();
  const isIn = status.state === "in";
  const openStart = isIn ? new Date(status.open_since).getTime() : null;
  const baseToday = status.today_seconds, t0 = Date.now();
  const mainLabel = isIn ? "Sortie" : "Entrer";
  const vac = balances.leaves.find(l => l.unit === "day");

  root.innerHTML = `
    <h2 style="margin-bottom:10px">Présence</h2>

    <button class="btn" id="punch" style="${isIn ? "background:var(--danger)" : ""}">${mainLabel}</button>
    <div style="display:flex;gap:10px;margin:12px 0">
      <div class="card" style="flex:1;margin:0;text-align:center;${isIn ? "border-color:var(--aqua)" : ""}">
        <div id="elapsed" style="font-size:1.2rem;font-weight:700">${isIn ? fmtClock(Math.floor((Date.now() - openStart) / 1000)) : "—"}</div>
        <div style="font-size:.76rem;color:var(--muted)">${isIn ? "En cours" : "Au repos"}</div></div>
      <div class="card" style="flex:1;margin:0;text-align:center">
        <div id="today-total" style="font-size:1.2rem;font-weight:700">${fmtH(baseToday / 3600)}</div>
        <div style="font-size:.76rem;color:var(--muted)">Aujourd'hui</div></div>
    </div>
    <p id="punch-msg" style="text-align:center;color:var(--ok);margin:0 0 8px;min-height:1.1em;font-size:.9rem"></p>

    <div class="strip-month">${new Date(today.date + "T00:00:00").toLocaleDateString("fr-CH", { month: "long", year: "numeric" })}</div>
    ${dayStrip(days, today.date)}

    <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px">
      <button class="btn secondary nav" id="prev">‹</button>
      <strong style="font-family:var(--font-display);text-transform:capitalize">${periodTitle(summary.start)}</strong>
      <button class="btn secondary nav" id="next">›</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      ${["day", "week", "month"].map(p => `<button class="chip ${p === period ? "active" : ""}" data-period="${p}" style="flex:1">${{ day: "Jour", week: "Semaine", month: "Mois" }[p]}</button>`).join("")}
    </div>

    ${overview ? `<div class="gauges" style="margin:6px 0 14px">${gaugeHtml("Aujourd'hui", overview.day)}${gaugeHtml("Ce mois", overview.month)}${gaugeHtml("Cette année", overview.year)}</div>` : ""}

    <div class="card">
      <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:8px">
        <span style="color:var(--muted)">Réalisé <strong style="color:var(--ink)">${fmtH(summary.worked_total)}</strong></span>
        <span style="color:var(--muted)">À faire <strong style="color:var(--ink)">${fmtH(summary.due_total)}</strong></span>
      </div>
      ${summaryTable(summary.buckets)}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${today.date === todayISO()
          ? "Pointages d'aujourd'hui"
          : "Pointages du " + new Date(today.date + "T00:00:00").toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long" })}</strong>
        <button class="btn" id="add-att" style="width:auto;min-height:38px;padding:0 14px">${icon("plus", "icon-sm")} Saisie</button>
      </div>
      <div id="att-list" style="margin-top:10px">${attList(today)}</div>
    </div>

    ${monthCalendar(cal)}`;

  // Timbrage
  if (isIn) {
    timer = setInterval(() => {
      const el = root.querySelector("#elapsed");
      if (!el) return clearTimer();
      el.textContent = fmtClock(Math.floor((Date.now() - openStart) / 1000));
      root.querySelector("#today-total").textContent = fmtH((baseToday + Math.floor((Date.now() - t0) / 1000)) / 3600);
    }, 1000);
  }
  const btn = root.querySelector("#punch"), msg = root.querySelector("#punch-msg");
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> localisation…`;
    const pos = await getPosition();
    try {
      await api(isIn ? "/attendance/check-out" : "/attendance/check-in", { method: "POST", body: pos || {} });
      selectedDay = null;
      pointer.render(root);
    } catch {
      btn.disabled = false; btn.textContent = mainLabel;
      msg.style.color = "var(--danger)"; msg.textContent = "Échec du pointage. Réessaie.";
    }
  });

  // Période
  root.querySelector("#prev").addEventListener("click", () => { offset -= 1; pointer.render(root); });
  root.querySelector("#next").addEventListener("click", () => { offset += 1; pointer.render(root); });

  // Calendrier mensuel : navigation mois précédent / suivant
  const cp = root.querySelector("#cal-prev"), cn = root.querySelector("#cal-next");
  if (cp) cp.addEventListener("click", () => { calOffset -= 1; pointer.render(root); });
  if (cn) cn.addEventListener("click", () => { calOffset += 1; pointer.render(root); });
  root.querySelectorAll("[data-period]").forEach(b =>
    b.addEventListener("click", () => { period = b.dataset.period; offset = 0; pointer.render(root); }));

  // Bande calendrier : sélection d'un jour → recharge le détail des pointages de ce jour.
  const strip = root.querySelector("#day-strip");
  if (strip) {
    strip.addEventListener("click", (e) => {
      const c = e.target.closest("[data-day]");
      if (!c) return;
      selectedDay = c.dataset.day === todayISO() ? null : c.dataset.day;
      pointer.render(root);
    });
    // Le libellé du mois suit les jours réellement affichés (cellule la plus à gauche).
    const monthEl = root.querySelector(".strip-month");
    const updateMonth = () => {
      if (!monthEl) return;
      const sLeft = strip.getBoundingClientRect().left;
      let best = null, bestDist = Infinity;
      strip.querySelectorAll("[data-day]").forEach(c => {
        const dist = Math.abs(c.getBoundingClientRect().left - sLeft);
        if (dist < bestDist) { bestDist = dist; best = c; }
      });
      if (best) monthEl.textContent = new Date(best.dataset.day + "T00:00:00")
        .toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
    };
    let mTmr = null;
    strip.addEventListener("scroll", () => { clearTimeout(mTmr); mTmr = setTimeout(updateMonth, 60); });
    const selCell = strip.querySelector(".day-cell.sel");
    if (selCell) selCell.scrollIntoView({ inline: "center", block: "nearest" });
    updateMonth();
  }

  // Pointages du jour : saisie / édition / suppression
  root.querySelector("#add-att").addEventListener("click", () => renderManualForm(root, today.date));
  root.querySelector("#att-list").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { const a = today.attendances.find(x => x.id === Number(ed.dataset.edit)); renderManualForm(root, today.date, a); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      if (!confirm("Supprimer ce pointage ?")) return;
      try { await api(`/attendance/${del.dataset.del}`, { method: "DELETE" }); toast("Pointage supprimé"); pointer.render(root); }
      catch (e2) { toast(e2 && e2.message ? e2.message : "Suppression impossible"); }
    }
  });
}

function attList(today) {
  if (!today.attendances.length) return `<p style="color:var(--muted);margin:0">Aucun pointage aujourd'hui.</p>`;
  return today.attendances.map(a => `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line)">
      <div style="flex:1;min-width:0">
        <strong>${a.in} → ${a.out || "…"}</strong>
        <span style="color:var(--muted);font-size:.82rem"> · ${fmtH(a.worked)}</span>
        ${a.open ? `<span style="color:var(--aqua-dark);font-size:.74rem"> · en cours</span>` : ""}
      </div>
      ${a.editable && !a.open ? `
        <button data-edit="${a.id}" aria-label="Modifier" style="border:0;background:none;cursor:pointer;color:var(--muted);display:flex">${icon("pen", "icon-sm")}</button>
        <button data-del="${a.id}" aria-label="Supprimer" style="border:0;background:none;cursor:pointer;color:var(--muted);display:flex">${icon("trash", "icon-sm")}</button>` : ""}
    </div>`).join("");
}

async function renderManualForm(root, date, att) {
  const back = () => pointer.render(root);
  const n = new Date();
  const todayIso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  const d = date || todayIso;
  const ci = att ? att.in : "08:00";
  const co = att ? att.out : "12:00";
  root.innerHTML = `
    <button class="btn secondary" id="back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Retour</button>
    <h2 style="margin-top:0">${att ? "Modifier le pointage" : "Saisie manuelle"}</h2>
    <form id="att-form">
      <p class="form-error" id="att-error"></p>
      <div class="field"><label>Date</label><input id="a-date" type="date" value="${d}" required style="cursor:pointer"></div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Du</label><input id="a-in" type="time" value="${ci}" required></div>
        <div class="field" style="flex:1"><label>Au</label><input id="a-out" type="time" value="${co}" required></div>
      </div>
      <button class="btn" type="submit" id="a-submit">${att ? "Enregistrer" : "Ajouter le pointage"}</button>
    </form>`;
  root.querySelector("#back").addEventListener("click", back);
  // Ouvre directement le calendrier au clic / focus sur le champ Date (date du jour par défaut).
  const dateInput = root.querySelector("#a-date");
  const openPicker = () => { if (typeof dateInput.showPicker === "function") { try { dateInput.showPicker(); } catch {} } };
  dateInput.addEventListener("click", openPicker);
  dateInput.addEventListener("focus", openPicker);
  const form = root.querySelector("#att-form"), err = root.querySelector("#att-error"), submit = root.querySelector("#a-submit");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    const body = { date: form.querySelector("#a-date").value, check_in: form.querySelector("#a-in").value, check_out: form.querySelector("#a-out").value };
    if (!body.date || !body.check_in || !body.check_out) { err.textContent = "Date et heures obligatoires."; return; }
    if (body.check_out <= body.check_in) { err.textContent = "L'heure de fin doit être après le début."; return; }
    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try {
      if (att) await api(`/attendance/${att.id}`, { method: "PATCH", body });
      else await api("/attendance/manual", { method: "POST", body });
      back(); toast(att ? "Pointage modifié" : "Pointage ajouté");
    } catch (e2) {
      submit.disabled = false; submit.textContent = att ? "Enregistrer" : "Ajouter le pointage";
      err.textContent = e2 && e2.message ? e2.message : "Échec.";
    }
  });
}
