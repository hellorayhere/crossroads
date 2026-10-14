// Crossroads — authentication
const API = '';

if (localStorage.getItem('cr_token')) {
  window.location.href = '/app.html';
}

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const globalError = document.getElementById('global-error');

function showError(msg) { globalError.textContent = msg; globalError.classList.add('show'); }
function clearError() { globalError.classList.remove('show'); globalError.textContent = ''; }
function markInvalid(id, invalid) { document.getElementById(id).classList.toggle('invalid', invalid); }

document.getElementById('to-register').addEventListener('click', () => {
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  formTitle.textContent = 'Create your account';
  formSubtitle.textContent = 'Pick a username and set a password to get started.';
  clearError();
});
document.getElementById('to-login').addEventListener('click', () => {
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  formTitle.textContent = 'Welcome back';
  formSubtitle.textContent = 'Sign in to continue to your workspace.';
  clearError();
});

async function post(url, body) {
  const res = await fetch(API + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

/* -------- Username availability -------- */
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
  if (state === 'ok') { userField.classList.add('valid'); userInd.classList.add('ok'); userInd.className = 'check-ind fa-solid fa-check'; }
  else if (state === 'bad') { userField.classList.add('invalid'); userInd.className = 'check-ind fa-solid fa-xmark'; }
  else if (state === 'load') { userInd.className = 'check-ind fa-solid fa-spinner fa-spin'; }
  if (message && state === 'bad') userErr.textContent = message;
  if (message && state === 'ok') userOk.textContent = message;
}

usernameInput.addEventListener('input', () => {
  const val = usernameInput.value.trim();
  usernameAvailable = false;
  clearTimeout(checkTimer);
  if (!val) { userField.classList.remove('invalid', 'valid'); userInd.className = 'check-ind fa-solid'; return; }
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
    } catch (e) { userInd.className = 'check-ind fa-solid'; }
  }, 350);
});

/* -------- Login -------- */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const identifier = document.getElementById('login-identifier').value.trim();
  const password = document.getElementById('login-password').value;
  let ok = true;
  if (!identifier) { markInvalid('f-login-id', true); ok = false; } else markInvalid('f-login-id', false);
  if (!password) { markInvalid('f-login-pass', true); ok = false; } else markInvalid('f-login-pass', false);
  if (!ok) return;

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await post('/api/login', { identifier, password });
    localStorage.setItem('cr_token', data.token);
    localStorage.setItem('cr_user', JSON.stringify(data.user));
    window.location.href = '/app.html';
  } catch (err) {
    showError(err.message);
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

/* -------- Register -------- */
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
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const data = await post('/api/register', { username, password });
    localStorage.setItem('cr_token', data.token);
    localStorage.setItem('cr_user', JSON.stringify(data.user));
    window.location.href = '/app.html';
  } catch (err) {
    showError(err.message);
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});
