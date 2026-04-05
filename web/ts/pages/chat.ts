import { el, text, input } from '../dom';
import { getMessages, getOnlineUsers } from '../api';
import { ws } from '../ws';
import type { Router } from '../router';
import { renderSidebar } from '../components/sidebar';
import { renderAppHeader } from '../components/header';
import { renderAppFooter } from '../components/footer';
import { usernameColor } from '../colors';

let messageCounter = 1000000;

function formatTime(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const day = days[d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yy}(${day})${hh}:${min}:${sec}`;
}

function renderPost(msg: { user_id?: string; username?: string; content: string; created_at?: string; id?: string }): HTMLElement {
  const post = el('div', { className: 'post' });
  const postNum = msg.id ? msg.id.slice(0, 7) : String(++messageCounter);
  const name = msg.username || 'Anonymous';

  // Header
  const authorSpan = text('span', 'post__author', name);
  authorSpan.style.color = usernameColor(name);

  const header = el('div', { className: 'post__header' },
    authorSpan,
    text('span', 'post__time', formatTime(msg.created_at)),
    text('span', 'post__id', `No.${postNum}`)
  );
  post.appendChild(header);

  // Body — parse greentext
  const body = el('div', { className: 'post__body' });
  const lines = msg.content.split('\n');
  for (const line of lines) {
    const p = document.createElement('p');
    if (line.startsWith('>')) {
      p.className = 'post__greentext';
    }
    p.textContent = line;
    body.appendChild(p);
  }
  post.appendChild(body);

  return post;
}

export function renderChat(container: HTMLElement, params?: Record<string, string>) {
  const router = (window as any).__router as Router;
  const channelId = params?.channel || '';
  const channelName = params?.name || 'general';
  const token = localStorage.getItem('token') || '';

  if (!token) {
    router.navigate('login');
    return;
  }

  const layout = el('div', { className: 'app-layout' });

  // Header
  layout.appendChild(renderAppHeader(`#${channelName} - Sovereign Messenger v1.0`));

  // Body
  const body = el('div', { className: 'app-body' });
  body.appendChild(renderSidebar('chat'));

  const main = el('div', { className: 'main-content' });

  // Chat feed
  const feed = el('div', { className: 'chat-feed' });

  // Online users bar
  const onlineBar = el('div', { className: 'chat-online' });
  onlineBar.textContent = 'Loading online users...';
  feed.appendChild(onlineBar);

  // System notice
  const notice = el('div', { className: 'chat-notice' },
    text('div', 'chat-notice__title', 'System Notice:'),
    el('div', { className: 'chat-notice__text' },
      (() => { const p = document.createElement('p'); p.textContent = 'Welcome to the Sovereign Messenger Mainframe.'; return p; })(),
      (() => { const p = document.createElement('p'); p.textContent = 'Keep your packets clean and your headers valid.'; return p; })()
    )
  );
  feed.appendChild(notice);

  const messagesContainer = el('div');
  const renderedIds = new Set<string>();
  feed.appendChild(messagesContainer);

  // Input bar
  const msgInput = input('text', 'chat-input__text', 'Type a message...');

  const sendMessage = () => {
    const content = msgInput.value.trim();
    if (!content || !channelId) return;
    ws.sendMessage(channelId, content);
    msgInput.value = '';
  };

  // Typing indicator — throttle to 1 event per 3 seconds
  let lastTypingSent = 0;
  msgInput.addEventListener('input', () => {
    const now = Date.now();
    if (channelId && now - lastTypingSent > 3000) {
      lastTypingSent = now;
      ws.sendTyping(channelId);
    }
  });

  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-input__send';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', sendMessage);

  const inputBar = el('div', { className: 'chat-input' },
    el('div', { className: 'chat-input__field' }, msgInput),
    sendBtn
  );

  // Typing indicator bar
  const typingBar = el('div', { className: 'chat-typing' });

  main.appendChild(feed);
  main.appendChild(typingBar);
  main.appendChild(inputBar);
  body.appendChild(main);

  layout.appendChild(body);
  layout.appendChild(renderAppFooter());

  container.appendChild(layout);

  // Load history with scroll pagination
  let oldestTimestamp: string | null = null;
  let loadingMore = false;
  let hasMore = true;

  const loadMessages = async (before?: string) => {
    if (!channelId || loadingMore || !hasMore) return;
    loadingMore = true;

    try {
      const messages = await getMessages(channelId, 50, before);
      if (messages.length < 50) hasMore = false;

      if (messages.length > 0) {
        oldestTimestamp = messages[0].created_at;
      }

      if (!before) {
        // Initial load
        for (const msg of messages) {
          if (msg.id && renderedIds.has(msg.id)) continue;
          if (msg.id) renderedIds.add(msg.id);
          messagesContainer.appendChild(renderPost(msg));
        }
        feed.scrollTop = feed.scrollHeight;
      } else {
        // Prepend older messages
        const prevHeight = feed.scrollHeight;
        const frag = document.createDocumentFragment();
        for (const msg of messages) {
          if (msg.id && renderedIds.has(msg.id)) continue;
          if (msg.id) renderedIds.add(msg.id);
          frag.appendChild(renderPost(msg));
        }
        messagesContainer.insertBefore(frag, messagesContainer.firstChild);
        // Maintain scroll position
        feed.scrollTop = feed.scrollHeight - prevHeight;
      }
    } catch { /* ignore */ }
    loadingMore = false;
  };

  // Scroll to top → load more
  feed.addEventListener('scroll', () => {
    if (feed.scrollTop < 100 && oldestTimestamp && hasMore) {
      loadMessages(oldestTimestamp);
    }
  });

  if (channelId) {
    loadMessages();
  }

  // Connect WebSocket (no-op if already connected)
  ws.connect(token);

  // Poll online users
  const refreshOnline = async () => {
    if (!channelId) return;
    try {
      const users = await getOnlineUsers(channelId);
      if (users.length > 0) {
        onlineBar.textContent = `Online (${users.length}): ${users.join(', ')}`;
      } else {
        onlineBar.textContent = 'No users online';
      }
    } catch {
      onlineBar.textContent = '';
    }
  };
  refreshOnline();
  const onlineInterval = setInterval(refreshOnline, 15000);

  // Listen for new messages
  const onNewMessage = (data: any) => {
    if (data.channel_id === channelId) {
      // Dedup — skip if already rendered
      if (data.id && renderedIds.has(data.id)) return;
      if (data.id) renderedIds.add(data.id);
      messagesContainer.appendChild(renderPost({
        username: data.username || data.user_id?.slice(0, 8) || 'Anonymous',
        content: data.content,
        created_at: data.created_at,
        id: data.id
      }));
      const isNearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
      if (isNearBottom) feed.scrollTop = feed.scrollHeight;
    }
  };

  // Typing indicator handler
  const typingUsers = new Map<string, ReturnType<typeof setTimeout>>();
  const updateTypingDisplay = () => {
    const names = Array.from(typingUsers.keys());
    if (names.length === 0) {
      typingBar.textContent = '';
    } else if (names.length === 1) {
      typingBar.textContent = `${names[0]} is typing...`;
    } else {
      typingBar.textContent = `${names.join(', ')} are typing...`;
    }
  };

  const onTyping = (data: any) => {
    if (data.channel_id !== channelId) return;
    const name = data.username || data.user_id?.slice(0, 8) || 'Someone';
    // Don't show own typing
    if (name === localStorage.getItem('username')) return;

    // Clear previous timeout for this user
    const prev = typingUsers.get(name);
    if (prev) clearTimeout(prev);

    // Auto-remove after 4 seconds
    typingUsers.set(name, setTimeout(() => {
      typingUsers.delete(name);
      updateTypingDisplay();
    }, 4000));
    updateTypingDisplay();
  };

  ws.on('new_message', onNewMessage);
  ws.on('broadcast', onNewMessage);
  ws.on('user_typing', onTyping);

  // Return cleanup function — called by router when leaving this page
  return () => {
    ws.off('new_message', onNewMessage);
    ws.off('broadcast', onNewMessage);
    ws.off('user_typing', onTyping);
    typingUsers.forEach(timer => clearTimeout(timer));
    typingUsers.clear();
    clearInterval(onlineInterval);
  };
}
