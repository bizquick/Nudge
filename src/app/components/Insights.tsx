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

interface ReportRow {
  id: string;
  reporter_name: string | null;
  kind: 'nudge' | 'message' | 'user';
  target_id: string | null;
  target_user: string | null;
  reason: string;
  details: string | null;
  snapshot: string | null;
  created_at: string;
}

interface UserRow {
  display_name: string;
  email: string | null;
  joined: string;
  last_active: string | null;
  sent: number;
  received: number;
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
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
  // Everyone's account (owner only — the database refuses anyone else)
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [showAllUsers, setShowAllUsers] = useState(false);
  // Reports people sent in (Apple expects them handled within a day)
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [busyReport, setBusyReport] = useState<string | null>(null);
  const resolve = async (r: ReportRow, remove: boolean) => {
    if (remove && !confirm(`Delete this ${r.kind} for everyone?`)) return;
    setBusyReport(r.id);
    const { error: err } = await supabase.rpc('admin_resolve_report', { p_report: r.id, p_remove: remove });
    setBusyReport(null);
    if (err) { alert("Couldn't update that report."); console.error(err); return; }
    setReports(prev => (prev ?? []).filter(x => x.id !== r.id));
  };
  // Removes the person entirely: their account and everything they posted
  const removeUser = async (r: ReportRow) => {
    if (!r.target_user || !confirm(`Remove ${r.target_user}? This deletes their account and everything they've posted, for everyone. It can't be undone.`)) return;
    setBusyReport(r.id);
    const { error: err } = await supabase.rpc('admin_remove_user', { p_name: r.target_user });
    setBusyReport(null);
    if (err) { alert(err.message || "Couldn't remove that user."); console.error(err); return; }
    setReports(prev => (prev ?? []).filter(x => x.target_user !== r.target_user));
  };

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
    const { data: userRows, error: userErr } = await supabase.rpc('admin_users');
    if (userErr) console.warn('User list unavailable', userErr);
    else setUsers(((userRows || []) as UserRow[]).map(u => ({ ...u, sent: Number(u.sent), received: Number(u.received) })));
    const { data: reportRows, error: reportErr } = await supabase.from('reports')
      .select('id, reporter_name, kind, target_id, target_user, reason, details, snapshot, created_at')
      .eq('status', 'open').order('created_at', { ascending: false });
    if (reportErr) console.warn('Reports unavailable', reportErr);
    else setReports((reportRows || []) as ReportRow[]);
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
            App-wide numbers and your user list, only visible to you. Never anyone's nudges or messages.
            {stats && ` Updated ${new Date(stats.generated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`}
          </p>

          {error && <p className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</p>}

          {/* Reports to review: remove what breaks the rules, or dismiss */}
          {reports && (
            <Section title={`Reports${reports.length ? ` (${reports.length})` : ''}`}>
              {reports.length === 0 ? (
                <p className="text-sm text-stone-500">Nothing to review. Reports people send show up here.</p>
              ) : (
                <div className="space-y-2">
                  {reports.map(r => (
                    <div key={r.id} className="bg-white rounded-xl border border-red-200 p-3.5">
                      <p className="text-[13px] text-stone-900">
                        <span className="font-medium">{r.reason}</span>
                        <span className="text-stone-500"> · {r.kind === 'user' ? 'person' : r.kind} by {r.target_user ?? 'someone'}</span>
                      </p>
                      <p className="text-[11px] text-stone-400">Reported by {r.reporter_name ?? 'a deleted account'} · {shortDate(r.created_at)}</p>
                      {r.snapshot && <p className="mt-2 p-2.5 rounded-lg bg-stone-50 text-[13px] text-stone-700 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.snapshot}</p>}
                      {r.details && <p className="mt-1.5 text-[12px] text-stone-600">“{r.details}”</p>}
                      <div className="mt-2.5 flex gap-2">
                        {r.kind !== 'user' && r.target_id && (
                          <button onClick={() => resolve(r, true)} disabled={busyReport === r.id} className="flex-1 h-9 rounded-lg bg-red-600 text-white text-sm disabled:opacity-50">
                            Remove it
                          </button>
                        )}
                        <button onClick={() => resolve(r, false)} disabled={busyReport === r.id} className="flex-1 h-9 rounded-lg border border-stone-300 text-stone-700 text-sm disabled:opacity-50">
                          Dismiss
                        </button>
                        {r.target_user && (
                          <button onClick={() => removeUser(r)} disabled={busyReport === r.id} className="h-9 px-3 rounded-lg text-red-600 text-sm disabled:opacity-50">
                            Remove user
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
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

              {users && (
                <Section title={`Users (${users.length})`}>
                  <input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Search by name or email"
                    className="w-full mb-2 px-3 py-2 rounded-xl border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
                    {(() => {
                      const q = userQuery.trim().toLowerCase();
                      const matches = users.filter(u => !q || u.display_name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q));
                      const shown = showAllUsers || q ? matches : matches.slice(0, 25);
                      return (
                        <>
                          {shown.map(u => (
                            <div key={u.display_name} className="px-3.5 py-2.5">
                              <div className="flex items-baseline gap-2">
                                <span className="flex-1 min-w-0 truncate text-stone-900">{u.display_name}</span>
                                <span className="text-[11px] text-stone-400 shrink-0">joined {shortDate(u.joined)}</span>
                              </div>
                              <p className="text-[12px] text-stone-500 truncate">{u.email ?? 'no email'}</p>
                              <p className="text-[11px] text-stone-400">
                                {u.sent} sent · {u.received} received · last active {shortDate(u.last_active)}
                              </p>
                            </div>
                          ))}
                          {matches.length === 0 && <p className="px-3.5 py-3 text-sm text-stone-500">No one matches.</p>}
                          {!showAllUsers && !q && matches.length > 25 && (
                            <button onClick={() => setShowAllUsers(true)} className="w-full px-3.5 py-2.5 text-sm text-brand-600">
                              Show all {matches.length}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </Section>
              )}

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
