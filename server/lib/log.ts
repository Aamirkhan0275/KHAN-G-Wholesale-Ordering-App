/**
 * Structured logging + production failure alerting. Alerts go to the DevBench
 * notify endpoint (team chat) when DEVBENCH_NOTIFY_URL/TOKEN are set; each alert
 * key is throttled so one broken thing does not flood the chat.
 */
type Level = 'info' | 'warning' | 'error';

let notifyUrl: string | undefined;
let notifyToken: string | undefined;
const lastSent = new Map<string, number>();
const THROTTLE_MS = 10 * 60 * 1000;

export function configureAlerts(url?: string, token?: string) {
  notifyUrl = url?.replace(/\/+$/, '');
  notifyToken = token;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (process.env.LOG_QUIET !== '1') console.log(line);
}

export async function alert(key: string, text: string, level: Level = 'error'): Promise<boolean> {
  log(level, 'alert', { key, text });
  if (!notifyUrl || !notifyToken) return false;
  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - THROTTLE_MS) return false;
  lastSent.set(key, now);
  try {
    const res = await fetch(`${notifyUrl}/api/notify/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${notifyToken}` },
      body: JSON.stringify({ text, level, source: 'khan-g-api' }),
    });
    return res.ok;
  } catch (e) {
    log('error', 'alert_send_failed', { key, error: String(e) });
    return false;
  }
}

/** test hook */
export function _resetAlertThrottle() { lastSent.clear(); }
