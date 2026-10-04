import { useEffect, useState } from 'react';
import { ChevronLeft, RefreshCw, Loader2 } from 'lucide-react';
import { supabase } from '../utils/supabase/client';
import { CATEGORY_LABELS } from './SortMenu';

// Owner-only Insights: app-wide totals and trends from admin_stats() in the database.
// The database itself refuses to hand these numbers to anyone who isn't the owner.

interface Stats {
  generated_at: string;
  users: {
    total: number; new_7d: number; new_30d: number;
    active_1d: number; active_7d: number; active_30d: number;
    with_notifications: number; ever_sent: number;
  };
  nudges: {
    total: number; last_7d: number; last_30d: number;
    links: number; uploads: number; todos: number; groups: number; public: number; priority: number;
    by_type: Record<string, number>;
  };
  engagement: {
    shared: number; checked: number; median_minutes_to_check: number | null;
    messages_total: number; messages_7d: number;
    reactions_total: number; likes_total: number; favorites_total: number;
  };
  daily: { day: string; nudges: number; messages: number; active: number; signups: number }[];
}

type Series = 'active' | 'nudges' | 'messages' | 'signups';
const SERIES_LABELS: Record<Series, string> = { active: 'Active people', nudges: 'Nudges', messages: 'Messages', signups: 'Sign-ups' };

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function duration(minutes: number | null) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`;
  return `${Math.round(hours / 24)} days`;
}

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 px-3.5 py-3">
      <p className="text-[12px] text-stone-500 leading-4">{label}</p>
      <p className="text-2xl text-stone-900 mt-1 tabular-nums">{value}</p>
      {note && <p className="text-[11px] text-stone-400 mt-0.5 leading-4">{note}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm text-stone-500 mb-2">{title}</h2>
      {children}
    </section>
  );
}

export function Insights({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<Series>('active');

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('admin_stats');
    if (err || !data) {
      console.error(err);
      setError("Couldn't load Insights. If you just set this up, make sure the Insights SQL ran.");
    } else {
      setStats(data as Stats);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const daily = stats?.daily ?? [];
  const max = Math.max(1, ...daily.map(d => d[series]));
  const types = stats ? Object.entries(stats.nudges.by_type).sort((a, b) => b[1] - a[1]) : [];
  const typeMax = Math.max(1, ...types.map(([, c]) => c));

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: '#FBF6EC', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="shrink-0 max-w-2xl mx-auto w-full px-4 pt-1 pb-2 flex items-center gap-2">
        <button onClick={onClose} className="-ml-2 p-1.5 rounded-lg active:bg-stone-200 flex items-center gap-1" aria-label="Back">
          <ChevronLeft className="w-6 h-6 text-stone-700" />
        </button>
        <h1 className="tab-title text-[28px] leading-tight text-stone-800 flex-1">Insights</h1>
        <button onClick={load} disabled={loading} className="p-2 rounded-lg text-brand-600 active:bg-stone-200 disabled:opacity-50" aria-label="Refresh">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto w-full px-4 pb-8">
          <p className="text-xs text-stone-500">
            App-wide numbers, only visible to you. Totals only, never anyone's nudges or messages.
            {stats && ` Updated ${new Date(stats.generated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`}
          </p>

          {error && <p className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</p>}
          {!stats && loading && <p className="mt-10 text-center text-sm text-stone-400">Adding things up…</p>}

          {stats && (
            <>
              <Section title="People">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Tile label="Accounts" value={stats.users.total} note={`+${stats.users.new_7d} this week · +${stats.users.new_30d} this month`} />
                  <Tile label="Active today" value={stats.users.active_1d} note="did something in the last 24 hours" />
                  <Tile label="Active this week" value={stats.users.active_7d} note={`${pct(stats.users.active_7d, stats.users.total)} of accounts`} />
                  <Tile label="Active this month" value={stats.users.active_30d} note={`${pct(stats.users.active_30d, stats.users.total)} of accounts`} />
                  <Tile label="Daily ÷ monthly active" value={pct(stats.users.active_1d, stats.users.active_30d)} note="how often people come back" />
                  <Tile label="Have sent a nudge" value={pct(stats.users.ever_sent, stats.users.total)} note={`${stats.users.ever_sent} people`} />
                  <Tile label="Notifications on" value={pct(stats.users.with_notifications, stats.users.total)} note={`${stats.users.with_notifications} people`} />
                </div>
              </Section>

              <Section title="Last 30 days">
                <div className="bg-white rounded-xl border border-stone-200 p-3.5">
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {(Object.keys(SERIES_LABELS) as Series[]).map(key => (
                      <button
                        key={key}
                        onClick={() => setSeries(key)}
                        className={`px-3 py-1 rounded-full text-xs border ${
                          series === key ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-stone-300 text-stone-600'
                        }`}
                      >
                        {SERIES_LABELS[key]}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-end gap-[3px] h-32" role="img" aria-label={`${SERIES_LABELS[series]} per day, last 30 days`}>
                    {daily.map(d => (
                      <div key={d.day} className="flex-1 h-full flex flex-col justify-end" title={`${d.day}: ${d[series]}`}>
                        <div
                          className="w-full rounded-t-[3px] bg-brand-500"
                          style={{ height: `${(d[series] / max) * 100}%`, minHeight: d[series] ? 3 : 1, opacity: d[series] ? 1 : 0.25 }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[11px] text-stone-400 mt-1.5">
                    <span>{daily[0] && new Date(daily[0].day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span>busiest day: {max === 1 && !daily.some(d => d[series]) ? 0 : max}</span>
                    <span>Today</span>
                  </div>
                </div>
              </Section>

              <Section title="Nudges">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Tile label="All time" value={stats.nudges.total} note={`${stats.nudges.last_7d} this week · ${stats.nudges.last_30d} this month`} />
                  <Tile label="Per active person" value={stats.users.active_7d ? (stats.nudges.last_7d / stats.users.active_7d).toFixed(1) : '—'} note="nudges this week" />
                  <Tile label="Links" value={stats.nudges.links} />
                  <Tile label="Photos & files" value={stats.nudges.uploads} />
                  <Tile label="To-do lists" value={stats.nudges.todos} />
                  <Tile label="Group nudges" value={stats.nudges.groups} />
                  <Tile label="Public" value={stats.nudges.public} />
                  <Tile label="Marked 🤯 priority" value={stats.nudges.priority} />
                </div>
                {types.length > 0 && (
                  <div className="bg-white rounded-xl border border-stone-200 p-3.5 mt-2 space-y-2">
                    <p className="text-[12px] text-stone-500">By category</p>
                    {types.map(([type, count]) => (
                      <div key={type} className="flex items-center gap-2 text-sm">
                        <span className="w-32 shrink-0 truncate text-stone-700">
                          {type === 'none' ? 'No category' : CATEGORY_LABELS[type as keyof typeof CATEGORY_LABELS] ?? type}
                        </span>
                        <div className="flex-1 h-2.5 rounded-full bg-stone-100 overflow-hidden">
                          <div className="h-full rounded-full bg-gold-400" style={{ width: `${(count / typeMax) * 100}%` }} />
                        </div>
                        <span className="w-8 text-right tabular-nums text-stone-500">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Engagement">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Tile label="Nudges checked" value={pct(stats.engagement.checked, stats.engagement.shared)} note={`${stats.engagement.checked} of ${stats.engagement.shared} sent to others`} />
                  <Tile label="Typical time to check" value={duration(stats.engagement.median_minutes_to_check)} note="half are checked faster" />
                  <Tile label="Messages" value={stats.engagement.messages_total} note={`${stats.engagement.messages_7d} this week`} />
                  <Tile label="Reactions" value={stats.engagement.reactions_total} />
                  <Tile label="Likes on Popular" value={stats.engagement.likes_total} />
                  <Tile label="Saved to Favorites" value={stats.engagement.favorites_total} />
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
