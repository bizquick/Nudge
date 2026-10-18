import { createContext, useContext, useState } from 'react';
import { Flag, Loader2, Check } from 'lucide-react';
import { supabase } from '../utils/supabase/client';

// Reporting a nudge, a message, or a person. Reports go to Addly's team (they show
// up in Insights) and what you reported is hidden from you right away. Afterwards
// you can block the person too.

export interface ReportTarget {
  kind: 'nudge' | 'message' | 'user';
  /** The nudge or message id (none for a person) */
  targetId?: string;
  /** Who posted it, or who's being reported */
  targetUser: string;
  /** A copy of what's being reported, so it can be reviewed even if it's deleted */
  snapshot?: string;
}

/** Anywhere in the app: open the report sheet for something */
export const ReportContext = createContext<(target: ReportTarget) => void>(() => {});
export function useReport() {
  return useContext(ReportContext);
}

const REASONS = [
  'Spam or scam',
  'Harassment or bullying',
  'Nudity or sexual content',
  'Hate speech or symbols',
  'Violence or threats',
  'Something else',
];

interface ReportSheetProps {
  target: ReportTarget;
  currentUser: string;
  alreadyBlocked: boolean;
  onReported: (target: ReportTarget) => void;
  onBlock: (name: string) => void;
  onClose: () => void;
}

export function ReportSheet({ target, currentUser, alreadyBlocked, onReported, onBlock, onClose }: ReportSheetProps) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = target.kind === 'nudge' ? 'nudge' : target.kind === 'message' ? 'message' : target.targetUser;

  const submit = async () => {
    if (!reason) return;
    setSending(true);
    setError(null);
    const { error: err } = await supabase.from('reports').insert({
      kind: target.kind,
      target_id: target.targetId ?? null,
      target_user: target.targetUser,
      reason,
      details: details.trim() || null,
      snapshot: target.snapshot?.slice(0, 2000) ?? null,
    });
    setSending(false);
    if (err) {
      console.error(err);
      setError("Couldn't send the report. Check your connection and try again.");
      return;
    }
    onReported(target);
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
              <Check className="w-6 h-6" />
            </div>
            <p className="mt-3 text-lg text-stone-900">Thanks for telling us</p>
            <p className="mt-1 text-sm text-stone-500">
              We review every report within 24 hours and remove anything that breaks the rules.
              {target.kind !== 'user' && ' It’s hidden for you in the meantime.'}
            </p>
            {target.targetUser !== currentUser && !alreadyBlocked && (
              <button
                onClick={() => { onBlock(target.targetUser); onClose(); }}
                className="mt-5 w-full h-12 rounded-2xl border border-red-200 text-red-600 active:bg-red-50"
              >
                Block {target.targetUser} too
              </button>
            )}
            <button onClick={onClose} className="mt-2 w-full h-12 rounded-2xl bg-brand-600 text-white active:bg-brand-700">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Flag className="w-5 h-5 text-red-500" />
              <p className="text-lg text-stone-900">Report {target.kind === 'user' ? what : `this ${what}`}</p>
            </div>
            <p className="mt-1 text-sm text-stone-500">What's wrong with it? {target.kind !== 'user' && `${target.targetUser} won't know you reported it.`}</p>
            <div className="mt-3 divide-y divide-stone-100 rounded-2xl border border-stone-200 overflow-hidden">
              {REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left text-[15px] ${reason === r ? 'bg-red-50 text-red-700' : 'text-stone-800 active:bg-stone-50'}`}
                >
                  {r}
                  {reason === r && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
            {reason && (
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Anything else we should know? (optional)"
                rows={2}
                className="mt-3 w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-base resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            )}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={onClose} className="flex-1 h-12 rounded-2xl border border-stone-300 text-stone-700 active:bg-stone-50">Cancel</button>
              <button
                onClick={submit}
                disabled={!reason || sending}
                className="flex-[2] h-12 rounded-2xl bg-red-600 text-white disabled:opacity-40 flex items-center justify-center gap-2 active:bg-red-700"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
                Send report
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
