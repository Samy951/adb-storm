import { el, text, input, btn } from '../dom';
import { login, register } from '../api';
import type { Router } from '../router';

export function renderLogin(container: HTMLElement) {
  const router = (window as any).__router as Router;

  // Build login page
  const page = el('div', { className: 'login-page' });

  const window_ = el('div', { className: 'win-window login-window' });

  // Title bar
  const titlebar = el('div', { className: 'win-titlebar' },
    el('div', { className: 'win-titlebar__title' },
      text('span', '', '▣'),
      text('span', '', 'Sovereign Messenger v1.0')
    )
  );

  // Content
  const content = el('div', { className: 'login-content' });

  // Logo
  const logo = el('div', { className: 'login-logo' },
    el('div', { className: 'login-logo__icon' },
      text('div', 'login-logo__ascii', '§')
    ),
    text('div', 'login-logo__title', 'SOVEREIGN')
  );

  // Form
  const form = el('div', { className: 'login-form' });

  const usernameInput = input('text', 'win-input', '');
  const usernameField = el('div', { className: 'login-form__field' },
    text('label', 'text-bold', 'Username:'),
    usernameInput
  );

  const passwordInput = input('password', 'win-input', '');
  const passwordField = el('div', { className: 'login-form__field' },
    text('label', 'text-bold', 'Password:'),
    passwordInput
  );

  // Status bar for errors
  const statusText = text('span', '', 'System Ready...');
  const statusBar = el('div', { className: 'login-statusbar' },
    el('div', { className: 'login-statusbar__inner' }, statusText)
  );

  const setStatus = (msg: string) => {
    statusText.textContent = msg;
  };

  const handleLogin = async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      setStatus('Error: All fields required.');
      return;
    }
    setStatus('Connecting...');
    try {
      const data = await login(username, password);
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.user.username);
      localStorage.setItem('userId', data.user.id);
      setStatus('Login successful!');
      router.navigate('channels');
    } catch (err: any) {
      setStatus(`Error: ${err.message || 'Login failed'}`);
    }
  };

  const handleRegister = async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      setStatus('Error: All fields required.');
      return;
    }
    setStatus('Registering...');
    try {
      const data = await register(username, password, username);
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.user.username);
      localStorage.setItem('userId', data.user.id);
      setStatus('Registration successful!');
      router.navigate('channels');
    } catch (err: any) {
      setStatus(`Error: ${err.message || 'Registration failed'}`);
    }
  };

  // Handle Enter key
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  const actions = el('div', { className: 'login-form__actions' },
    btn('Sign In', 'win-btn', handleLogin),
    btn('Register', 'win-btn', handleRegister)
  );

  form.appendChild(usernameField);
  form.appendChild(passwordField);
  form.appendChild(actions);

  content.appendChild(logo);
  content.appendChild(form);

  window_.appendChild(titlebar);
  window_.appendChild(content);
  window_.appendChild(statusBar);

  page.appendChild(window_);

  // Footer
  const footer = el('div', { className: 'app-footer', style: 'position:absolute;bottom:0;left:0;right:0;' },
    text('span', 'font-title', 'System Status: Online | 1999-2003 Sovereign Inc.'),
    el('div', { className: 'app-footer__right' },
      text('a', '', 'Help'),
      text('a', '', 'About'),
      text('a', '', 'Privacy')
    )
  );

  page.appendChild(footer);
  container.appendChild(page);
}
