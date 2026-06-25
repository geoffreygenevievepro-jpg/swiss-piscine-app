// Écran de connexion : login + PIN, câblé sur l'API. Plein écran (hors shell).
import { login, getMe, ApiError } from "../api.js";
import { profile } from "../store.js";
import { icon } from "../icons.js";

export function renderLogin(root, onSuccess) {
  document.body.classList.add("screen-login");
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-logo">
        <div style="width:56px;height:56px;border-radius:15px;margin:0 auto 12px;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;color:#fff">${icon("wave", "icon-lg")}</div>
        <strong style="font-size:1.25rem;color:#fff">Swiss Piscine</strong><br>
        <span style="opacity:.8;font-size:.9rem">Espace équipe</span>
      </div>
      <form class="login-card" id="login-form" novalidate>
        <h2>Connexion</h2>
        <p class="sub">Entre ton identifiant et ton code PIN.</p>
        <p class="form-error" id="login-error"></p>
        <div class="field">
          <label for="login">Identifiant</label>
          <input id="login" name="login" type="text" autocomplete="username"
                 autocapitalize="none" spellcheck="false" inputmode="text" required />
        </div>
        <div class="field">
          <label for="pin">Code PIN</label>
          <input id="pin" name="pin" class="pin" type="password" inputmode="numeric"
                 autocomplete="current-password" maxlength="12" required />
        </div>
        <button class="btn" type="submit" id="login-btn">Se connecter</button>
      </form>
    </div>`;

  const form = root.querySelector("#login-form");
  const errEl = root.querySelector("#login-error");
  const btn = root.querySelector("#login-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const loginName = form.login.value.trim().toLowerCase();
    const pin = form.pin.value.trim();
    if (!loginName || pin.length < 4) {
      errEl.textContent = "Renseigne ton identifiant et ton PIN.";
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      await login(loginName, pin);
      profile.set(await getMe());
      document.body.classList.remove("screen-login");
      onSuccess();
    } catch (err) {
      errEl.textContent = err instanceof ApiError
        ? err.message
        : "Connexion impossible. Vérifie ta connexion réseau.";
      btn.disabled = false;
      btn.textContent = "Se connecter";
    }
  });
}
