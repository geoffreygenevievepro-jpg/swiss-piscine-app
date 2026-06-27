// Bootstrap de l'app : porte d'authentification, shell à 4 onglets, badge de
// synchro, enregistrement du service worker.
import { tokens, profile } from "./store.js";
import { injectSprite, icon } from "./icons.js";
import { applyTheme } from "./theme.js";
import { openSheet } from "./sheet.js";
import { renderChrono } from "./screens/chrono.js";
import { logout as apiLogout, api } from "./api.js";
import { escapeHtml, toast } from "./util.js";
import { sync as syncOutbox, count as outboxCount } from "./outbox.js";
import { renderLogin } from "./screens/login.js";
import { accueil } from "./screens/accueil.js";
import { terrain } from "./screens/terrain.js";
import { pointer } from "./screens/pointer.js";
import { semaine as planning } from "./screens/semaine.js";
import { conges } from "./screens/conges.js";
import { notesfrais } from "./screens/notesfrais.js";
import { documents } from "./screens/documents.js";
import { moi } from "./screens/moi.js";
import { admin } from "./screens/admin.js";

const SCREENS = [accueil, pointer, terrain, planning, conges, notesfrais, documents, moi, admin];

// Écrans contrôlables (activables/désactivables par société/employé depuis vue.heiwa).
// Accueil/Pointer/Moi sont toujours visibles ; Admin reste réservé au rôle admin.
const CONTROLLABLE_TABS = ["terrain", "planning", "conges", "notesfrais", "documents"];

// Écrans visibles selon le rôle + les droits App RH (effective_tabs renvoyés par /me).
function navScreens() {
  const me = profile.get() || {};
  const role = me.role;
  const eff = me.effective_tabs;           // array | undefined (vieux cache)
  return SCREENS.filter(s => {
    if (s.id === "admin") return role === "admin";
    if (CONTROLLABLE_TABS.includes(s.id)) return !eff || eff.includes(s.id);  // fail-open si absent
    return true;                            // accueil/pointer/moi/… toujours visibles
  });
}
const root = document.getElementById("app");
let current = accueil.id;

function ctx() {
  return { navigate: mountApp, logout: doLogout };
}

async function updateSyncBadge() {
  const badge = document.getElementById("sync-badge");
  if (!badge) return;
  const pending = await outboxCount();
  if (!navigator.onLine) {
    badge.className = "sync-badge offline";
    badge.querySelector(".txt").textContent = pending ? `Hors ligne · ${pending}` : "Hors ligne";
  } else if (pending) {
    badge.className = "sync-badge pending";
    badge.querySelector(".txt").textContent = `${pending} en attente`;
  } else {
    badge.className = "sync-badge";
    badge.querySelector(".txt").textContent = "À jour";
  }
}

// Tente d'envoyer les rapports en file, puis rafraîchit le badge.
async function flushOutbox() {
  if (navigator.onLine && tokens.access) await syncOutbox();
  updateSyncBadge();
}

function mountApp(screenId = current) {
  applyTheme((profile.get()||{}).company);
  current = screenId;
  document.body.classList.remove("screen-login");
  const me = profile.get();
  const who = me && me.name ? me.name.replace(/[&<>"']/g, "") : "";
  const initials = who ? who.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() : "";
  const co = (me && me.company) || {};
  const brand = co.logo ? `<img class="brand-logo" src="${co.logo}" alt="">` : `<span class="brand-mark">${icon("wave")}</span>`;
  const coName = (co.name || "Swiss Piscine").replace(/[&<>"']/g, "");
  root.innerHTML = `
    <header class="app-header">
      <div class="brand">${brand}<div><b>${coName}</b><span class="eyebrow">Espace équipe</span></div></div>
      <div class="header-right">
        <span class="sync-badge" id="sync-badge"><span class="dot"></span><span class="txt">À jour</span></span>
        <button class="logout-btn notif-btn" id="notif-btn" title="Notifications" aria-label="Notifications">${icon("bell", "icon-sm")}<span class="notif-count" id="notif-count" hidden>0</span></button>
        <button class="who-btn" id="profile-btn" title="Réglages" aria-label="Réglages">
          ${who ? `<span class="who-name">${who}</span>` : ""}
          ${initials ? `<span class="avatar">${initials}</span>` : ""}
        </button>
        <button class="logout-btn" id="logout-btn" title="Se déconnecter" aria-label="Se déconnecter">${icon("power", "icon-sm")}</button>
      </div>
    </header>
    <main class="view" id="view"></main>
    <nav class="tabbar" id="tabbar">
      ${navScreens().map(s => `
        <button data-screen="${s.id}" class="${s.id === current ? "active" : ""}">
          ${icon(s.icon)}${s.label}
        </button>`).join("")}
    </nav>
    <nav class="mobilebar" id="mobilebar">
      <button class="mb-item ${current === "accueil" ? "active" : ""}" data-mb="accueil">${icon("home")}<span>Accueil</span></button>
      <button class="mb-chrono" data-mb="chrono" aria-label="Chronomètre">${icon("clock")}</button>
      <button class="mb-item" data-mb="menu">${icon("menu")}<span>Menu</span></button>
    </nav>`;

  const view = root.querySelector("#view");
  SCREENS.find(s => s.id === current).render(view, ctx());

  root.querySelector("#tabbar").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-screen]");
    if (btn) mountApp(btn.dataset.screen);
  });
  const logoutBtn = root.querySelector("#logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
  root.querySelector("#notif-btn").addEventListener("click", openNotifications);
  root.querySelector("#profile-btn").addEventListener("click", openSettings);

  root.querySelector("#mobilebar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mb]");
    if (!b) return;
    const a = b.dataset.mb;
    if (a === "accueil") mountApp("accueil");
    else if (a === "chrono") openSheet({ title: "Chronomètre", onMount: (body) => renderChrono(body) });
    else if (a === "menu") openMenuSheet();
  });
  updateSyncBadge();
  refreshNotifCount();
}

function openMenuSheet() {
  const items = navScreens().filter(s => s.id !== "accueil").map(s =>
    `<button class="menu-row" data-screen="${s.id}">${icon(s.icon)}<span>${s.label}</span>${icon("chevR", "chev")}</button>`).join("");
  openSheet({
    title: "Menu",
    bodyHTML: `<div class="menu-list">${items}</div>`,
    onMount: (body, close) => {
      body.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-screen]");
        if (!b) return;
        close();
        mountApp(b.dataset.screen);
      });
    },
  });
}

// --- Notifications ----------------------------------------------------------
function setNotifCount(n) {
  const el = document.getElementById("notif-count");
  if (!el) return;
  if (n > 0) { el.textContent = n > 9 ? "9+" : String(n); el.hidden = false; }
  else el.hidden = true;
}

async function refreshNotifCount() {
  try { const d = await api("/notifications"); setNotifCount(d.unread || 0); } catch {}
}

function notifRow(n) {
  let ic = "calendar", bg = "bg-violet";
  if (n.type === "leave_to_approve") { ic = "inbox"; bg = "bg-amber"; }
  else if (n.type === "leave_refused") { ic = "x"; bg = "bg-coral"; }
  else if (n.type.startsWith("leave")) { ic = "check"; bg = "bg-green"; }
  return `<div class="notif ${n.read_at ? "" : "unread"}">
    <span class="qbadge ${bg}">${icon(ic, "icon-sm")}</span>
    <div style="flex:1;min-width:0"><strong>${escapeHtml(n.title)}</strong>
      <div class="muted" style="font-size:.84rem">${escapeHtml(n.body || "")}</div></div>
  </div>`;
}

function openNotifications() {
  openSheet({
    title: "Notifications",
    onMount: async (body) => {
      body.innerHTML = `<div class="placeholder">Chargement…</div>`;
      let data;
      try { data = await api("/notifications"); }
      catch { body.innerHTML = `<div class="card" style="border-color:var(--danger)">Indisponible.</div>`; return; }
      const items = data.items || [];
      body.innerHTML = items.length
        ? items.map(notifRow).join("")
        : `<div class="placeholder"><div class="big">${icon("bell")}</div>Aucune notification</div>`;
      try { await api("/notifications/read", { method: "POST" }); } catch {}
      setNotifCount(0);
    },
  });
}

// --- Réglages ---------------------------------------------------------------
function settingsHTML(me, prefs) {
  const toggle = (key, label, on) => `<label class="set-row"><span>${label}</span>
    <input type="checkbox" class="toggle" data-pref="${key}" ${on ? "checked" : ""}></label>`;
  const lang = (me.odoo && me.odoo.lang) || "fr_FR";
  return `
    <div class="card">
      <div class="card-head"><div class="t">${icon("bell")}<h3>Notifications</h3></div></div>
      <div style="margin-top:6px">
        ${toggle("leave", "Congés (validé / refusé)", prefs.leave)}
        ${toggle("planning", "Planning mis à jour", prefs.planning)}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div class="t">${icon("key")}<h3>Code PIN</h3></div></div>
      <p class="muted" style="font-size:.82rem;margin:6px 0 12px">Enregistré dans Odoo (chiffres uniquement).</p>
      <div class="field"><label>PIN actuel</label><input id="pin-cur" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>
      <div class="field"><label>Nouveau PIN</label><input id="pin-new" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>
      <div class="field"><label>Confirmer le nouveau PIN</label><input id="pin-cnf" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>
      <p class="form-error" id="pin-err"></p>
      <button class="btn" id="pin-save">${icon("save", "icon-sm")} Changer le PIN</button>
    </div>
    <div class="card">
      <div class="card-head"><div class="t">${icon("globe")}<h3>Langue</h3></div></div>
      <div class="field" style="margin-top:8px"><select id="set-lang">
        ${[["fr_FR", "Français"], ["de_CH", "Allemand (CH)"], ["en_GB", "Anglais"]].map(([v, l]) => `<option value="${v}" ${lang === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
    </div>
    <button class="btn secondary" id="set-logout" style="margin-top:2px">${icon("power", "icon-sm")} Se déconnecter</button>`;
}

async function openSettings() {
  const me = profile.get() || {};
  let prefs = { leave: true, planning: true };
  try { prefs = await api("/notifications/prefs"); } catch {}
  openSheet({
    title: "Réglages",
    bodyHTML: settingsHTML(me, prefs),
    onMount: (body, close) => {
      body.querySelectorAll(".toggle").forEach(t => t.addEventListener("change", async () => {
        const p = {};
        body.querySelectorAll(".toggle").forEach(x => { p[x.dataset.pref] = x.checked; });
        try { await api("/notifications/prefs", { method: "PATCH", body: p }); } catch {}
      }));
      const save = body.querySelector("#pin-save"), err = body.querySelector("#pin-err");
      save.addEventListener("click", async () => {
        err.textContent = "";
        const cur = body.querySelector("#pin-cur").value, nw = body.querySelector("#pin-new").value, cf = body.querySelector("#pin-cnf").value;
        if (!/^\d{4,8}$/.test(nw)) { err.textContent = "Le PIN doit comporter 4 à 8 chiffres."; return; }
        if (nw !== cf) { err.textContent = "Les nouveaux PIN ne correspondent pas."; return; }
        save.disabled = true; save.innerHTML = `<span class="spinner"></span>`;
        try { await api("/me/pin", { method: "POST", body: { current_pin: cur, new_pin: nw } }); toast("PIN modifié"); close(); }
        catch (e) { save.disabled = false; save.innerHTML = `${icon("save", "icon-sm")} Changer le PIN`; err.textContent = (e && e.message) ? e.message : "Échec."; }
      });
      const lang = body.querySelector("#set-lang");
      if (lang) lang.addEventListener("change", async () => {
        try { await api("/me/details", { method: "PATCH", body: { lang: lang.value } }); toast("Langue enregistrée"); } catch {}
      });
      const lo = body.querySelector("#set-logout");
      if (lo) lo.addEventListener("click", () => { close(); doLogout(); });
    },
  });
}

async function doLogout() {
  await apiLogout();
  current = accueil.id;
  mountAuth();
}

function mountAuth() {
  renderLogin(root, () => mountApp(accueil.id));
}

function boot() {
  if (tokens.access) mountApp(accueil.id);
  else mountAuth();
}

window.addEventListener("online", flushOutbox);
window.addEventListener("offline", updateSyncBadge);
// Session totalement expirée (refresh échoué) → retour à l'écran de connexion.
window.addEventListener("auth-expired", () => { current = accueil.id; mountAuth(); });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

injectSprite();
boot();
flushOutbox();
