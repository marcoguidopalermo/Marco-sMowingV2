// Web push (FCM) — frontend init, permission flow (with iOS-PWA path), token
// registration, foreground handling. All best-effort: push is a delivery bonus
// layered on the in-app notification centre, which works without permission.
import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { httpsCallable } from 'firebase/functions';
import { app, functions } from './firebase';

export const VAPID_KEY =
  'BJ3kV7lBEIbp8xGGPPy1zNv-tswhNp58qI9PFvY-J8GIul1-I_mT9jOkCHCs2joCI5pcXreHn826SN5w0CO75mw';

export type PushSupport =
  | 'supported'          // can request permission now
  | 'granted'            // already granted
  | 'denied'             // blocked — show gentle guidance
  | 'ios-not-installed'  // iOS Safari not added to Home Screen (no web push)
  | 'unsupported';       // browser has no push at all

// iOS only allows web push inside an installed PWA (display-mode standalone).
function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
}
function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export async function pushSupport(): Promise<PushSupport> {
  const supported = await isSupported().catch(() => false);
  if (!supported || !('Notification' in window) || !('serviceWorker' in navigator)) {
    if (isIos() && !isStandalone()) return 'ios-not-installed';
    return 'unsupported';
  }
  if (isIos() && !isStandalone()) return 'ios-not-installed';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'supported';
}

let _messaging: Messaging | null = null;
async function messaging(): Promise<Messaging | null> {
  if (_messaging) return _messaging;
  if (!(await isSupported().catch(() => false))) return null;
  _messaging = getMessaging(app);
  return _messaging;
}

async function swRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch {
    return undefined;
  }
}

// Request permission (only ever called on an explicit tap) + register token.
// Returns the token, or null if not granted / unsupported.
export async function enablePush(): Promise<string | null> {
  const m = await messaging();
  if (!m) return null;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return null;
  const reg = await swRegistration();
  try {
    const token = await getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      await httpsCallable(functions, 'registerPushToken')({ token, platform: navigator.platform || 'web' }).catch(() => {});
    }
    return token || null;
  } catch {
    return null;
  }
}

// If already granted, silently refresh + re-register the current token (call on
// app load so a rotated token stays live).
export async function refreshPushToken(): Promise<void> {
  if (Notification.permission !== 'granted') return;
  const m = await messaging();
  if (!m) return;
  const reg = await swRegistration();
  try {
    const token = await getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) await httpsCallable(functions, 'registerPushToken')({ token, platform: navigator.platform || 'web' }).catch(() => {});
  } catch { /* noop */ }
}

// Foreground messages → hand to the app (toast + refresh the centre).
export async function onForegroundMessage(cb: (n: { title: string; body: string; url: string; category: string }) => void): Promise<void> {
  const m = await messaging();
  if (!m) return;
  onMessage(m, (payload) => {
    const d = (payload.data || {}) as any;
    cb({ title: d.title || 'CrewMaster', body: d.body || '', url: d.url || '/', category: d.category || '' });
  });
}
