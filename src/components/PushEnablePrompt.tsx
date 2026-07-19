// Sign-in notification-enablement prompt. A dismissible bottom card (never a
// modal wall) shown once per user per device, then at most every 14 days while
// still not enabled. State is tracked locally per device — no main-doc writes.
// The permanent recovery path stays the Enable card in notification settings.
import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { pushSupport, enablePush, PushSupport } from '../lib/messaging';

const REPROMPT_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const norm = (e: string) => (e || '').trim().toLowerCase();
const stateKey = (email: string) => `cm_push_prompt_${encodeURIComponent(norm(email))}`;

interface PromptState { suppressed?: boolean; lastShownAt?: number }
const readState = (email: string): PromptState => {
  try { return JSON.parse(localStorage.getItem(stateKey(email)) || '{}'); } catch { return {}; }
};
const writeState = (email: string, s: PromptState) => {
  try { localStorage.setItem(stateKey(email), JSON.stringify(s)); } catch { /* private mode — no-op */ }
};

export default function PushEnablePrompt({ userEmail, showToast }: { userEmail: string; showToast: (m: string) => void }) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    pushSupport().then(s => {
      if (cancelled) return;
      setSupport(s);
      // Only prompt where enabling is actually possible / instructive.
      // granted → nothing to do. denied → browser won't re-ask; a popup would
      // be a dead end (settings card keeps the recovery guidance). unsupported
      // → no push at all.
      if (s === 'granted' || s === 'denied' || s === 'unsupported') return;
      const st = readState(userEmail);
      if (st.suppressed) return;                                   // "Don't ask again"
      if (st.lastShownAt && Date.now() - st.lastShownAt < REPROMPT_MS) return; // 14-day guard
      // Record the show immediately so re-opening within the window won't nag.
      writeState(userEmail, { ...st, lastShownAt: Date.now() });
      setShow(true);
    });
    return () => { cancelled = true; };
  }, [userEmail]);

  if (!show || !support) return null;

  const dismiss = () => setShow(false);                            // "Not now" — 14-day guard already recorded
  const never = () => { writeState(userEmail, { ...readState(userEmail), suppressed: true }); setShow(false); };
  const enable = async () => {
    const t = await enablePush();
    setSupport(await pushSupport());
    showToast(t ? 'Notifications enabled on this device.' : 'Not enabled — check browser permissions.');
    if (t) setShow(false);
  };

  const isIosNotInstalled = support === 'ios-not-installed';

  return (
    <div className="fixed inset-x-2 bottom-2 z-[120] md:inset-x-auto md:right-4 md:bottom-4 md:w-[380px] no-print">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-black text-sm text-slate-800">Turn on notifications</div>
            {isIosNotInstalled ? (
              <div className="text-xs text-gray-600 mt-1 leading-relaxed">
                Two quick steps on iPhone/iPad:
                <div className="mt-1"><b>1.</b> Tap <b>Share</b> <span className="text-slate-400">(the box with an arrow)</span> → <b>Add to Home Screen</b>.</div>
                <div><b>2.</b> Open CrewMaster from the Home Screen, then enable notifications.</div>
              </div>
            ) : (
              <div className="text-xs text-gray-600 mt-1 leading-relaxed">
                Get work orders, announcements, and alerts pushed to this device — even when CrewMaster is closed.
              </div>
            )}
          </div>
          <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-600 -mt-1 -mr-1 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <button onClick={never} className="text-[11px] text-slate-400 hover:text-slate-600 underline">Don't ask again</button>
          <div className="flex items-center gap-2">
            <button onClick={dismiss} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100">Not now</button>
            {!isIosNotInstalled && (
              <button onClick={enable} className="px-4 py-1.5 rounded-lg text-white text-xs font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700">Enable</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
