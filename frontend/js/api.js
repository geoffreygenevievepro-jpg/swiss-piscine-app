// Client API : ajoute le JWT, rafraîchit automatiquement sur 401, expose les
// appels d'auth. Pensé pour être étendu (offline queue) aux sprints suivants.
import { API_BASE } from "./config.js";
import { tokens } from "./store.js";

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export { ApiError };

async function rawFetch(path, { method = "GET", body, auth = true, bearer, credentials } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (bearer) {
    headers["Authorization"] = "Bearer " + bearer;
  } else if (auth && tokens.access) {
    headers["Authorization"] = "Bearer " + tokens.access;
  }
  const fetchOpts = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };
  if (credentials) fetchOpts.credentials = credentials;
  const res = await fetch(API_BASE + path, fetchOpts);
  return res;
}

async function tryRefresh() {
  if (!tokens.refresh) return false;
  const res = await rawFetch("/auth/refresh", {
    method: "POST",
    auth: false,
    body: { refresh_token: tokens.refresh },
  });
  if (!res.ok) return false;
  tokens.set(await res.json());
  return true;
}

// --- Cache léger des GET (lecture hors-ligne) ---
const CACHE_PREFIX = "sp_cache_";
function cachePut(path, data) {
  try { localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data)); } catch {}
}
function cacheGet(path) {
  try {
    const v = localStorage.getItem(CACHE_PREFIX + path);
    return v === null ? undefined : JSON.parse(v);
  } catch { return undefined; }
}

// Session totalement expirée : on purge et on signale à l'app de revenir au login.
function authExpired() {
  tokens.clear();
  window.dispatchEvent(new Event("auth-expired"));
}

// Appel authentifié : refresh transparent sur 401, repli sur le cache hors-ligne.
// opts.bearer  : token explicite (ex. pending_token pour /2fa/*) — désactive le refresh auto.
// opts.credentials : valeur fetch credentials ("include" pour poser le cookie d'appareil).
export async function api(path, opts = {}) {
  const isGet = !opts.method || opts.method === "GET";
  // Si un bearer explicite est fourni, on ne tente pas le refresh automatique.
  const skipRefresh = !!opts.bearer;
  try {
    let res = await rawFetch(path, opts);
    if (res.status === 401 && opts.auth !== false && !skipRefresh) {
      if (await tryRefresh()) {
        res = await rawFetch(path, opts);
      } else {
        authExpired();
        throw new ApiError("Session expirée", 401);
      }
    }
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch {}
      throw new ApiError(detail, res.status);
    }
    const data = res.status === 204 ? null : await res.json();
    // On ne met pas en cache les gros binaires (PDF de paie).
    if (isGet && !path.includes("/pdf")) cachePut(path, data);
    return data;
  } catch (e) {
    // Réseau coupé sur un GET : on sert la dernière donnée connue.
    if (isGet && !(e instanceof ApiError)) {
      const cached = cacheGet(path);
      if (cached !== undefined) return cached;
    }
    throw e;
  }
}

// --- Auth ---
// Retourne le corps brut de /auth/login.
// Si la réponse contient twofa_required ou twofa_setup_required, l'appelant doit
// prendre en charge la flow 2FA (voir screens/login.js).
// Si c'est un token normal, l'appelant doit appeler tokens.set().
export async function login(loginName, pin) {
  const res = await rawFetch("/auth/login", {
    method: "POST",
    auth: false,
    body: { login: loginName, pin },
  });
  if (!res.ok) {
    let detail = "Identifiant ou code PIN incorrect";
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new ApiError(detail, res.status);
  }
  return await res.json();
}

export async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  tokens.clear();
}

export const getMe = () => api("/me");
