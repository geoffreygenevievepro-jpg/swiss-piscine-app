// Onglet « Contacts » — annuaire des clients de la société (lecture seule).
// Visible par tous les employés. Actions : appeler, email, itinéraire.
import { api } from "../api.js";
import { escapeHtml } from "../util.js";
import { icon } from "../icons.js";

let q = "";

export const contacts = {
  id: "contacts",
  label: "Contacts",
  icon: "users",
  async render(root) {
    root.innerHTML = `<h2>Contacts</h2>
      <input id="ct-search" type="search" inputmode="search" autocomplete="off"
             placeholder="Rechercher (nom, ville, email…)" value="${escapeHtml(q)}"
             style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:11px;padding:0 14px;font-size:.95rem;margin-bottom:14px">
      <div id="ct-list"><div class="placeholder"><div class="big">${icon("users")}</div>Chargement…</div></div>`;
    const list = root.querySelector("#ct-list");
    const search = root.querySelector("#ct-search");

    const load = async () => {
      list.innerHTML = `<div class="placeholder">Chargement…</div>`;
      try {
        const data = await api(`/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        list.innerHTML = data.length
          ? data.map(card).join("")
          : `<p style="color:var(--muted)">Aucun contact trouvé.</p>`;
      } catch {
        list.innerHTML = `<div class="card" style="border-color:var(--danger)">Impossible de charger les contacts.</div>`;
      }
    };

    let t;
    search.addEventListener("input", () => { q = search.value.trim(); clearTimeout(t); t = setTimeout(load, 300); });
    load();
  },
};

function card(c) {
  const sub = [c.function, c.is_company ? "" : c.company, c.city].filter(Boolean).join(" · ");
  const addr = [c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const maps = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : "";
  const acts = [];
  if (c.phone) acts.push(`<a class="ct-act" href="tel:${escapeHtml(c.phone)}">${icon("phone", "icon-sm")} Appeler</a>`);
  if (c.email) acts.push(`<a class="ct-act" href="mailto:${escapeHtml(c.email)}">${icon("inbox", "icon-sm")} Email</a>`);
  if (maps) acts.push(`<a class="ct-act" href="${maps}" target="_blank" rel="noopener">${icon("navigation", "icon-sm")} Itinéraire</a>`);
  return `<div class="card ct-card">
    <strong style="font-size:1rem">${escapeHtml(c.name)}</strong>
    ${sub ? `<div class="ct-sub">${escapeHtml(sub)}</div>` : ""}
    ${addr ? `<div class="ct-sub">${escapeHtml(addr)}</div>` : ""}
    ${acts.length ? `<div class="ct-acts">${acts.join("")}</div>` : ""}
  </div>`;
}
