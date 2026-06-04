const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function submitProject(gitUrl) {
  const res = await fetch(`${API}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ git_url: gitUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchStatus(projectId) {
  const res = await fetch(`${API}/projects/${projectId}/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Subscribe to live build logs via Server-Sent Events.
 * Returns an unsubscribe function.
 */
export function subscribeToLogs(projectId, { onLog, onStatus, onError }) {
  const es = new EventSource(`${API}/projects/${projectId}/logs`);

  es.addEventListener('log', (e) => {
    try { onLog?.(JSON.parse(e.data).line); } catch { /* skip malformed */ }
  });

  es.addEventListener('status', (e) => {
    try {
      const { status } = JSON.parse(e.data);
      onStatus?.(status);
      if (status === 'success' || status === 'failed') es.close();
    } catch { /* skip */ }
  });

  es.onerror = () => {
    // CLOSED = 2: fired after we already called es.close() — safe to ignore
    if (es.readyState === EventSource.CLOSED) return;
    // CONNECTING = 0: browser is auto-retrying a transient blip — let it
    if (es.readyState === EventSource.CONNECTING) return;
    // Truly broken
    onError?.(new Error('Lost connection to build server'));
    es.close();
  };

  return () => es.close();
}
