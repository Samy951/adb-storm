const API_BASE = window.location.origin;

function getToken(): string | null {
  return localStorage.getItem('token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

export async function login(username: string, password: string): Promise<{ user: any; token: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(data.error || 'Login failed');
  }
  return res.json();
}

export async function register(username: string, password: string, display_name: string): Promise<{ user: any; token: string }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, display_name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Registration failed' }));
    throw new Error(data.error || 'Registration failed');
  }
  return res.json();
}

export async function getChannels(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/channels`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.channels || [];
}

export async function createChannel(name: string, description: string, is_private: boolean): Promise<any> {
  const res = await fetch(`${API_BASE}/channels`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, description, is_private }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function joinChannel(channelId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/channels/${channelId}/join`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMessages(channelId: string, limit = 50, before?: string): Promise<any[]> {
  let url = `${API_BASE}/channels/${channelId}/messages?limit=${limit}`;
  if (before) url += `&before=${encodeURIComponent(before)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.messages || [];
}

export async function getOnlineUsers(channelId: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/channels/${channelId}/online`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.online || [];
}

export async function getChannel(channelId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/channels/${channelId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChannel(channelId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/channels/${channelId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function leaveChannel(channelId: string): Promise<void> {
  const userId = localStorage.getItem('userId') || '';
  const res = await fetch(`${API_BASE}/channels/${channelId}/members/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getMembers(channelId: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/channels/${channelId}/members`, { headers: authHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
  return data.members || [];
}

export async function sendHeartbeat(channelId?: string): Promise<void> {
  const body: Record<string, string> = {};
  if (channelId) body.channel_id = channelId;
  await fetch(`${API_BASE}/presence/heartbeat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  }).catch(() => {});
}

export async function sendOffline(): Promise<void> {
  await fetch(`${API_BASE}/presence/offline`, {
    method: 'POST',
    headers: authHeaders(),
  }).catch(() => {});
}
