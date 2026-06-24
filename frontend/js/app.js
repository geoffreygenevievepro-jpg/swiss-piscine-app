// Bootstrap de l'app : porte d'authentification, shell à 4 onglets, badge de
// synchro, enregistrement du service worker.
import { tokens } from "./store.js";
import { logout as apiLogout } from "./api.js";
import { sync as syncOutbox, count as outboxCount } from "./outbox.js";
import { renderLogin } from "./screens/login.js";
import { terrain } from "./screens/terrain.js";
import { pointer } from "./screens/pointer.js";
import { moi } from "./screens/moi.js";
import { semaine } from "./screens/semaine.js";

const SCREENS = [terrain, pointer, moi, semaine];
const root = document.getElementById("app");
let current = terrain.id;

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
  current = screenId;
  document.body.classList.remove("screen-login");
  root.innerHTML = `
    <header class="app-header">
      <h1>Swiss Piscine</h1>
      <span class="sync-badge" id="sync-badge"><span class="dot"></span><span class="txt">À jour</span></span>
    </header>
    <main class="view" id="view"></main>
    <nav class="tabbar" id="tabbar">
      ${SCREENS.map(s => `
        <button data-screen="${s.id}" class="${s.id === current ? "active" : ""}">
          <span class="ic">${s.icon}</span>${s.label}
        </button>`).join("")}
    </nav>`;

  const view = root.querySelector("#view");
  SCREENS.find(s => s.id === current).render(view, ctx());

  root.querySelector("#tabbar").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-screen]");
    if (btn) mountApp(btn.dataset.screen);
  });
  updateSyncBadge();
}

async function doLogout() {
  await apiLogout();
  current = terrain.id;
  mountAuth();
}

function mountAuth() {
  renderLogin(root, () => mountApp(terrain.id));
}

function boot() {
  if (tokens.access) mountApp(terrain.id);
  else mountAuth();
}

window.addEventListener("online", flushOutbox);
window.addEventListener("offline", updateSyncBadge);
// Session totalement expirée (refresh échoué) → retour à l'écran de connexion.
window.addEventListener("auth-expired", () => { current = terrain.id; mountAuth(); });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

boot();
flushOutbox();
