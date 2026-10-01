// SERVER-SIDE RECORD OF REFUSED WRITES.
//
// The write guards (docWriteGuard, the seed guard, the real-data gate) used to
// report only to the browser console and a toast — which is to say, to nobody:
// a refusal on a crew member's phone was invisible. After the 2026-10-01 wipe
// every refusal is also written to the root `docWriteRefusals` collection
// (create-only for any signed-in user, readable by admins — see
// firestore.rules), so an attempted catastrophe is known about the same day.
//
// Best-effort and fire-and-forget: logging must never block, throw into, or
// change the outcome of the refusal it records.
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export interface DocWriteRefusalReport {
  where: string;              // which guard: 'syncToCloud' | 'seed' | 'no-real-data'
  reason: string;             // guard's reason code
  detail?: string;
  email?: string | null;
  payloadBytes?: number;
  payloadEmployees?: number;
  payloadAllowlist?: number;
  serverBytes?: number | null;
  serverEmployees?: number | null;
  serverAllowlist?: number | null;
}

// One report per reason per page load: an effect re-firing must not flood
// the collection.
const sent = new Set<string>();

export function reportDocWriteRefusal(r: DocWriteRefusalReport): void {
  const key = `${r.where}|${r.reason}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    addDoc(collection(db, 'docWriteRefusals'), {
      at: serverTimestamp(),
      clientAt: Date.now(),
      where: String(r.where).slice(0, 60),
      reason: String(r.reason).slice(0, 60),
      detail: String(r.detail || '').slice(0, 500),
      email: (r.email || '').toLowerCase().slice(0, 200),
      payloadBytes: r.payloadBytes ?? null,
      payloadEmployees: r.payloadEmployees ?? null,
      payloadAllowlist: r.payloadAllowlist ?? null,
      serverBytes: r.serverBytes ?? null,
      serverEmployees: r.serverEmployees ?? null,
      serverAllowlist: r.serverAllowlist ?? null,
      online: nav ? nav.onLine : null,
      userAgent: (nav?.userAgent || '').slice(0, 300),
      build: String(import.meta.env.MODE || ''),
      url: typeof location !== 'undefined' ? location.pathname.slice(0, 100) : '',
    }).catch(err => console.warn('[doc-write] refusal could not be logged to the server', err));
  } catch (err) {
    console.warn('[doc-write] refusal could not be logged to the server', err);
  }
}
