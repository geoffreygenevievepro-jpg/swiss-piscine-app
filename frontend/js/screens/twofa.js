// Écran 2FA — setup (TOTP ou Email) et vérification.
// Utilisé après POST /auth/login quand la réponse contient twofa_required ou
// twofa_setup_required. Tous les appels /2fa/* partent avec credentials:"include"
// et le pending_token en Authorization Bearer.
import { api, ApiError } from "../api.js";

// ---------------------------------------------------------------------------
// QR Code generator — pur JS, auto-contenu (aucun service externe).
// Implémentation simplifiée Mode Byte, masque 0, version auto (1-10).
// Suffisant pour les URI otpauth (< 160 chars courants).
// ---------------------------------------------------------------------------
const QR = (() => {
  // Tables GF(256) pour Reed-Solomon
  const EXP = new Uint8Array(256);
  const LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x = x << 1; if (x & 0x100) x ^= 0x11D;
    }
    EXP[255] = EXP[0];
  })();
  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[(LOG[a] + LOG[b]) % 255];
  }
  function rsECC(data, nEcc) {
    const gen = rsGenerator(nEcc);
    const msg = [...data, ...new Array(nEcc).fill(0)];
    for (let i = 0; i < data.length; i++) {
      const coeff = msg[i];
      if (coeff !== 0) for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coeff);
    }
    return msg.slice(data.length);
  }
  function rsGenerator(degree) {
    let g = [1];
    for (let i = 0; i < degree; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gfMul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }

  // Caractéristiques par version (1-10) pour le niveau de correction M
  const VERSION_INFO = [
    null,
    { size: 21, data: 16, ecc: 10, blocks: 1 },  // v1
    { size: 25, data: 28, ecc: 16, blocks: 1 },  // v2
    { size: 29, data: 44, ecc: 26, blocks: 1 },  // v3
    { size: 33, data: 64, ecc: 18, blocks: 2 },  // v4  (2 blocs, simplifié)
    { size: 37, data: 86, ecc: 24, blocks: 2 },  // v5
    { size: 41, data: 108, ecc: 16, blocks: 4 }, // v6
    { size: 45, data: 124, ecc: 18, blocks: 4 }, // v7
    { size: 49, data: 154, ecc: 22, blocks: 2 }, // v8
    { size: 53, data: 182, ecc: 22, blocks: 3 }, // v9
    { size: 57, data: 216, ecc: 26, blocks: 4 }, // v10
  ];

  // Polynômes de format (niveau M, masque 0) pré-calculés selon spec QR
  // format info pour masque 0 niveau M = 101010000010010 XOR 101010101010101 = ...
  // On n'a pas besoin de les calculer ici : on les encode directement dans les bits.
  const FORMAT_INFO_M_MASK0 = [1,0,1,0,1,0,0,0,0,0,1,0,0,1,0]; // 15 bits

  function encodeData(text) {
    const bytes = new TextEncoder().encode(text);
    const dataLen = bytes.length;
    // Mode Byte (0100) + longueur (8 bits) + données + terminateur
    const bits = [];
    const pushBits = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    pushBits(0b0100, 4); // mode byte
    pushBits(dataLen, 8);
    for (const b of bytes) pushBits(b, 8);
    return { bits, dataLen };
  }

  function buildMatrix(version) {
    const sz = VERSION_INFO[version].size;
    // null = libre, true = foncé, false = clair
    const m = Array.from({ length: sz }, () => new Array(sz).fill(null));
    // Finder patterns
    const finder = (r, c) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= sz || cc < 0 || cc >= sz) continue;
        const inSquare = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        m[rr][cc] = inSquare ? (onBorder || inInner) : false;
      }
    };
    finder(0, 0); finder(0, sz - 7); finder(sz - 7, 0);
    // Timing patterns
    for (let i = 8; i < sz - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
    // Dark module
    m[4 * version + 9][8] = true;
    return m;
  }

  function placeFormatInfo(m, sz) {
    const fi = FORMAT_INFO_M_MASK0;
    // Autour du finder TL (rangée 8 et colonne 8)
    const pos = [0,1,2,3,4,5,7,8]; // skip 6 (timing)
    // Colonne 8 (bits 0..7) de haut en bas
    for (let i = 0; i < 6; i++) m[i][8] = !!fi[i];
    m[7][8] = !!fi[6];
    m[8][8] = !!fi[7];
    // Rangée 8 (bits 8..14) de droite à gauche depuis colonne 7
    for (let i = 0; i < 7; i++) m[8][7 - i] = !!fi[8 + i];
    // Copie dans finder TR et BL
    for (let i = 0; i < 7; i++) m[8][sz - 7 + i] = !!fi[i];
    for (let i = 0; i < 8; i++) m[sz - 8 + i][8] = !!fi[7 + i];
  }

  function placeDataBits(m, sz, dataBits) {
    // Placement des données en zig-zag de droite à gauche en bas en haut
    let bitIdx = 0;
    let dir = -1; // -1 = montée, 1 = descente
    let row = sz - 1;
    for (let col = sz - 1; col >= 1; col -= 2) {
      if (col === 6) col--; // sauter colonne timing
      for (let r = row; dir === -1 ? r >= 0 : r < sz; r += dir) {
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (m[r][c] !== null) continue; // module réservé
          const bit = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
          // Masque 0 : (r + c) % 2 === 0 → inverser
          m[r][c] = ((r + c) % 2 === 0) ? !bit : !!bit;
        }
      }
      row = dir === -1 ? 0 : sz - 1;
      dir = -dir;
    }
  }

  // Génère un SVG QR code pour le texte donné
  function generate(text, cellPx = 4) {
    const { bits, dataLen } = encodeData(text);
    // Choisir la version minimale
    let version = null;
    for (let v = 1; v <= 10; v++) {
      if (dataLen <= VERSION_INFO[v].data) { version = v; break; }
    }
    if (!version) return null; // trop long (> ~216 octets)

    const info = VERSION_INFO[version];
    const sz = info.size;

    // Compléter les bits jusqu'à capacité en octets
    const totalBits = info.data * 8;
    // Terminateur
    for (let i = 0; i < 4 && bits.length < totalBits; i++) bits.push(0);
    // Aligner à 8
    while (bits.length % 8 !== 0) bits.push(0);
    // Remplir avec les octets de rembourrage alternés
    const PAD = [0xEC, 0x11];
    let pi = 0;
    while (bits.length < totalBits) {
      const p = PAD[pi++ % 2];
      for (let i = 7; i >= 0; i--) bits.push((p >> i) & 1);
    }

    // Convertir bits en octets de données
    const dataBytes = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
      dataBytes.push(b);
    }

    // ECC (simplifié : un seul bloc — acceptable pour v1-v3 ; pour v4+, multi-blocs)
    // Pour la portée de cet usage (URI otpauth ~80-150 chars → v4-v5), on fait un seul bloc ECC
    const eccBytes = rsECC(dataBytes, info.ecc);
    const allBytes = [...dataBytes, ...eccBytes];

    // Bits finaux
    const allBits = [];
    for (const byte of allBytes) for (let i = 7; i >= 0; i--) allBits.push((byte >> i) & 1);

    // Construire la matrice
    const m = buildMatrix(version);
    placeDataBits(m, sz, allBits);
    placeFormatInfo(m, sz);

    // Rendu SVG (quiet zone 4 modules)
    const quiet = 4;
    const total = (sz + 2 * quiet) * cellPx;
    const rects = [];
    for (let r = 0; r < sz; r++) {
      for (let c = 0; c < sz; c++) {
        if (m[r][c]) {
          rects.push(`<rect x="${(c + quiet) * cellPx}" y="${(r + quiet) * cellPx}" width="${cellPx}" height="${cellPx}"/>`);
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" style="display:block;max-width:220px;height:auto">
  <rect width="${total}" height="${total}" fill="#fff"/>
  <g fill="#000">${rects.join("")}</g>
</svg>`;
  }

  return { generate };
})();

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

  const qrSvg = otpauthUri ? QR.generate(otpauthUri, 4) : null;
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
