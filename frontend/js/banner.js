// Bannière « Message à l'équipe » : affichée à tous, éditable par manager/admin.
import { api } from "./api.js";
import { escapeHtml, toast } from "./util.js";
import { icon } from "./icons.js";

export function messageBanner(ann, canEdit) {
  const text = (ann && ann.text) || "";
  const author = (ann && ann.author) || "";
  if (!canEdit) {
    if (!text) return "";
    return `<div class="msg-banner">
      <span class="msg-ic">${icon("megaphone")}</span>
      <div class="msg-body"><div class="msg-text">${escapeHtml(text)}</div>${author ? `<div class="msg-by">— ${escapeHtml(author)}</div>` : ""}</div>
    </div>`;
  }
  return `<div class="msg-banner edit">
    <div class="msg-head"><span class="msg-ic">${icon("megaphone")}</span><strong>Message à l'équipe</strong></div>
    <textarea id="msg-text" rows="2" placeholder="Écris un message visible par toute l'équipe…">${escapeHtml(text)}</textarea>
    <div class="msg-foot">
      <span class="msg-saved" id="msg-saved">${author ? "Publié par " + escapeHtml(author) : ""}</span>
      <button class="btn" id="msg-save">${icon("check", "icon-sm")} Publier</button>
    </div>
  </div>`;
}

export function wireBanner(container) {
  const save = container.querySelector("#msg-save");
  if (!save) return;
  save.addEventListener("click", async () => {
    const ta = container.querySelector("#msg-text");
    save.disabled = true;
    try {
      await api("/announcement", { method: "PUT", body: { text: ta.value } });
      const s = container.querySelector("#msg-saved");
      if (s) s.textContent = "Message publié";
      toast("Message publié");
    } catch { toast("Échec de la publication."); }
    save.disabled = false;
  });
}
