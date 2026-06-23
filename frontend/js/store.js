// Stockage local des tokens et du profil employé.
const ACCESS = "sp_access";
const REFRESH = "sp_refresh";
const PROFILE = "sp_profile";

export const tokens = {
  get access() { return localStorage.getItem(ACCESS); },
  get refresh() { return localStorage.getItem(REFRESH); },
  set({ access_token, refresh_token }) {
    if (access_token) localStorage.setItem(ACCESS, access_token);
    if (refresh_token) localStorage.setItem(REFRESH, refresh_token);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    localStorage.removeItem(PROFILE);
  },
};

export const profile = {
  get() {
    try { return JSON.parse(localStorage.getItem(PROFILE)); }
    catch { return null; }
  },
  set(p) { localStorage.setItem(PROFILE, JSON.stringify(p)); },
};
