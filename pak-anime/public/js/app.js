const THEME_KEY = 'pakanime-theme';

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  syncThemeIcon(theme);
}

function syncThemeIcon(theme) {
  const sun = document.querySelector('[data-icon-sun]');
  const moon = document.querySelector('[data-icon-moon]');
  if (!sun || !moon) return;
  // Dark mode shows the sun (click to go light); light mode shows the moon.
  sun.style.display = theme === 'dark' ? '' : 'none';
  moon.style.display = theme === 'dark' ? 'none' : '';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  syncThemeIcon(next);
}

function wireThemeToggle() {
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  btn.addEventListener('click', toggleTheme);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* no body */
  }
  if (!res.ok) {
    const err = new Error(body?.error || 'request_failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function loadNavAuthState() {
  const authSlot = document.querySelector('[data-nav-auth]');
  const mobileSlot = document.querySelector('[data-nav-auth-mobile]');
  if (!authSlot && !mobileSlot) return;

  const wireLogout = (root) => {
    const btn = root.querySelector('[data-logout]');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });
  };

  try {
    const { user } = await api('/auth/me');
    const html = user
      ? `
        <a href="/downloads.html">My Downloads</a>
        ${user.isAdmin ? '<a href="/admin.html">Upload</a>' : ''}
        <a href="#" data-logout>Log out (${user.username})</a>
      `
      : `
        <a href="/login.html">Log in</a>
        <a href="/register.html" class="btn btn-primary" style="padding:8px 16px;">Sign up</a>
      `;

    if (authSlot) {
      authSlot.innerHTML = html;
      wireLogout(authSlot);
    }
    if (mobileSlot) {
      mobileSlot.innerHTML = html;
      wireLogout(mobileSlot);
    }
  } catch (e) {
    const fallback = '<a href="/login.html">Log in</a>';
    if (authSlot) authSlot.innerHTML = fallback;
    if (mobileSlot) mobileSlot.innerHTML = fallback;
  }
}

function wireMobileMenu() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-mobile-menu]');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    menu.classList.toggle('open');
  });

  menu.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') menu.classList.remove('open');
  });

  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('open')) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    menu.classList.remove('open');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  wireThemeToggle();
  wireMobileMenu();
  loadNavAuthState();
});
