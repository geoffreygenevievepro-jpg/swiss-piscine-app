// Petits utilitaires de formatage (durées, heures, échéances).

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Statut d'échéance d'une intervention : retard / aujourd'hui / à venir / sans date.
export function deadlineStatus(dateStr) {
  if (!dateStr) return { key: "none", label: "Sans date", color: "var(--muted)" };
  const d = new Date(dateStr.replace(" ", "T"));
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startNext = new Date(startToday.getTime() + 86400000);
  if (d < startToday) return { key: "late", label: "En retard", color: "var(--danger)" };
  if (d < startNext) return { key: "today", label: "Aujourd'hui", color: "var(--aqua-dark)" };
  return { key: "upcoming", label: "À venir", color: "var(--muted)" };
}

export function fmtDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.replace(" ", "T"));
  return d.toLocaleDateString("fr-CH", { weekday: "short", day: "numeric", month: "short" });
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Notification éphémère en bas d'écran.
export function toast(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText =
    "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:50;" +
    "background:var(--navy);color:#fff;padding:12px 18px;border-radius:999px;" +
    "font-size:.9rem;box-shadow:0 8px 24px rgba(12,34,51,.3);max-width:90%;text-align:center";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
