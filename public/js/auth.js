// Crossroads auth page logic
const API = '';

// If already logged in, go straight to the app
if (localStorage.getItem('cr_token')) {
  window.location.href = '/app.html';
}

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const globalError = document.getElementById('global-error');

function showError(msg) {
  globalError.textContent = msg;
  globalError.classList.add('show');
}
function clearError() {
  globalError.classList.remove('show');
  globalError.textContent = '';
}
function markInvalid(id, invalid) {
  document.getElementById(id).classList.toggle('invalid', invalid);
}

document.getElementById('to-register').addEventListener('click', () => {
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  formTitle.textContent = 'Create an account';
  formSubtitle.textContent = 'Join Crossroads and start chatting!';
  clearError();
});
document.getElementById('to-login').addEventListener('click', () => {
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  formTitle.textContent = 'Welcome back!';
  formSubtitle.textContent = "We're so excited to see you again!";
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
  btn.disabled = true; btn.textContent = 'Logging in...';
  try {
    const data = await post('/api/login', { identifier, password });
    localStorage.setItem('cr_token', data.token);
    localStorage.setItem('cr_user', JSON.stringify(data.user));
    window.location.href = '/app.html';
  } catch (err) {
    showError(err.message);
    btn.disabled = false; btn.textContent = 'Log In';
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const email = document.getElementById('reg-email').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  let ok = true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { markInvalid('f-reg-email', true); ok = false; } else markInvalid('f-reg-email', false);
  if (username.length < 2 || username.length > 32) { markInvalid('f-reg-user', true); ok = false; } else markInvalid('f-reg-user', false);
  if (password.length < 6) { markInvalid('f-reg-pass', true); ok = false; } else markInvalid('f-reg-pass', false);
  if (!ok) return;

  const btn = document.getElementById('register-btn');
  btn.disabled = true; btn.textContent = 'Creating account...';
  try {
    const data = await post('/api/register', { email, username, password });
    localStorage.setItem('cr_token', data.token);
    localStorage.setItem('cr_user', JSON.stringify(data.user));
    window.location.href = '/app.html';
  } catch (err) {
    showError(err.message);
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});
