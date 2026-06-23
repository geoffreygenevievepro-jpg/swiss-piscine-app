// Client API : ajoute le JWT, rafraîchit automatiquement sur 401, expose les
// appels d'auth. Pensé pour être étendu (offline queue) aux sprints suivants.
import { API_BASE } from "./config.js";
import { tokens } from "./store.js";

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export { ApiError };

async function rawFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && tokens.access) headers["Authorization"] = "Bearer " + tokens.access;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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

// Appel authentifié avec une tentative de refresh transparente sur 401.
export async function api(path, opts = {}) {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && opts.auth !== false) {
    if (await tryRefresh()) {
      res = await rawFetch(path, opts);
    }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- Auth ---
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
  tokens.set(await res.json());
}

export async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  tokens.clear();
}

export const getMe = () => api("/me");
