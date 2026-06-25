// Écran 2FA — setup (TOTP ou Email) et vérification.
// Utilisé après POST /auth/login quand la réponse contient twofa_required ou
// twofa_setup_required. Tous les appels /2fa/* partent avec credentials:"include"
// et le pending_token en Authorization Bearer.
import { api, ApiError } from "../api.js";

// ---------------------------------------------------------------------------
// QR Code — via la lib qrcode-generator (vendue dans js/vendor/qrcode.js,
// exposée en global window.qrcode par index.html ; aucun service externe).
// ---------------------------------------------------------------------------
function qrSvgFor(text) {
  try {
    if (typeof window === "undefined" || !window.qrcode) return null;
    const qr = window.qrcode(0, "M"); // 0 = version auto, M = correction moyenne
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4 });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers 2FA API
// ---------------------------------------------------------------------------
function twofaApi(path, { method = "POST", body, pendingToken } = {}) {
  return api(path, {
    method,
    body,
    auth: false,
    bearer: pendingToken,
    credentials: "include",
  });
}

// ---------------------------------------------------------------------------
// Rendu HTML commun
// ---------------------------------------------------------------------------
function wrapCard(title, body) {
  return `
    <div class="login-wrap">
      <div class="login-logo">
        <strong style="font-size:1.25rem;color:#fff">Swiss Piscine</strong><br>
        <span style="opacity:.8;font-size:.9rem">Authentification à deux facteurs</span>
      </div>
      <div class="login-card">
        <h2>${title}</h2>
        <p class="form-error" id="tfa-error"></p>
        ${body}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Mode verify : on connaît déjà la méthode 2FA de l'employé
// ---------------------------------------------------------------------------
async function renderVerify(root, { pendingToken, isEmail, onDone }) {
  const resendBlock = isEmail
    ? `<button type="button" class="btn secondary" id="tfa-resend" style="min-height:40px">Renvoyer le code</button>`
    : "";
  root.innerHTML = wrapCard("Vérification 2FA", `
    <p class="sub">${isEmail ? "Entrez le code reçu par email." : "Entrez le code de votre application d'authentification."}</p>
    <form id="tfa-form" novalidate>
      <div class="field">
        <label for="tfa-code">Code à 6 chiffres</label>
        <input id="tfa-code" type="text" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" pattern="[0-9]{6}" required style="letter-spacing:.3em;font-size:1.3rem;text-align:center" />
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0 14px;font-size:.9rem;cursor:pointer">
        <input type="checkbox" id="tfa-trust"> Faire confiance à cet appareil (30 jours)
      </label>
      ${resendBlock}
      <button class="btn" type="submit" id="tfa-btn">Vérifier</button>
    </form>`);

  const errEl = root.querySelector("#tfa-error");
  const btn = root.querySelector("#tfa-btn");
  const form = root.querySelector("#tfa-form");

  if (isEmail) {
    // I2 — envoyer automatiquement le code à l'arrivée sur l'écran verify email
    (async () => {
      try {
        await twofaApi("/2fa/email/resend", { pendingToken });
        errEl.style.color = "var(--ok, green)";
        errEl.textContent = "Code envoyé par email.";
        setTimeout(() => { errEl.textContent = ""; errEl.style.color = ""; }, 3000);
      } catch (err) {
        // Si throttle (429) ou autre erreur, on n'affiche rien de bloquant
        if (err instanceof ApiError && err.status === 429) {
          errEl.style.color = "var(--ok, green)";
          errEl.textContent = "Un code a déjà été envoyé récemment.";
          setTimeout(() => { errEl.textContent = ""; errEl.style.color = ""; }, 4000);
        }
      }
    })();

    root.querySelector("#tfa-resend").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        await twofaApi("/2fa/email/resend", { pendingToken });
        errEl.style.color = "var(--ok, green)";
        errEl.textContent = "Code renvoyé.";
        setTimeout(() => { errEl.textContent = ""; errEl.style.color = ""; }, 3000);
      } catch (err) {
        errEl.style.color = "";
        errEl.textContent = err instanceof ApiError ? err.message : "Erreur lors du renvoi.";
      } finally {
        setTimeout(() => { e.currentTarget.disabled = false; }, 60000);
      }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = ""; errEl.style.color = "";
    const code = root.querySelector("#tfa-code").value.trim();
    const trust_device = root.querySelector("#tfa-trust").checked;
    if (!/^\d{6}$/.test(code)) { errEl.textContent = "Code à 6 chiffres requis."; return; }
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const resp = await twofaApi("/2fa/verify", { body: { code, trust_device }, pendingToken });
      onDone(resp);
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : "Vérification impossible.";
      btn.disabled = false; btn.textContent = "Vérifier";
    }
  });
}

// ---------------------------------------------------------------------------
// Mode setup — choix de la méthode puis configuration
// ---------------------------------------------------------------------------
async function renderSetup(root, { pendingToken, onDone }) {
  // Récupérer le statut pour savoir si can_email
  let canEmail = false;
  try {
    const status = await twofaApi("/2fa/status", { method: "GET", pendingToken });
    canEmail = !!status.can_email;
  } catch {}

  // Si can_email : afficher le choix de méthode d'abord
  if (canEmail) {
    root.innerHTML = wrapCard("Configurer la 2FA", `
      <p class="sub">Choisissez votre méthode de vérification :</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
        <button class="btn" id="choose-totp">Authenticator (application)</button>
        <button class="btn secondary" id="choose-email">Email</button>
      </div>`);
    root.querySelector("#choose-totp").addEventListener("click", () => setupTotp(root, { pendingToken, onDone }));
    root.querySelector("#choose-email").addEventListener("click", () => setupEmail(root, { pendingToken, onDone }));
  } else {
    await setupTotp(root, { pendingToken, onDone });
  }
}

// --- TOTP setup ---
async function setupTotp(root, { pendingToken, onDone }) {
  root.innerHTML = wrapCard("Configurer Authenticator", `<div class="placeholder">Chargement…</div>`);
  const errEl = root.querySelector("#tfa-error");

  let secret, otpauthUri;
  try {
    const data = await twofaApi("/2fa/setup/totp/start", { pendingToken });
    secret = data.secret;
    otpauthUri = data.otpauth_uri;
  } catch (err) {
    errEl.textContent = err instanceof ApiError ? err.message : "Erreur lors de l'initialisation TOTP.";
    return;
  }

  const qrSvg = otpauthUri ? qrSvgFor(otpauthUri) : null;
  const qrBlock = qrSvg
    ? `<div style="display:flex;justify-content:center;margin:12px 0">${qrSvg}</div>`
    : "";

  root.querySelector(".login-card").innerHTML = `
    <h2>Configurer Authenticator</h2>
    <p class="form-error" id="tfa-error"></p>
    <p class="sub">Scannez le QR code dans votre application (Google Authenticator, Authy…) ou saisissez le secret manuellement.</p>
    ${qrBlock}
    <div style="background:var(--aqua-soft,#e8f4fb);border-radius:10px;padding:10px 12px;margin-bottom:12px;word-break:break-all">
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:4px">Secret (saisie manuelle)</div>
      <code style="font-size:.95rem;letter-spacing:.1em">${secret}</code>
    </div>
    <form id="tfa-form" novalidate>
      <div class="field">
        <label for="tfa-code">Code de confirmation (6 chiffres)</label>
        <input id="tfa-code" type="text" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" pattern="[0-9]{6}" required style="letter-spacing:.3em;font-size:1.3rem;text-align:center" />
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0 14px;font-size:.9rem;cursor:pointer">
        <input type="checkbox" id="tfa-trust"> Faire confiance à cet appareil (30 jours)
      </label>
      <button class="btn" type="submit" id="tfa-btn">Confirmer</button>
    </form>`;

  const errEl2 = root.querySelector("#tfa-error");
  const btn = root.querySelector("#tfa-btn");
  root.querySelector("#tfa-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl2.textContent = "";
    const code = root.querySelector("#tfa-code").value.trim();
    const trust_device = root.querySelector("#tfa-trust").checked;
    if (!/^\d{6}$/.test(code)) { errEl2.textContent = "Code à 6 chiffres requis."; return; }
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const resp = await twofaApi("/2fa/setup/totp/confirm", { body: { code, trust_device }, pendingToken });
      onDone(resp);
    } catch (err) {
      errEl2.textContent = err instanceof ApiError ? err.message : "Code incorrect.";
      btn.disabled = false; btn.textContent = "Confirmer";
    }
  });
}

// --- Email setup ---
async function setupEmail(root, { pendingToken, onDone }) {
  root.innerHTML = wrapCard("Configurer 2FA par email", `<div class="placeholder">Envoi du code…</div>`);
  const errEl = root.querySelector("#tfa-error");

  try {
    await twofaApi("/2fa/setup/email/start", { pendingToken });
  } catch (err) {
    errEl.textContent = err instanceof ApiError ? err.message : "Erreur lors de l'envoi du code.";
    return;
  }

  root.querySelector(".login-card").innerHTML = `
    <h2>Configurer 2FA par email</h2>
    <p class="form-error" id="tfa-error"></p>
    <p class="sub">Un code a été envoyé à votre adresse email professionnelle.</p>
    <form id="tfa-form" novalidate>
      <div class="field">
        <label for="tfa-code">Code à 6 chiffres</label>
        <input id="tfa-code" type="text" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" pattern="[0-9]{6}" required style="letter-spacing:.3em;font-size:1.3rem;text-align:center" />
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0 14px;font-size:.9rem;cursor:pointer">
        <input type="checkbox" id="tfa-trust"> Faire confiance à cet appareil (30 jours)
      </label>
      <button type="button" class="btn secondary" id="tfa-resend" style="min-height:40px">Renvoyer le code</button>
      <button class="btn" type="submit" id="tfa-btn">Confirmer</button>
    </form>`;

  const errEl2 = root.querySelector("#tfa-error");
  const btn = root.querySelector("#tfa-btn");
  const resend = root.querySelector("#tfa-resend");

  resend.addEventListener("click", async () => {
    resend.disabled = true;
    try {
      await twofaApi("/2fa/email/resend", { pendingToken });
      errEl2.style.color = "var(--ok, green)";
      errEl2.textContent = "Code renvoyé.";
      setTimeout(() => { errEl2.textContent = ""; errEl2.style.color = ""; }, 3000);
    } catch (err) {
      errEl2.style.color = "";
      errEl2.textContent = err instanceof ApiError ? err.message : "Erreur lors du renvoi.";
    } finally {
      setTimeout(() => { resend.disabled = false; }, 60000);
    }
  });

  root.querySelector("#tfa-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl2.textContent = ""; errEl2.style.color = "";
    const code = root.querySelector("#tfa-code").value.trim();
    const trust_device = root.querySelector("#tfa-trust").checked;
    if (!/^\d{6}$/.test(code)) { errEl2.textContent = "Code à 6 chiffres requis."; return; }
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const resp = await twofaApi("/2fa/setup/email/confirm", { body: { code, trust_device }, pendingToken });
      onDone(resp);
    } catch (err) {
      errEl2.textContent = err instanceof ApiError ? err.message : "Code incorrect.";
      btn.disabled = false; btn.textContent = "Confirmer";
    }
  });
}

// ---------------------------------------------------------------------------
// Point d'entrée public
// ---------------------------------------------------------------------------
// opts : { mode: "setup"|"verify", pendingToken: string, onDone: fn(tokenResponse) }
// onDone reçoit {access_token, refresh_token, expires_in} et doit appeler tokens.set + profile.set.
export async function mountTwofa(root, { mode, pendingToken, onDone }) {
  document.body.classList.add("screen-login");
  root.innerHTML = `<div class="login-wrap"><div class="login-card"><div class="placeholder">Chargement…</div></div></div>`;

  const done = (tokenResponse) => {
    document.body.classList.remove("screen-login");
    onDone(tokenResponse);
  };

  if (mode === "setup") {
    // Peut-être que la méthode verify est email — on vérifie lors du setup
    await renderSetup(root, { pendingToken, onDone: done });
  } else {
    // mode verify : récupérer la méthode pour savoir si bouton "renvoyer"
    let isEmail = false;
    try {
      const status = await twofaApi("/2fa/status", { method: "GET", pendingToken });
      isEmail = status.method === "email";
    } catch {}
    await renderVerify(root, { pendingToken, isEmail, onDone: done });
  }
}
