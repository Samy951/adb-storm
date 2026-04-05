// ts/router.ts
class Router {
  routes = new Map;
  container;
  currentHash = "";
  cleanup = null;
  constructor(containerId) {
    const el = document.getElementById(containerId);
    if (!el)
      throw new Error(`Container #${containerId} not found`);
    this.container = el;
    window.addEventListener("hashchange", () => this.handleHash());
    window.__router = this;
    requestAnimationFrame(() => this.handleHash());
  }
  add(name, render) {
    this.routes.set(name, render);
  }
  navigate(name, params) {
    const hash = params ? `${name}?${new URLSearchParams(params).toString()}` : name;
    window.location.hash = hash;
  }
  handleHash() {
    const raw = window.location.hash.slice(1) || "login";
    const [name, query] = raw.split("?");
    const params = {};
    if (query) {
      new URLSearchParams(query).forEach((v, k) => {
        params[k] = v;
      });
    }
    if (raw === this.currentHash)
      return;
    this.currentHash = raw;
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
    const render = this.routes.get(name);
    if (render) {
      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild);
      }
      const result = render(this.container, params);
      if (typeof result === "function") {
        this.cleanup = result;
      }
    }
  }
}

// ts/dom.ts
function el(tag, attrs, ...children) {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "className") {
        element.className = value;
      } else if (key.startsWith("data-")) {
        element.setAttribute(key, value);
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  for (const child of children) {
    if (typeof child === "string") {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}
function text(tag, className, content) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}
function input(type, className, placeholder = "") {
  const inp = document.createElement("input");
  inp.type = type;
  inp.className = className;
  inp.placeholder = placeholder;
  return inp;
}
function btn(label, className, onClick) {
  const button = document.createElement("button");
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

// ts/api.ts
var API_BASE = window.location.origin;
function getToken() {
  return localStorage.getItem("token");
}
function authHeaders() {
  const token = getToken();
  return token ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` } : { "Content-Type": "application/json" };
}
async function login(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Login failed" }));
    throw new Error(data.error || "Login failed");
  }
  return res.json();
}
async function register(username, password, display_name) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, display_name })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Registration failed" }));
    throw new Error(data.error || "Registration failed");
  }
  return res.json();
}
async function getChannels() {
  const res = await fetch(`${API_BASE}/channels`, { headers: authHeaders() });
  if (!res.ok)
    throw new Error(await res.text());
  const data = await res.json();
  return data.channels || [];
}
async function createChannel(name, description, is_private) {
  const res = await fetch(`${API_BASE}/channels`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name, description, is_private })
  });
  if (!res.ok)
    throw new Error(await res.text());
  return res.json();
}
async function joinChannel(channelId) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/join`, {
    method: "POST",
    headers: authHeaders()
  });
  if (!res.ok)
    throw new Error(await res.text());
  return res.json();
}
async function getMessages(channelId, limit = 50, before) {
  let url = `${API_BASE}/channels/${channelId}/messages?limit=${limit}`;
  if (before)
    url += `&before=${encodeURIComponent(before)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok)
    throw new Error(await res.text());
  const data = await res.json();
  return data.messages || [];
}
async function getOnlineUsers(channelId) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/online`, {
    headers: authHeaders()
  });
  if (!res.ok)
    return [];
  const data = await res.json();
  return data.online || [];
}

// ts/pages/login.ts
function renderLogin(container) {
  const router = window.__router;
  const page = el("div", { className: "login-page" });
  const window_ = el("div", { className: "win-window login-window" });
  const titlebar = el("div", { className: "win-titlebar" }, el("div", { className: "win-titlebar__title" }, text("span", "", "▣"), text("span", "", "Sovereign Messenger v1.0")));
  const content = el("div", { className: "login-content" });
  const logo = el("div", { className: "login-logo" }, el("div", { className: "login-logo__icon" }, text("div", "login-logo__ascii", "§")), text("div", "login-logo__title", "SOVEREIGN"));
  const form = el("div", { className: "login-form" });
  const usernameInput = input("text", "win-input", "");
  const usernameField = el("div", { className: "login-form__field" }, text("label", "text-bold", "Username:"), usernameInput);
  const passwordInput = input("password", "win-input", "");
  const passwordField = el("div", { className: "login-form__field" }, text("label", "text-bold", "Password:"), passwordInput);
  const statusText = text("span", "", "System Ready...");
  const statusBar = el("div", { className: "login-statusbar" }, el("div", { className: "login-statusbar__inner" }, statusText));
  const setStatus = (msg) => {
    statusText.textContent = msg;
  };
  const handleLogin = async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      setStatus("Error: All fields required.");
      return;
    }
    setStatus("Connecting...");
    try {
      const data = await login(username, password);
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.user.username);
      localStorage.setItem("userId", data.user.id);
      setStatus("Login successful!");
      router.navigate("channels");
    } catch (err) {
      setStatus(`Error: ${err.message || "Login failed"}`);
    }
  };
  const handleRegister = async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      setStatus("Error: All fields required.");
      return;
    }
    setStatus("Registering...");
    try {
      const data = await register(username, password, username);
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.user.username);
      localStorage.setItem("userId", data.user.id);
      setStatus("Registration successful!");
      router.navigate("channels");
    } catch (err) {
      setStatus(`Error: ${err.message || "Registration failed"}`);
    }
  };
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter")
      handleLogin();
  });
  const actions = el("div", { className: "login-form__actions" }, btn("Sign In", "win-btn", handleLogin), btn("Register", "win-btn", handleRegister));
  form.appendChild(usernameField);
  form.appendChild(passwordField);
  form.appendChild(actions);
  content.appendChild(logo);
  content.appendChild(form);
  window_.appendChild(titlebar);
  window_.appendChild(content);
  window_.appendChild(statusBar);
  page.appendChild(window_);
  const footer = el("div", { className: "app-footer", style: "position:absolute;bottom:0;left:0;right:0;" }, text("span", "font-title", "System Status: Online | 1999-2003 Sovereign Inc."), el("div", { className: "app-footer__right" }, text("a", "", "Help"), text("a", "", "About"), text("a", "", "Privacy")));
  page.appendChild(footer);
  container.appendChild(page);
}

// ts/ws.ts
class WsClient {
  ws = null;
  handlers = new Map;
  reconnectTimer = null;
  reconnectAttempt = 0;
  url;
  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.url = `${protocol}//${window.location.host}/ws`;
  }
  connect(token) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.disconnect();
    this.ws = new WebSocket(`${this.url}?token=${token}`);
    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.emit("connected", {});
    };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit(data.type, data);
      } catch {}
    };
    this.ws.onclose = () => {
      this.emit("disconnected", {});
      this.scheduleReconnect(token);
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
  send(type, payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }
  sendMessage(channelId, content) {
    this.send("send_message", { channel_id: channelId, content });
  }
  sendTyping(channelId) {
    this.send("typing", { channel_id: channelId });
  }
  on(event, handler) {
    if (!this.handlers.has(event))
      this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }
  off(event, handler) {
    const list = this.handlers.get(event);
    if (list) {
      this.handlers.set(event, list.filter((h) => h !== handler));
    }
  }
  emit(event, data) {
    this.handlers.get(event)?.forEach((h) => h(data));
  }
  scheduleReconnect(token) {
    const base = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000);
    const jitter = Math.random() * 1000;
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(token), base + jitter);
  }
}
var ws = new WsClient;

// ts/components/sidebar.ts
var NAV_ITEMS = [
  { icon: "✉", label: "Messages", route: "chat" },
  { icon: "☰", label: "Groups", route: "channels" },
  { icon: "⏻", label: "Logout", route: "logout" }
];
function renderSidebar(activeRoute) {
  const router = window.__router;
  const sidebar = el("div", { className: "sidebar" });
  const header = el("div", { className: "sidebar__header" }, text("div", "sidebar__title", "Main Menu"), text("div", "sidebar__version", "v1.0.4"));
  sidebar.appendChild(header);
  const nav = el("div", { className: "sidebar__nav" });
  for (const item of NAV_ITEMS) {
    const isActive = item.route === activeRoute || item.route === "channels" && activeRoute === "channels" || item.route === "chat" && activeRoute === "chat";
    const button = document.createElement("button");
    button.className = `sidebar__btn${isActive ? " sidebar__btn--active" : ""}`;
    const icon = text("span", "sidebar__btn-icon", item.icon);
    const label = text("span", "", item.label);
    button.appendChild(icon);
    button.appendChild(label);
    if (item.route === "logout") {
      button.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        localStorage.removeItem("userId");
        router.navigate("login");
      });
    } else if (item.route) {
      button.addEventListener("click", () => router.navigate(item.route));
    }
    nav.appendChild(button);
  }
  sidebar.appendChild(nav);
  return sidebar;
}

// ts/components/header.ts
function renderAppHeader(title) {
  return el("div", { className: "app-header" }, el("div", { className: "app-header__title" }, text("span", "", "▣"), text("span", "", title)));
}

// ts/components/footer.ts
function renderAppFooter() {
  const username = localStorage.getItem("username") || "Guest";
  return el("div", { className: "app-footer" }, el("div", { className: "app-footer__left" }, text("span", "", "● System Status: Ready"), text("span", "", `Logged in as: ${username}`), text("span", "", "Server: SOVEREIGN-01")), el("div", { className: "app-footer__right" }, text("a", "", "Help"), text("a", "", "About")));
}

// ts/colors.ts
var PALETTE = [
  "#117743",
  "#1e40af",
  "#b91c1c",
  "#7c3aed",
  "#c2410c",
  "#0e7490",
  "#a16207",
  "#be185d",
  "#4338ca",
  "#15803d"
];
function hashString(str) {
  let hash = 0;
  for (let i = 0;i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i) | 0;
  }
  return Math.abs(hash);
}
function usernameColor(username) {
  return PALETTE[hashString(username) % PALETTE.length];
}

// ts/pages/chat.ts
var messageCounter = 1e6;
function formatTime(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${mm}/${dd}/${yy}(${day})${hh}:${min}:${sec}`;
}
function renderPost(msg) {
  const post = el("div", { className: "post" });
  const postNum = msg.id ? msg.id.slice(0, 7) : String(++messageCounter);
  const name = msg.username || "Anonymous";
  const authorSpan = text("span", "post__author", name);
  authorSpan.style.color = usernameColor(name);
  const header = el("div", { className: "post__header" }, authorSpan, text("span", "post__time", formatTime(msg.created_at)), text("span", "post__id", `No.${postNum}`));
  post.appendChild(header);
  const body = el("div", { className: "post__body" });
  const lines = msg.content.split(`
`);
  for (const line of lines) {
    const p = document.createElement("p");
    if (line.startsWith(">")) {
      p.className = "post__greentext";
    }
    p.textContent = line;
    body.appendChild(p);
  }
  post.appendChild(body);
  return post;
}
function renderChat(container, params) {
  const router = window.__router;
  const channelId = params?.channel || "";
  const channelName = params?.name || "general";
  const token = localStorage.getItem("token") || "";
  if (!token) {
    router.navigate("login");
    return;
  }
  const layout = el("div", { className: "app-layout" });
  layout.appendChild(renderAppHeader(`#${channelName} - Sovereign Messenger v1.0`));
  const body = el("div", { className: "app-body" });
  body.appendChild(renderSidebar("chat"));
  const main = el("div", { className: "main-content" });
  const feed = el("div", { className: "chat-feed" });
  const onlineBar = el("div", { className: "chat-online" });
  onlineBar.textContent = "Loading online users...";
  feed.appendChild(onlineBar);
  const notice = el("div", { className: "chat-notice" }, text("div", "chat-notice__title", "System Notice:"), el("div", { className: "chat-notice__text" }, (() => {
    const p = document.createElement("p");
    p.textContent = "Welcome to the Sovereign Messenger Mainframe.";
    return p;
  })(), (() => {
    const p = document.createElement("p");
    p.textContent = "Keep your packets clean and your headers valid.";
    return p;
  })()));
  feed.appendChild(notice);
  const messagesContainer = el("div");
  const renderedIds = new Set;
  feed.appendChild(messagesContainer);
  const msgInput = input("text", "chat-input__text", "Type a message...");
  const sendMessage = () => {
    const content = msgInput.value.trim();
    if (!content || !channelId)
      return;
    ws.sendMessage(channelId, content);
    msgInput.value = "";
  };
  let lastTypingSent = 0;
  msgInput.addEventListener("input", () => {
    const now = Date.now();
    if (channelId && now - lastTypingSent > 3000) {
      lastTypingSent = now;
      ws.sendTyping(channelId);
    }
  });
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter")
      sendMessage();
  });
  const sendBtn = document.createElement("button");
  sendBtn.className = "chat-input__send";
  sendBtn.textContent = "Send";
  sendBtn.addEventListener("click", sendMessage);
  const inputBar = el("div", { className: "chat-input" }, el("div", { className: "chat-input__field" }, msgInput), sendBtn);
  const typingBar = el("div", { className: "chat-typing" });
  main.appendChild(feed);
  main.appendChild(typingBar);
  main.appendChild(inputBar);
  body.appendChild(main);
  layout.appendChild(body);
  layout.appendChild(renderAppFooter());
  container.appendChild(layout);
  let oldestTimestamp = null;
  let loadingMore = false;
  let hasMore = true;
  const loadMessages = async (before) => {
    if (!channelId || loadingMore || !hasMore)
      return;
    loadingMore = true;
    try {
      const messages = await getMessages(channelId, 50, before);
      if (messages.length < 50)
        hasMore = false;
      if (messages.length > 0) {
        oldestTimestamp = messages[0].created_at;
      }
      if (!before) {
        for (const msg of messages) {
          if (msg.id && renderedIds.has(msg.id))
            continue;
          if (msg.id)
            renderedIds.add(msg.id);
          messagesContainer.appendChild(renderPost(msg));
        }
        feed.scrollTop = feed.scrollHeight;
      } else {
        const prevHeight = feed.scrollHeight;
        const frag = document.createDocumentFragment();
        for (const msg of messages) {
          if (msg.id && renderedIds.has(msg.id))
            continue;
          if (msg.id)
            renderedIds.add(msg.id);
          frag.appendChild(renderPost(msg));
        }
        messagesContainer.insertBefore(frag, messagesContainer.firstChild);
        feed.scrollTop = feed.scrollHeight - prevHeight;
      }
    } catch {}
    loadingMore = false;
  };
  feed.addEventListener("scroll", () => {
    if (feed.scrollTop < 100 && oldestTimestamp && hasMore) {
      loadMessages(oldestTimestamp);
    }
  });
  if (channelId) {
    loadMessages();
  }
  ws.connect(token);
  const refreshOnline = async () => {
    if (!channelId)
      return;
    try {
      const users = await getOnlineUsers(channelId);
      if (users.length > 0) {
        onlineBar.textContent = `Online (${users.length}): ${users.join(", ")}`;
      } else {
        onlineBar.textContent = "No users online";
      }
    } catch {
      onlineBar.textContent = "";
    }
  };
  refreshOnline();
  const onlineInterval = setInterval(refreshOnline, 15000);
  const onNewMessage = (data) => {
    if (data.channel_id === channelId) {
      if (data.id && renderedIds.has(data.id))
        return;
      if (data.id)
        renderedIds.add(data.id);
      messagesContainer.appendChild(renderPost({
        username: data.username || data.user_id?.slice(0, 8) || "Anonymous",
        content: data.content,
        created_at: data.created_at,
        id: data.id
      }));
      const isNearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
      if (isNearBottom)
        feed.scrollTop = feed.scrollHeight;
    }
  };
  const typingUsers = new Map;
  const updateTypingDisplay = () => {
    const names = Array.from(typingUsers.keys());
    if (names.length === 0) {
      typingBar.textContent = "";
    } else if (names.length === 1) {
      typingBar.textContent = `${names[0]} is typing...`;
    } else {
      typingBar.textContent = `${names.join(", ")} are typing...`;
    }
  };
  const onTyping = (data) => {
    if (data.channel_id !== channelId)
      return;
    const name = data.username || data.user_id?.slice(0, 8) || "Someone";
    if (name === localStorage.getItem("username"))
      return;
    const prev = typingUsers.get(name);
    if (prev)
      clearTimeout(prev);
    typingUsers.set(name, setTimeout(() => {
      typingUsers.delete(name);
      updateTypingDisplay();
    }, 4000));
    updateTypingDisplay();
  };
  ws.on("new_message", onNewMessage);
  ws.on("broadcast", onNewMessage);
  ws.on("user_typing", onTyping);
  return () => {
    ws.off("new_message", onNewMessage);
    ws.off("broadcast", onNewMessage);
    ws.off("user_typing", onTyping);
    typingUsers.forEach((timer) => clearTimeout(timer));
    typingUsers.clear();
    clearInterval(onlineInterval);
  };
}

// ts/components/create-channel.ts
function renderCreateChannelDialog(onSubmit, onCancel) {
  const overlay = el("div", { className: "dialog-overlay" });
  const dialog = el("div", { className: "win-window create-channel-dialog" });
  const titlebar = el("div", { className: "win-titlebar" }, el("div", { className: "win-titlebar__title" }, text("span", "", "▣"), text("span", "", "Create New Channel")), el("div", { className: "win-titlebar__controls" }, btn("×", "win-titlebar__btn", onCancel)));
  const content = el("div", { className: "create-channel-dialog__content" });
  const nameInput = input("text", "win-input", "e.g. #general");
  const nameField = el("div", { className: "create-channel-dialog__field" }, text("label", "", "Channel Name:"), nameInput);
  const descTextarea = document.createElement("textarea");
  descTextarea.className = "win-textarea";
  descTextarea.placeholder = "Enter channel purpose...";
  descTextarea.rows = 3;
  const descField = el("div", { className: "create-channel-dialog__field" }, text("label", "", "Description:"), descTextarea);
  const radioPublic = document.createElement("input");
  radioPublic.type = "radio";
  radioPublic.name = "privacy";
  radioPublic.checked = true;
  const radioPrivate = document.createElement("input");
  radioPrivate.type = "radio";
  radioPrivate.name = "privacy";
  const privacyField = el("div", { className: "create-channel-dialog__field" }, text("label", "", "Accessibility:"), el("label", { className: "win-radio" }, radioPublic, text("span", "", "Public (Visible to all users)")), el("label", { className: "win-radio" }, radioPrivate, text("span", "", "Private (Invite only)")));
  const separator = el("div", { className: "win-separator" });
  const actions = el("div", { className: "create-channel-dialog__actions" }, btn("OK", "win-btn", () => {
    const name = nameInput.value.trim().replace(/^#/, "");
    const desc = descTextarea.value.trim();
    if (!name)
      return;
    onSubmit(name, desc, radioPrivate.checked);
  }), btn("Cancel", "win-btn", onCancel));
  content.appendChild(nameField);
  content.appendChild(descField);
  content.appendChild(privacyField);
  content.appendChild(separator);
  content.appendChild(actions);
  dialog.appendChild(titlebar);
  dialog.appendChild(content);
  overlay.appendChild(dialog);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay)
      onCancel();
  });
  return overlay;
}

// ts/pages/channels.ts
function renderChannels(container) {
  const router = window.__router;
  if (!localStorage.getItem("token")) {
    router.navigate("login");
    return;
  }
  const layout = el("div", { className: "app-layout" });
  layout.appendChild(renderAppHeader("Channel Browser"));
  const body = el("div", { className: "app-body" });
  body.appendChild(renderSidebar("channels"));
  const main = el("div", { className: "main-content" });
  const browser = el("div", { className: "channel-browser" });
  const window_ = el("div", { className: "win-window channel-browser__window" });
  const winTitle = el("div", { className: "win-titlebar", style: "background: var(--navy-light)" }, el("div", { className: "win-titlebar__title" }, text("span", "", "⊞"), text("span", "", "Channel Browser")));
  const toolbar = el("div", { className: "channel-browser__toolbar" }, el("div", {}, btn("← Back", "win-btn", () => {}), btn("→ Forward", "win-btn", () => {})), el("div", { className: "channel-browser__address" }, text("span", "channel-browser__address-label", "Address:"), text("span", "channel-browser__address-value font-mono", "messenger://root/channels/global")));
  const grid = el("div", { className: "channel-browser__grid" });
  const resultsInfo = text("div", "", "Loading channels...");
  const tableContainer = el("div");
  const errorMsg = text("div", "win-error", "");
  const controls = el("div", { className: "channel-browser__controls" }, el("div", {}, btn("CREATE NEW", "win-btn win-btn--bold", () => showCreateDialog())), text("span", "", ""));
  grid.appendChild(resultsInfo);
  grid.appendChild(errorMsg);
  grid.appendChild(tableContainer);
  grid.appendChild(controls);
  window_.appendChild(winTitle);
  window_.appendChild(toolbar);
  window_.appendChild(grid);
  browser.appendChild(window_);
  main.appendChild(browser);
  body.appendChild(main);
  layout.appendChild(body);
  layout.appendChild(renderAppFooter());
  container.appendChild(layout);
  const showCreateDialog = () => {
    const overlay = renderCreateChannelDialog(async (name, desc, isPrivate) => {
      try {
        await createChannel(name, desc, isPrivate);
        overlay.remove();
        errorMsg.textContent = "";
        loadChannels();
      } catch (err) {
        errorMsg.textContent = `Error: ${err.message}`;
      }
    }, () => overlay.remove());
    container.appendChild(overlay);
  };
  const loadChannels = async () => {
    try {
      const channels = await getChannels();
      resultsInfo.textContent = `Results: ${channels.length} channels found in the global index.`;
      while (tableContainer.firstChild) {
        tableContainer.removeChild(tableContainer.firstChild);
      }
      const table = document.createElement("table");
      table.className = "win-table";
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const col of ["Channel Name", "Description", "Action"]) {
        const th = document.createElement("th");
        th.textContent = col;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const ch of channels) {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        tdName.className = "channel-name";
        tdName.textContent = `#${ch.name}`;
        tr.appendChild(tdName);
        const tdDesc = document.createElement("td");
        tdDesc.textContent = ch.description || "";
        tdDesc.style.color = "var(--text-light)";
        tr.appendChild(tdDesc);
        const tdAction = document.createElement("td");
        const joinBtn = btn("JOIN", "win-btn win-btn--bold win-btn--small", async () => {
          try {
            await joinChannel(ch.id);
          } catch (err) {
            const msg = err.message || "";
            if (!msg.includes("already") && !msg.includes("conflict")) {
              errorMsg.textContent = `Error joining #${ch.name}: ${msg}`;
              return;
            }
          }
          router.navigate("chat", { channel: ch.id, name: ch.name });
        });
        tdAction.appendChild(joinBtn);
        tr.appendChild(tdAction);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableContainer.appendChild(table);
    } catch (err) {
      resultsInfo.textContent = `Error loading channels: ${err.message}`;
    }
  };
  loadChannels();
}

// ts/main.ts
var router = new Router("app");
router.add("login", renderLogin);
router.add("channels", renderChannels);
router.add("chat", renderChat);
var token = localStorage.getItem("token");
router.navigate(token ? "channels" : "login");
