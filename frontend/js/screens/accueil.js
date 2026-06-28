// Onglet « Accueil » — tableau de bord : météo, raccourcis, résumé heures (jauges),
// planning, absences, équipe, note + pense-bête. Icônes au trait, zéro émoji.
import { api } from "../api.js";
import { profile } from "../store.js";
import { escapeHtml, toast } from "../util.js";
import { icon, weatherIcon, weatherLabel } from "../icons.js";
import { openSheet } from "../sheet.js";
import { renderChrono } from "./chrono.js";
import { messageBanner } from "../banner.js";

const JOURS_C = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

let storeKey = "anon";

function fmtH(h) {
  const sign = h < 0 ? "-" : "";
  const a = Math.abs(h), hh = Math.floor(a), mm = Math.round((a - hh) * 60);
  return `${sign}${hh}h${String(mm).padStart(2, "0")}`;
}
const hm = (dt) => (dt ? dt.slice(11, 16) : "");
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
  });
}

function typeColor(label) {
  const t = (label || "").toLowerCase();
  if (t.includes("entretien")) return "var(--ok)";
  if (t.includes("sav")) return "var(--warn)";
  if (t.includes("dépann") || t.includes("depann") || t.includes("hivernage")) return "var(--violet)";
  return "var(--aqua-dark)";
}

export const accueil = {
  id: "accueil",
  label: "Accueil",
  icon: "home",
  async render(root, ctx) {
    const nav = (ctx && ctx.navigate) || (() => {});
    const me = profile.get();
    // Prénom = champ structuré Odoo (fiable) ; repli sur le dernier mot du nom si absent.
    const prenom = me && me.first_name ? me.first_name.split(" ")[0]
      : (me && me.name ? me.name.split(" ").slice(-1)[0] : "");
    storeKey = (me && me.name) ? me.name.replace(/\s+/g, "_") : "anon";
    root.innerHTML = `
      <h2 style="margin:4px 0 18px">Salut${prenom ? " " + escapeHtml(prenom) : ""}</h2>
      <div id="dash"><div class="placeholder"><div class="big">${icon("home")}</div>Chargement…</div></div>`;
    const dash = root.querySelector("#dash");
    let overview, balances, planning, leaves, team, holidays, status, ann, bdays;
    try {
      [overview, balances, planning, leaves, team, holidays, status, ann, bdays] = await Promise.all([
        api("/attendance/overview"),
        api("/rh/balances"),
        api("/week/upcoming?days=5"),
        api("/rh/leaves"),
        api("/week/team?offset=0"),
        api("/week/holidays").catch(() => []),
        api("/attendance/status").catch(() => ({ state: "out" })),
        api("/announcement").catch(() => ({})),
        api("/birthdays/today").catch(() => []),
      ]);
    } catch {
      dash.innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger le tableau de bord.</div>`;
      return;
    }
    dash.innerHTML =
      birthdayBanner(bdays) +
      messageBanner(ann, false) +
      meteoCard() +
      quickActions(status) +
      resumeCard(overview, balances) +
      planningCard(planning) +
      teamCard(team) +
      leavesCard(leaves) +
      holidaysCard(holidays) +
      noteCards() +
      todoCard();
    wire(dash, nav);
    loadMeteo(dash);
  },
};

function cardHead(title, ic) {
  return `<div class="card-head"><div class="t">${ic ? icon(ic) : ""}<h3>${title}</h3></div>${icon("chevR", "chev")}</div>`;
}

// --- Bandeau anniversaire ----------------------------------------------------
function birthdayBanner(list) {
  if (!Array.isArray(list) || !list.length) return "";
  const me = list.find(b => b.is_me);
  const others = list.filter(b => !b.is_me);
  const lines = [];
  if (me) lines.push(`<div class="bday-line"><strong>Joyeux anniversaire ${escapeHtml(me.first_name)} !</strong></div>`);
  others.forEach(o => lines.push(`<div class="bday-line">Aujourd'hui, <strong>${escapeHtml(o.first_name)}</strong> fête son anniversaire</div>`));
  return `<div class="card bday-card">
    <span class="bday-ic">${icon("gift")}</span>
    <div class="bday-body">${lines.join("")}</div>
  </div>`;
}

// --- Météo colorée -----------------------------------------------------------
function meteoCard() {
  return `<div class="card weather-card">
    <div class="card-head"><div class="t">${icon("cloud")}<h3>Météo</h3></div><span class="muted" style="font-size:.8rem">Fribourg</span></div>
    <div class="wx-now" id="meteo-body"><span class="muted">Chargement…</span></div>
    <div class="wx-fore" id="meteo-fore"></div>
  </div>`;
}

async function loadMeteo(dash) {
  const body = dash.querySelector("#meteo-body");
  const fore = dash.querySelector("#meteo-fore");
  if (!body) return;
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=46.80&longitude=7.16&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FZurich&forecast_days=1");
    const d = await r.json();
    const code = d.current.weather_code;
    const t = Math.round(d.current.temperature_2m);
    const mx = Math.round(d.daily.temperature_2m_max[0]);
    const mn = Math.round(d.daily.temperature_2m_min[0]);
    body.innerHTML = `${icon(weatherIcon(code))}
      <div><div class="temp tabular">${t}°</div><div class="muted" style="font-size:.86rem">${weatherLabel(code)} · max ${mx}° / min ${mn}°</div></div>`;
    if (fore) {
      const times = d.hourly.time, temps = d.hourly.temperature_2m, codes = d.hourly.weather_code;
      const nowH = new Date().getHours();
      let idx = times.findIndex(ts => new Date(ts).getHours() === nowH);
      if (idx < 0) idx = 0;
      const picks = [3, 6, 9, 12].map(o => idx + o).filter(i => i < times.length);
      fore.innerHTML = picks.map(i => {
        const h = new Date(times[i]).getHours();
        return `<div class="h"><small>${h} h</small>${icon(weatherIcon(codes[i]))}<b class="tabular">${Math.round(temps[i])}°</b></div>`;
      }).join("");
    }
  } catch {
    body.innerHTML = `<span class="muted">Météo indisponible.</span>`;
  }
}

// --- Actions rapides ---------------------------------------------------------
function quickActions(status) {
  const tile = (act, ic, bg, label) => `<button class="qa dash-act" data-act="${act}"><span class="qbadge ${bg}">${icon(ic)}</span><b>${label}</b></button>`;
  return `<div class="card">
    <div class="eyebrow">Actions rapides</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
      ${tile("conges", "leaf", "bg-green", "Demande de congé")}
      ${tile("intervention", "tools", "bg-aqua", "Mon intervention")}
      ${tile("frais", "receipt", "bg-amber", "Créer une note de frais")}
      ${tile("salaires", "doc", "bg-violet", "Mes salaires")}
    </div>
  </div>`;
}

// --- Résumé heures : jauges circulaires --------------------------------------
function gauge(label, x) {
  const solde = (x.worked || 0) - (x.due || 0);   // heures sup (+) ou déficit (−)
  const over = solde > 0.001, under = solde < -0.001;
  const L = 132; // longueur de l'arc semicercle (π·42)
  const off = (L * (1 - Math.min(100, x.pct) / 100)).toFixed(1);
  const col = under ? "var(--danger)" : (over ? "#2f8f63" : "#127d89");
  const soldeLine = over
    ? `<div style="font-size:.74rem;font-weight:700;color:#2f8f63;margin-top:2px">+${fmtH(solde)} sup</div>`
    : (under ? `<div style="font-size:.74rem;font-weight:700;color:var(--danger);margin-top:2px">${fmtH(solde)}</div>`
             : `<div style="font-size:.72rem;color:var(--muted);margin-top:2px">à jour</div>`);
  return `<div class="halfg">
    <div class="halfg-label">${label}</div>
    <svg viewBox="0 0 100 58" class="halfg-svg">
      <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="var(--aqua-soft)" stroke-width="9" stroke-linecap="round"/>
      <path d="M8 50 A42 42 0 0 1 92 50" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${off}"/>
      <text x="50" y="47" text-anchor="middle" class="halfg-pct" fill="${under ? "var(--danger)" : (over ? col : "#0c2b38")}">${x.pct}%</text>
    </svg>
    <div class="halfg-sub tabular">${fmtH(x.worked)} / ${fmtH(x.due)}</div>
    ${soldeLine}
  </div>`;
}

function resumeCard(ov, balances) {
  const vac = (balances.leaves || []).find(l => l.unit === "day");
  const days = vac ? vac.remaining : 0;
  const alloc = vac && vac.allocated ? vac.allocated : 0;
  const allocTxt = alloc ? ` sur <strong class="tabular">${alloc}</strong> alloué${alloc >= 2 ? "s" : ""}` : "";
  return `<div class="card dash-link" data-nav="pointer" style="cursor:pointer">
    ${cardHead("Résumé de mes heures", "clock")}
    <div class="gauges">${gauge("Aujourd'hui", ov.day)}${gauge("Ce mois", ov.month)}${gauge("Cette année", ov.year)}</div>
    <div class="vac-line">${icon("sun", "icon-sm")}<span><strong class="tabular">${days}</strong> jour${days >= 2 ? "s" : ""} de vacances restant${days >= 2 ? "s" : ""}${allocTxt}</span></div>
  </div>`;
}

// --- Planning ----------------------------------------------------------------
function planningCard(planning) {
  const slots = (planning.slots || []).slice(0, 6);
  const body = slots.length
    ? slots.map(s => {
        const d = new Date(s.day + "T00:00:00");
        const jour = d.toLocaleDateString("fr-CH", { weekday: "short", day: "numeric", month: "short" });
        return `<div class="row" style="padding:9px 0">
          <span class="dot" style="background:${typeColor(s.label)}"></span>
          <span style="flex:0 0 84px;color:var(--muted);font-size:.84rem;text-transform:capitalize">${jour}</span>
          <span style="font-weight:600;color:var(--aqua-dark);flex:0 0 auto">${hm(s.start_datetime)}</span>
          <span style="flex:1;min-width:0">${escapeHtml(s.label)}${s.partner_id ? ` · <span class="muted">${escapeHtml(s.partner_id[1])}</span>` : ""}</span>
        </div>`;
      }).join("")
    : `<p class="muted" style="margin:12px 0 0">Aucune intervention planifiée sur les 5 prochains jours.</p>`;
  return `<div class="card dash-link" data-nav="planning" style="cursor:pointer">
    ${cardHead("Mon planning · 5 prochains jours", "calendar")}${body}</div>`;
}

// --- Absences ----------------------------------------------------------------
const LEAVE_STATE = {
  draft: ["Brouillon", "grey"], confirm: ["À valider", "pending"], validate1: ["1re validation", "pending"],
  validate: ["Validé", "ok"], refuse: ["Refusé", "danger"], cancel: ["Annulé", "grey"],
};

function leavesCard(leaves) {
  const recent = (leaves || []).slice(0, 4);
  const body = recent.length
    ? recent.map(l => {
        const [lbl, cls] = LEAVE_STATE[l.state] || [l.state, "grey"];
        return `<div class="row" style="padding:9px 0;justify-content:space-between">
          <div style="min-width:0;display:flex;align-items:center;gap:9px">${icon("leaf", "icon-sm")}<div><strong>${escapeHtml(l.type_label || "Congé")}</strong>
            <div style="font-size:.8rem;color:var(--muted)">${l.request_date_from} → ${l.request_date_to}</div></div></div>
          <span class="badge badge-${cls}">${escapeHtml(lbl)}</span></div>`;
      }).join("")
    : `<p class="muted" style="margin:12px 0 0">Aucune demande d'absence.</p>`;
  return `<div class="card dash-link" data-nav="conges" style="cursor:pointer">
    ${cardHead("Mes demandes d'absences", "leaf")}${body}</div>`;
}

// --- Équipe ------------------------------------------------------------------
function teamCard(team) {
  const head = team.dates.map((iso, i) =>
    `<th class="${iso === todayISO() ? "today" : ""}">${JOURS_C[i]} ${new Date(iso + "T00:00:00").getDate()}</th>`).join("");
  const rows = (team.members || []).map(m => {
    const first = m.name.split(" ").slice(-1)[0];
    const cells = team.dates.map(iso => {
      const c = m.days[iso] || {};
      const slots = c.slots || [];
      let inner = "";
      if (slots.length) inner = slots.map(s => `<div class="seg" style="background:${typeColor(s.label)}"><span class="gt">${escapeHtml(s.time)}</span> ${escapeHtml(s.label)}</div>`).join("");
      else if (c.leave) inner = `<span class="gleave">${icon("leaf", "icon-sm")}</span>`;
      return `<td>${inner}</td>`;
    }).join("");
    return `<tr><td class="gname">${escapeHtml(first)}</td>${cells}</tr>`;
  }).join("");
  return `<div class="card dash-link" data-nav="planning" style="cursor:pointer">
    ${cardHead("Planning de l'équipe · semaine", "users")}
    <div class="gantt" style="margin-top:10px"><table class="gtable">
      <thead><tr><th class="gname"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

function holidaysCard(holidays) {
  if (!holidays || !holidays.length) return "";
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("fr-CH", { weekday: "short", day: "numeric", month: "long" });
  const next = holidays[0];
  const rest = holidays.slice(1, 4).map(h => `<div class="row" style="padding:8px 0">
      <span class="dot" style="background:var(--violet)"></span>
      <span style="flex:0 0 auto;color:var(--muted);font-size:.84rem;text-transform:capitalize">${fmt(h.date)}</span>
      <span style="flex:1;min-width:0">${escapeHtml(h.name)}</span></div>`).join("");
  return `<div class="card">
    <div class="card-head"><div class="t">${icon("calendar")}<h3>Prochains jours fériés</h3></div><span class="muted" style="font-size:.78rem">Fribourg</span></div>
    <div class="row" style="border-top:0;padding:12px 0 6px">
      <span class="qbadge bg-violet">${icon("calendar")}</span>
      <div style="flex:1"><strong style="font-size:1.05rem">${escapeHtml(next.name)}</strong>
        <div class="muted" style="font-size:.82rem;text-transform:capitalize">${fmt(next.date)}</div></div>
    </div>${rest}
  </div>`;
}

// --- Note + pense-bête (local) ------------------------------------------------
function noteCards() {
  const stickies = [{ k: "1", cls: "pi-yellow" }, { k: "2", cls: "pi-pink" }, { k: "3", cls: "pi-blue" }];
  return `<div class="eyebrow" style="margin:6px 4px 8px">Mes notes</div>
    <div class="postit-row">${stickies.map(n => {
      const val = localStorage.getItem(`sp_note${n.k}_${storeKey}`) || "";
      return `<div class="postit ${n.cls}"><textarea data-note="${n.k}" rows="4" placeholder="Note rapide…">${escapeHtml(val)}</textarea></div>`;
    }).join("")}</div>`;
}

function loadTodos() { try { return JSON.parse(localStorage.getItem(`sp_todo_${storeKey}`)) || []; } catch { return []; } }
function saveTodos(items) { localStorage.setItem(`sp_todo_${storeKey}`, JSON.stringify(items)); }

function todoListHtml(items) {
  if (!items.length) return `<p class="muted" style="margin:8px 0 0">Aucun pense-bête.</p>`;
  return items.map((it, i) => `<div class="row" style="padding:8px 0">
    <input type="checkbox" data-todo-chk="${i}" ${it.done ? "checked" : ""} style="width:20px;height:20px;flex:0 0 auto;cursor:pointer;accent-color:var(--aqua-dark)">
    <span style="flex:1;min-width:0;${it.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${escapeHtml(it.text)}</span>
    <button data-todo-del="${i}" aria-label="Supprimer" style="border:0;background:none;cursor:pointer;color:var(--muted);display:flex">${icon("x", "icon-sm")}</button>
  </div>`).join("");
}

function todoCard() {
  return `<div class="card">
    <div class="card-head"><div class="t">${icon("check")}<h3>Pense-bête</h3></div></div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <input id="todo-input" type="text" placeholder="Ajouter une tâche…" style="flex:1;min-height:46px;border:1px solid var(--line);border-radius:11px;padding:0 12px;font-size:1rem">
      <button class="btn" id="todo-add" style="width:auto;min-height:46px;padding:0 16px">${icon("plus")}</button>
    </div>
    <div id="todo-list">${todoListHtml(loadTodos())}</div>
  </div>`;
}

async function punchTimbrage(btn, nav) {
  btn.disabled = true;
  let st;
  try { st = await api("/attendance/status"); }
  catch { btn.disabled = false; toast("Timbrage indisponible."); return; }
  const isIn = st.state === "in";
  const pos = await getPosition();
  try {
    await api(isIn ? "/attendance/check-out" : "/attendance/check-in", { method: "POST", body: pos || {} });
    toast(isIn ? "Sortie enregistrée" : "Entrée enregistrée");
    nav("accueil");
  } catch {
    btn.disabled = false;
    toast("Échec du timbrage.");
  }
}

function wire(dash, nav) {
  dash.querySelectorAll(".dash-act").forEach(b => b.addEventListener("click", () => {
    const a = b.dataset.act;
    if (a === "conges") nav("conges", "new");
    else if (a === "intervention") nav("terrain", "new");
    else if (a === "frais") nav("notesfrais", "new");
    else if (a === "salaires") nav("documents", "payslips");
    else if (a === "entrer") punchTimbrage(b, nav);
  }));
  dash.querySelectorAll(".dash-link").forEach(c => c.addEventListener("click", () => nav(c.dataset.nav)));

  dash.querySelectorAll("[data-note]").forEach(ta => {
    let nt = null;
    ta.addEventListener("input", () => {
      clearTimeout(nt);
      nt = setTimeout(() => localStorage.setItem(`sp_note${ta.dataset.note}_${storeKey}`, ta.value), 400);
    });
  });

  const todoList = dash.querySelector("#todo-list");
  const todoInput = dash.querySelector("#todo-input");
  const addTodo = () => {
    const v = (todoInput.value || "").trim();
    if (!v) return;
    const items = loadTodos(); items.push({ text: v, done: false }); saveTodos(items);
    todoInput.value = ""; todoList.innerHTML = todoListHtml(items);
  };
  const addBtn = dash.querySelector("#todo-add");
  if (addBtn) addBtn.addEventListener("click", addTodo);
  if (todoInput) todoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTodo(); } });
  if (todoList) todoList.addEventListener("click", (e) => {
    const chk = e.target.closest("[data-todo-chk]");
    const del = e.target.closest("[data-todo-del]");
    if (chk) {
      const items = loadTodos(); const i = Number(chk.dataset.todoChk);
      if (items[i]) { items[i].done = chk.checked; saveTodos(items); todoList.innerHTML = todoListHtml(items); }
    } else if (del) {
      const items = loadTodos(); items.splice(Number(del.dataset.todoDel), 1);
      saveTodos(items); todoList.innerHTML = todoListHtml(items);
    }
  });
}
