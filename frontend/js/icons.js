// Jeu d'icônes au trait fin (sprite SVG) + helpers. Aucune dépendance, aucun émoji.
export const ICON_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-home" viewBox="0 0 24 24"><path d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></symbol>
<symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></symbol>
<symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4M9 13h6M9 16.5h6"/></symbol>
<symbol id="i-note" viewBox="0 0 24 24"><rect x="4.5" y="4" width="15" height="17" rx="2.5"/><path d="M8 9h8M8 13h8M8 17h5"/></symbol>
<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/></symbol>
<symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.5-3 2.7-4.6 5.5-4.6S14 16 14.5 19M16 6.2a3 3 0 0 1 0 5.8M16.5 14.6c2.3.4 3.6 1.9 4 4.4"/></symbol>
<symbol id="i-tools" viewBox="0 0 24 24"><path d="M14.5 6.5a3.8 3.8 0 0 1-5 5L4 17v3h3l5.5-5.5a3.8 3.8 0 0 1 5-5l-2.4-2.4 1.6-1.6 2.5 2.5"/></symbol>
<symbol id="i-receipt" viewBox="0 0 24 24"><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9 8h6M9 11.5h6"/></symbol>
<symbol id="i-leaf" viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-13 0 9-5 14-13 13M5 19c2-5 5-7 9-8"/></symbol>
<symbol id="i-gift" viewBox="0 0 24 24"><rect x="4" y="9.5" width="16" height="11" rx="1.5"/><path d="M3 9.5h18v3.5H3zM12 9.5v11"/><path d="M12 9.5C10.5 6.5 6.5 6.5 6.5 8.5S9 9.5 12 9.5zM12 9.5C13.5 6.5 17.5 6.5 17.5 8.5S15 9.5 12 9.5z"/></symbol>
<symbol id="i-wave" viewBox="0 0 24 24"><path d="M3 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></symbol>
<symbol id="i-wind" viewBox="0 0 24 24"><path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 16h13a2.5 2.5 0 1 1-2.5 2.5M3 12h16a2.5 2.5 0 1 0-2.5-2.5"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></symbol>
<symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7 18a4.2 4.2 0 0 1-.4-8.4A5.2 5.2 0 0 1 17 9.6 3.7 3.7 0 0 1 17 18z"/></symbol>
<symbol id="i-cloud-sun" viewBox="0 0 24 24"><circle cx="8" cy="7.5" r="2.6"/><path d="M8 2.5V4M3.6 3.6l1 1M2.5 8H4M3.6 12.4l1-1"/><path d="M10 19a3.4 3.4 0 0 1-.3-6.8 4.6 4.6 0 0 1 9 .8 3 3 0 0 1 .3 6z"/></symbol>
<symbol id="i-cloud-rain" viewBox="0 0 24 24"><path d="M7 15a4.2 4.2 0 0 1-.4-8.4A5.2 5.2 0 0 1 17 6.6 3.7 3.7 0 0 1 17 15z"/><path d="M8 18v2M12 18v2.5M16 18v2"/></symbol>
<symbol id="i-cloud-snow" viewBox="0 0 24 24"><path d="M7 15a4.2 4.2 0 0 1-.4-8.4A5.2 5.2 0 0 1 17 6.6 3.7 3.7 0 0 1 17 15z"/><path d="M8 19h.01M12 19h.01M16 19h.01M10 21.5h.01M14 21.5h.01"/></symbol>
<symbol id="i-cloud-fog" viewBox="0 0 24 24"><path d="M7 13a4.2 4.2 0 0 1-.4-8.4A5.2 5.2 0 0 1 17 4.6 3.7 3.7 0 0 1 17 13z"/><path d="M5 17h12M7 20h10"/></symbol>
<symbol id="i-cloud-lightning" viewBox="0 0 24 24"><path d="M7 14a4.2 4.2 0 0 1-.4-8.4A5.2 5.2 0 0 1 17 5.6 3.7 3.7 0 0 1 17 14z"/><path d="M12 13l-2 4h3l-2 4"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-chevR" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></symbol>
<symbol id="i-chevL" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></symbol>
<symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3.5v8M6.5 7a8 8 0 1 0 11 0"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></symbol>
<symbol id="i-navigation" viewBox="0 0 24 24"><path d="M3 11l18-7-7 18-2.6-8.4z"/></symbol>
<symbol id="i-phone" viewBox="0 0 24 24"><path d="M6 3.5h4l1.5 5-2 1.5a12 12 0 0 0 4.5 4.5l1.5-2 5 1.5v4c0 .8-.7 1.5-1.5 1.4C12 19.5 5 12.5 4.6 5 4.5 4.2 5.2 3.5 6 3.5z"/></symbol>
<symbol id="i-camera" viewBox="0 0 24 24"><path d="M4.5 8.5h3L9 6.5h6l1.5 2h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.2"/></symbol>
<symbol id="i-image" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="M4 18.5l5-4 4 3 3-2.5 4 3.5"/></symbol>
<symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13"/></symbol>
<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M7 5l11 7-11 7z"/></symbol>
<symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></symbol>
<symbol id="i-flag" viewBox="0 0 24 24"><path d="M6 21V4M6 5h11l-2 3 2 3H6"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></symbol>
<symbol id="i-list" viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
<symbol id="i-megaphone" viewBox="0 0 24 24"><path d="M4 9.5v5h3l9 4V5.5l-9 4z"/><path d="M7 14.5V19a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1v-3M18.5 9.5a4 4 0 0 1 0 5"/></symbol>
<symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></symbol>
<symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.4 2.7 3-.6.6 3 2.7 1.4-1.5 2.6 1.5 2.6-2.7 1.4-.6 3-3-.6L12 21.5l-1.4-2.7-3 .6-.6-3L4.3 15l1.5-2.6L4.3 9.8l2.7-1.4.6-3 3 .6z"/></symbol>
<symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M18.5 18.5l1.5-1.5"/></symbol>
<symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.3 3.6 8.5S14.4 18.2 12 20.5C9.6 18.2 8.4 15.2 8.4 12S9.6 5.8 12 3.5z"/></symbol>
<symbol id="i-grid" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></symbol>
<symbol id="i-building" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16.5" rx="1.5"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20.5v-3.5h4v3.5"/></symbol>
<symbol id="i-tag" viewBox="0 0 24 24"><path d="M4 12.5V5h7.5L20 13.5 13.5 20z"/><path d="M8.3 8.3h.01"/></symbol>
<symbol id="i-save" viewBox="0 0 24 24"><path d="M5 4.5h11l3 3V19.5H5z"/><path d="M8 4.5v5h6v-5M8 19.5v-5h8v5"/></symbol>
<symbol id="i-inbox" viewBox="0 0 24 24"><path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5a3 3 0 0 0 6 0h5"/></symbol>
<symbol id="i-thermometer" viewBox="0 0 24 24"><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 9v5"/></symbol>
<symbol id="i-cross" viewBox="0 0 24 24"><path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/></symbol>
<symbol id="i-coffee" viewBox="0 0 24 24"><path d="M4 8h13v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M17 9h2.5a2.5 2.5 0 0 1 0 5H17M7 4.5c0 .8-.8 1-.8 2M11 4.5c0 .8-.8 1-.8 2"/></symbol>
<symbol id="i-id" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16c.4-1.6 1.6-2.4 3-2.4s2.6.8 3 2.4M14 9.5h4M14 13h4M14 16h2.5"/></symbol>
<symbol id="i-graduation" viewBox="0 0 24 24"><path d="M2.5 9 12 5l9.5 4-9.5 4z"/><path d="M6 11v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4M21.5 9v4.5"/></symbol>
<symbol id="i-heart" viewBox="0 0 24 24"><path d="M12 20S4 14.5 4 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8 2.2C20 14.5 12 20 12 20z"/></symbol>
</defs></svg>`;

export function injectSprite() {
  if (document.getElementById("sp-icons")) return;
  const wrap = document.createElement("div");
  wrap.id = "sp-icons";
  wrap.innerHTML = ICON_SPRITE;
  document.body.prepend(wrap);
}

export function icon(name, cls = "") {
  return `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Code météo WMO (Open-Meteo) → nom d'icône + libellé FR.
export function weatherIcon(c) {
  if (c === 0) return "sun";
  if (c <= 2) return "cloud-sun";
  if (c === 3) return "cloud";
  if (c <= 48) return "cloud-fog";
  if (c <= 67) return "cloud-rain";
  if (c <= 77) return "cloud-snow";
  if (c <= 82) return "cloud-rain";
  if (c <= 86) return "cloud-snow";
  return "cloud-lightning";
}

export function weatherLabel(c) {
  if (c === 0) return "Ciel dégagé";
  if (c <= 2) return "Peu nuageux";
  if (c === 3) return "Couvert";
  if (c <= 48) return "Brouillard";
  if (c <= 57) return "Bruine";
  if (c <= 67) return "Pluie";
  if (c <= 77) return "Neige";
  if (c <= 82) return "Averses";
  if (c <= 86) return "Averses de neige";
  return "Orage";
}
