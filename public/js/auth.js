// Crossroads — authentication
(function () {
  'use strict';

  const API = '';

  if (localStorage.getItem('cr_token')) {
    window.location.href = '/app.html';
    return;
  }

  /* Warm the server up as soon as the landing page loads. Render's free plan
     sleeps after ~15 minutes idle, so without this the first login attempt
     would sit through the whole cold start. Firing /health now means the
     instance is usually awake by the time the visitor submits the form. */
  (function warmUp() {
    try {
      fetch('/health', { cache: 'no-store' }).catch(function () {});
    } catch (e) { /* ignore */ }
  })();

  /* ---------------- Disable native right-click context menu ---------------- */
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const resetForm = document.getElementById('reset-form');
  const formTitle = document.getElementById('form-title');
  const formSubtitle = document.getElementById('form-subtitle');
  const globalError = document.getElementById('global-error');

  function showError(msg) {
    globalError.textContent = msg;
    globalError.classList.remove('show', 'ok');
    // retrigger shake animation
    void globalError.offsetWidth;
    globalError.classList.add('show');
  }
  function showNotice(msg) {
    globalError.textContent = msg;
    globalError.classList.remove('show');
    void globalError.offsetWidth;
    globalError.classList.add('show', 'ok');
  }
  function clearError() { globalError.classList.remove('show', 'ok'); globalError.textContent = ''; }
  function markInvalid(id, invalid) { document.getElementById(id).classList.toggle('invalid', invalid); }

  /* ---------------- Button ripple ---------------- */
  function attachRipple(btn) {
    btn.addEventListener('pointerdown', (e) => {
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - rect.left - size / 2) + 'px';
      span.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(span);
      setTimeout(() => span.remove(), 620);
    });
  }
  document.querySelectorAll('.btn').forEach(attachRipple);

  /* ---------------- Password peek ---------------- */
  document.querySelectorAll('.peek').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });

  /* ---------------- Form switching ---------------- */
  const FORMS = { login: loginForm, register: registerForm, reset: resetForm };
  function swapForms(show) {
    const to = FORMS[show] || loginForm;
    [loginForm, registerForm, resetForm].forEach((f) => { f.classList.add('hidden'); f.classList.remove('swap-in'); });
    to.classList.remove('hidden');
    void to.offsetWidth;
    to.classList.add('swap-in');
    if (show === 'register') {
      formTitle.textContent = 'Create your account';
      formSubtitle.textContent = 'Pick a username and set a password to get started.';
    } else if (show === 'reset') {
      formTitle.textContent = 'Reset your password';
      formSubtitle.textContent = 'Enter your username and tag, then choose a new password.';
    } else {
      formTitle.textContent = 'Welcome back';
      formSubtitle.textContent = 'Sign in to continue to your workspace.';
    }
    clearError();
  }
  const toRegister = document.getElementById('to-register');
  const toLogin = document.getElementById('to-login');
  const toReset = document.getElementById('to-reset');
  const toLogin2 = document.getElementById('to-login-2');
  function wireSwitch(el, target) {
    if (!el) return;
    el.addEventListener('click', () => swapForms(target));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swapForms(target); } });
  }
  wireSwitch(toRegister, 'register');
  wireSwitch(toLogin, 'login');
  wireSwitch(toReset, 'reset');
  wireSwitch(toLogin2, 'login');

  /* ---------------- Fetch helper ---------------- */
  async function post(url, body) {
    const res = await fetch(API + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong');
      err.twofaRequired = !!data.twofa_required;
      throw err;
    }
    return data;
  }

  function setLoading(btn, loading, label) {
    btn.disabled = loading;
    const span = btn.querySelector('.btn-label');
    if (span) span.textContent = loading ? label : btn.dataset.label;
  }
  document.getElementById('login-btn').dataset.label = 'Sign In';
  document.getElementById('register-btn').dataset.label = 'Create Account';
  document.getElementById('reset-btn').dataset.label = 'Reset Password';

  /* ---------------- Username availability ---------------- */
  const usernameInput = document.getElementById('reg-username');
  const userField = document.getElementById('f-reg-user');
  const userInd = document.getElementById('reg-user-ind');
  const userErr = document.getElementById('reg-user-err');
  const userOk = document.getElementById('reg-user-ok');
  let usernameAvailable = false;
  let checkTimer = null;

  function setUserState(state, message) {
    userField.classList.remove('invalid', 'valid');
    userInd.classList.remove('ok', 'bad', 'load');
    if (state === 'ok') { userField.classList.add('valid'); userInd.classList.add('ok'); }
    else if (state === 'bad') { userField.classList.add('invalid'); userInd.classList.add('bad'); }
    else if (state === 'load') { userInd.classList.add('load'); }
    if (message && state === 'bad') userErr.textContent = message;
    if (message && state === 'ok') userOk.textContent = message;
  }

  usernameInput.addEventListener('input', () => {
    const val = usernameInput.value.trim();
    usernameAvailable = false;
    clearTimeout(checkTimer);
    if (!val) { userField.classList.remove('invalid', 'valid'); userInd.classList.remove('ok', 'bad', 'load'); return; }
    if (val.length < 2 || val.length > 32) { setUserState('bad', 'Username must be 2 to 32 characters.'); return; }
    if (!/^[a-zA-Z0-9._]+$/.test(val)) { setUserState('bad', 'Only letters, numbers, periods and underscores are allowed.'); return; }
    setUserState('load');
    checkTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/check-username?username=' + encodeURIComponent(val));
        const data = await res.json();
        if (usernameInput.value.trim() !== val) return;
        if (data.available) { usernameAvailable = true; setUserState('ok', 'Username is available.'); }
        else { usernameAvailable = false; setUserState('bad', data.reason || 'That username is already taken.'); }
      } catch (e) { userInd.classList.remove('ok', 'bad', 'load'); }
    }, 350);
  });

  /* ---------------- Login ---------------- */
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;
    const codeField = document.getElementById('f-login-code');
    const codeInput = document.getElementById('login-code');
    const code = codeInput ? codeInput.value.trim() : '';
    const trustInput = document.getElementById('login-trust');
    const trustDevice = !!(trustInput && trustInput.checked);
    let deviceToken = '';
    try { deviceToken = localStorage.getItem('cr_trusted_device') || ''; } catch (e) { /* ignore */ }
    let ok = true;
    if (!identifier) { markInvalid('f-login-id', true); ok = false; } else markInvalid('f-login-id', false);
    if (!password) { markInvalid('f-login-pass', true); ok = false; } else markInvalid('f-login-pass', false);
    if (!ok) return;

    const btn = document.getElementById('login-btn');
    setLoading(btn, true, 'Signing in…');
    try {
      const data = await post('/api/login', { identifier, password, code, trust_device: trustDevice, device_token: deviceToken });
      localStorage.setItem('cr_token', data.token);
      localStorage.setItem('cr_user', JSON.stringify(data.user));
      if (data.trusted_device_token) {
        try { localStorage.setItem('cr_trusted_device', data.trusted_device_token); } catch (e) { /* ignore */ }
      }
      window.location.href = '/app.html';
    } catch (err) {
      if (err && err.twofaRequired) {
        if (codeField) codeField.classList.remove('hidden');
        if (codeInput) { codeInput.focus(); }
        showError(err.message || 'Enter your two-step code to continue.');
      } else {
        showError(err.message);
      }
      setLoading(btn, false);
    }
  });

  /* ---------------- Two-step recovery ----------------
     Reached from "Lost your authenticator?" on the code screen. Reuses the
     username and password already typed into the form, so the owner never has
     to retype anything. The server mints a *new* secret and turns two-step off
     until it is confirmed — the old secret is never revealed. */
  const recoverBtn = document.getElementById('login-recover');
  const recoverBox = document.getElementById('login-recover-box');
  if (recoverBtn) {
    recoverBtn.addEventListener('click', async () => {
      clearError();
      const identifier = document.getElementById('login-identifier').value.trim();
      const password = document.getElementById('login-password').value;
      if (!identifier || !password) {
        showError('Enter your username and password above, then click reset again.');
        return;
      }
      const sure = window.confirm('Reset your two-step code?\n\nThis turns two-step login off and gives you a brand-new code. Your old authenticator entry will stop working.');
      if (!sure) return;
      recoverBtn.disabled = true;
      recoverBtn.textContent = 'Resetting\u2026';
      try {
        const d = await post('/api/2fa/recover', { identifier, password });
        recoverBox.classList.remove('hidden');
        recoverBox.innerHTML =
          '<div class="rb-title">Your new two-step code</div>' +
          '<div class="rb-sub">Two-step login is now <strong>off</strong>. Sign in with your password, then re-enable it in Settings \u2192 Two-Step Login using the secret below.</div>' +
          '<div class="rb-secret"><span>Secret</span><code>' + d.secret + '</code></div>' +
          '<div class="rb-code"><span>Current code</span><strong>' + d.code + '</strong></div>';
        document.getElementById('login-code').value = d.code;
        recoverBtn.textContent = 'Code reset \u2014 sign in below';
      } catch (err) {
        showError(err.message || 'Could not reset your code.');
        recoverBtn.disabled = false;
        recoverBtn.textContent = 'Lost your authenticator? Reset your code';
      }
    });
  }

  /* ---------------- Register ---------------- */
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const username = usernameInput.value.trim();
    const password = document.getElementById('reg-password').value;
    let ok = true;
    if (username.length < 2 || username.length > 32 || !/^[a-zA-Z0-9._]+$/.test(username)) { setUserState('bad', 'Please choose a valid username.'); ok = false; }
    if (password.length < 6) { markInvalid('f-reg-pass', true); ok = false; } else markInvalid('f-reg-pass', false);
    if (!ok) return;
    if (!usernameAvailable) { showError('Please choose an available username before continuing.'); return; }

    const btn = document.getElementById('register-btn');
    setLoading(btn, true, 'Creating account…');
    try {
      const data = await post('/api/register', { username, password });
      localStorage.setItem('cr_token', data.token);
      localStorage.setItem('cr_user', JSON.stringify(data.user));
      window.location.href = '/app.html';
    } catch (err) {
      showError(err.message);
      setLoading(btn, false);
    }
  });

  /* ---------------- Reset password ---------------- */
  const resetIdInput = document.getElementById('reset-identifier');
  const resetPassInput = document.getElementById('reset-password');
  const resetPass2Input = document.getElementById('reset-password2');
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const identifier = resetIdInput.value.trim();
    const pw = resetPassInput.value;
    const pw2 = resetPass2Input.value;
    let ok = true;
    if (!identifier || !identifier.includes('#')) { markInvalid('f-reset-id', true); ok = false; } else markInvalid('f-reset-id', false);
    if (pw.length < 6) { markInvalid('f-reset-pass', true); ok = false; } else markInvalid('f-reset-pass', false);
    if (pw !== pw2) { markInvalid('f-reset-pass2', true); ok = false; } else markInvalid('f-reset-pass2', false);
    if (!ok) return;

    const btn = document.getElementById('reset-btn');
    setLoading(btn, true, 'Resetting\u2026');
    try {
      await post('/api/password/reset', { identifier, new_password: pw });
      resetPassInput.value = '';
      resetPass2Input.value = '';
      swapForms('login');
      document.getElementById('login-identifier').value = identifier;
      document.getElementById('login-password').value = '';
      showNotice('Password updated. Sign in with your new password.');
      document.getElementById('login-password').focus();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(btn, false);
    }
  });
})();
