import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Activity, Cpu, DollarSign, SlidersHorizontal,
  AlertTriangle, CheckCircle2, XCircle, Power, RefreshCw,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// API helpers — kept inline since the SOC page is largely self-contained and
// the shape is unlikely to be reused by other pages.
// ---------------------------------------------------------------------------

const BASE = '/api/social/soc';

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

async function jpost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

async function jdel<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SocSummary {
  eventsLast24h: number;
  blocksLast24h: number;
  reviewsLast24h: number;
  llmCallsLast24h: number;
  spendLast24hUsd: number;
  hourlyBuckets: Array<{ hour: string; total: number; blocks: number; reviews: number }>;
  killSwitch: boolean;
}

interface SecEvent {
  id: string;
  input_source: string;
  direction: 'inbound' | 'outbound';
  verdict: 'allow' | 'review' | 'block';
  severity: 'low' | 'medium' | 'high' | 'critical';
  risk_score: number;
  attack_categories: string;
  reason: string;
  evidence: string;
  input_hash: string;
  full_input: string;
  conversation_id: string | null;
  layer1_detections: string;
  layer2_verdict: string | null;
  layer2_score: number | null;
  layer2_reasoning: string | null;
  duration_ms: number;
  created_at: string;
}

interface LlmCall {
  id: string;
  caller: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  prompt_hash: string;
  cached_response: number;
  duration_ms: number;
  error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Top-level page
// ---------------------------------------------------------------------------

type Tab = 'live' | 'layers' | 'llm' | 'spend' | 'settings';

export default function Operations() {
  const [tab, setTab] = useState<Tab>('live');

  const summaryQ = useQuery<SocSummary>({
    queryKey: ['soc-summary'],
    queryFn: () => jget<SocSummary>('/summary'),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-7 w-7 text-brand-cyan" />
            Operations
          </h1>
          <p className="mt-1 text-sm text-muted">
            Security Operations Console — every defense decision, every model call, every operator override.
          </p>
        </div>
        {summaryQ.data?.killSwitch && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <Power className="h-4 w-4" />
            Agent kill switch is ON
          </div>
        )}
      </header>

      <StatStrip s={summaryQ.data} />

      <Tabs current={tab} onChange={setTab} />

      <div>
        {tab === 'live' && <LiveTab />}
        {tab === 'layers' && <LayersTab summary={summaryQ.data} />}
        {tab === 'llm' && <LlmTab />}
        {tab === 'spend' && <SpendTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat strip + tabs
// ---------------------------------------------------------------------------

function StatStrip({ s }: { s: SocSummary | undefined }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
      <StatCard label="Events / 24h" value={s?.eventsLast24h ?? '—'} icon={Activity} tone="cyan" />
      <StatCard label="Blocks / 24h" value={s?.blocksLast24h ?? '—'} icon={XCircle} tone="red" />
      <StatCard label="Reviews / 24h" value={s?.reviewsLast24h ?? '—'} icon={AlertTriangle} tone="amber" />
      <StatCard label="LLM calls / 24h" value={s?.llmCallsLast24h ?? '—'} icon={Cpu} tone="purple" />
      <StatCard label="Spend / 24h" value={s ? `$${s.spendLast24hUsd.toFixed(3)}` : '—'} icon={DollarSign} tone="green" />
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, tone,
}: { label: string; value: string | number; icon: any; tone: 'cyan' | 'red' | 'amber' | 'purple' | 'green' }) {
  const toneColor: Record<string, string> = {
    cyan: 'text-brand-cyan',
    red: 'text-red-400',
    amber: 'text-amber-400',
    purple: 'text-brand-purple',
    green: 'text-emerald-400',
  };
  return (
    <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
        <Icon className={`h-4 w-4 ${toneColor[tone]}`} />
      </div>
      <p className="mt-2 text-2xl font-semibold text-primaryText">{value}</p>
    </div>
  );
}

function Tabs({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  const items: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'live', label: 'Live Events', icon: Activity },
    { id: 'layers', label: 'Defense Layers', icon: Shield },
    { id: 'llm', label: 'LLM Calls', icon: Cpu },
    { id: 'spend', label: 'Spend & Caps', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
  ];
  return (
    <div className="flex gap-1 border-b border-border-strong">
      {items.map((it) => {
        const active = current === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
              active
                ? 'border-b-2 border-brand-cyan text-primaryText'
                : 'text-muted hover:text-secondaryText'
            }`}
          >
            <it.icon className="h-4 w-4" /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Live Events
// ---------------------------------------------------------------------------

function LiveTab() {
  const [filters, setFilters] = useState<{
    verdict?: string; severity?: string; source?: string; direction?: string;
  }>({});
  const qc = useQueryClient();

  const evQ = useQuery<{ items: SecEvent[] }>({
    queryKey: ['soc-events', filters],
    queryFn: () => {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
      p.set('limit', '100');
      return jget(`/events?${p}`);
    },
    refetchInterval: 4_000,
  });

  const [selected, setSelected] = useState<SecEvent | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onClear={() => setFilters({})}
        />
        <div className="rounded-xl border border-border-strong bg-surface-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-faint text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Dir</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Verdict</th>
                <th className="px-3 py-2 text-left">Sev</th>
                <th className="px-3 py-2 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(evQ.data?.items ?? []).map((e) => (
                <tr
                  key={e.id}
                  className={`cursor-pointer border-t border-border-strong hover:bg-surface-faint ${
                    selected?.id === e.id ? 'bg-surface-faint' : ''
                  }`}
                  onClick={() => setSelected(e)}
                >
                  <td className="px-3 py-2 text-muted">{e.created_at.slice(11, 19)}</td>
                  <td className="px-3 py-2"><DirBadge d={e.direction} /></td>
                  <td className="px-3 py-2 text-xs">{e.input_source}</td>
                  <td className="px-3 py-2"><VerdictBadge v={e.verdict} /></td>
                  <td className="px-3 py-2"><SevBadge s={e.severity} /></td>
                  <td className="px-3 py-2 truncate max-w-[300px] text-secondaryText" title={e.reason}>
                    {e.reason || '—'}
                  </td>
                </tr>
              ))}
              {evQ.data && evQ.data.items.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">
                  No events match the current filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <EventDetailPanel event={selected} onReplay={() => qc.invalidateQueries({ queryKey: ['soc-events'] })} />
      </div>
    </div>
  );
}

function FilterBar({
  filters, onChange, onClear,
}: { filters: any; onChange: (f: any) => void; onClear: () => void }) {
  const set = (k: string, v: string) => onChange({ ...filters, [k]: v || undefined });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select className="rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-secondaryText" value={filters.verdict ?? ''} onChange={(e) => set('verdict', e.target.value)}>
        <option value="">All verdicts</option>
        <option value="allow">Allow</option>
        <option value="review">Review</option>
        <option value="block">Block</option>
      </select>
      <select className="rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-secondaryText" value={filters.severity ?? ''} onChange={(e) => set('severity', e.target.value)}>
        <option value="">All severities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <select className="rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-secondaryText" value={filters.direction ?? ''} onChange={(e) => set('direction', e.target.value)}>
        <option value="">In + Out</option>
        <option value="inbound">Inbound</option>
        <option value="outbound">Outbound</option>
      </select>
      <select className="rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-secondaryText" value={filters.source ?? ''} onChange={(e) => set('source', e.target.value)}>
        <option value="">All sources</option>
        <option value="chat">chat</option>
        <option value="telegram">telegram</option>
        <option value="webhook">webhook</option>
        <option value="email">email</option>
        <option value="web">web</option>
        <option value="tool_output">tool_output</option>
        <option value="skill">skill</option>
        <option value="internal">internal</option>
      </select>
      <button className="rounded-md border border-border-strong px-2 py-1 text-muted hover:text-secondaryText" onClick={onClear}>
        Clear
      </button>
      <span className="ml-auto text-muted flex items-center gap-1">
        <RefreshCw className="h-3 w-3 animate-spin" /> auto-refresh 4s
      </span>
    </div>
  );
}

function EventDetailPanel({ event, onReplay }: { event: SecEvent | null; onReplay: () => void }) {
  const qc = useQueryClient();
  const details = useQuery<{ event: SecEvent; reviews: any[] }>({
    queryKey: ['soc-event', event?.id],
    queryFn: () => jget(`/events/${event!.id}`),
    enabled: !!event,
  });

  const markFp = useMutation({
    mutationFn: () => jpost(`/events/${event!.id}/false-positive`, { note: 'marked from SOC' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soc-event', event?.id] }),
  });

  const reclassify = useMutation({
    mutationFn: (severity: string) => jpost(`/events/${event!.id}/reclassify`, { severity, note: 'reclassified from SOC' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soc-event', event?.id] }),
  });

  const banHash = useMutation({
    mutationFn: () => jpost(`/bans`, { hash: event!.input_hash, reason: 'banned from SOC drill-down' }),
  });

  const replay = useMutation({
    mutationFn: () => jpost<any>(`/events/${event!.id}/replay`),
    onSuccess: onReplay,
  });

  if (!event) {
    return (
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4 text-sm text-muted">
        Select an event for details + actions.
      </div>
    );
  }

  const cats = safeJson<string[]>(event.attack_categories) ?? [];
  const l1 = safeJson<any[]>(event.layer1_detections) ?? [];

  return (
    <div className="rounded-xl border border-border-strong bg-surface-soft p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted">Event</p>
        <p className="font-mono text-xs break-all text-secondaryText">{event.id}</p>
        <p className="mt-1 text-xs text-muted">{event.created_at}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Kv k="Verdict" v={<VerdictBadge v={event.verdict} />} />
        <Kv k="Severity" v={<SevBadge s={event.severity} />} />
        <Kv k="Direction" v={event.direction} />
        <Kv k="Source" v={event.input_source} />
        <Kv k="Risk score" v={event.risk_score.toFixed(2)} />
        <Kv k="Duration" v={`${event.duration_ms} ms`} />
      </div>

      {cats.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Attack categories</p>
          <div className="flex flex-wrap gap-1">
            {cats.map((c) => (
              <span key={c} className="rounded-md border border-border-strong bg-surface-faint px-2 py-0.5 text-xs">{c}</span>
            ))}
          </div>
        </div>
      )}

      {event.reason && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Reason</p>
          <p className="text-sm text-secondaryText">{event.reason}</p>
        </div>
      )}

      {event.evidence && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Evidence</p>
          <pre className="rounded-md bg-surface-faint p-2 text-xs whitespace-pre-wrap break-words text-secondaryText max-h-40 overflow-y-auto">
            {event.evidence}
          </pre>
        </div>
      )}

      {event.full_input && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Full input</p>
          <pre className="rounded-md bg-surface-faint p-2 text-xs whitespace-pre-wrap break-words text-secondaryText max-h-40 overflow-y-auto">
            {event.full_input}
          </pre>
        </div>
      )}

      {l1.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Layer 1 detections</p>
          <ul className="text-xs space-y-0.5">
            {l1.map((d: any, i: number) => (
              <li key={i} className="text-secondaryText">• {d.category}/{d.signature ?? '?'} ({d.severity ?? '?'})</li>
            ))}
          </ul>
        </div>
      )}

      {event.layer2_reasoning && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Layer 2 reasoning</p>
          <p className="text-xs text-secondaryText">{event.layer2_reasoning}</p>
        </div>
      )}

      {details.data && details.data.reviews.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Reviews</p>
          <ul className="text-xs space-y-1">
            {details.data.reviews.map((r) => (
              <li key={r.id} className="text-secondaryText">
                {r.created_at.slice(0, 19)} — <span className="text-primaryText">{r.action}</span>
                {r.new_severity && ` → ${r.new_severity}`}
                {r.note && ` ("${r.note}")`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border-strong">
        <button onClick={() => markFp.mutate()} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">Mark false-positive</button>
        <button onClick={() => reclassify.mutate('critical')} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">Reclassify → critical</button>
        <button onClick={() => reclassify.mutate('high')} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">→ high</button>
        <button onClick={() => reclassify.mutate('low')} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">→ low</button>
        <button onClick={() => banHash.mutate()} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">Ban this input_hash</button>
        {event.direction === 'inbound' && event.full_input && (
          <button onClick={() => replay.mutate()} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">Replay through layers</button>
        )}
      </div>

      {replay.data && (
        <pre className="rounded-md bg-surface-faint p-2 text-xs whitespace-pre-wrap">
          {JSON.stringify(replay.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Defense Layers
// ---------------------------------------------------------------------------

function LayersTab({ summary }: { summary: SocSummary | undefined }) {
  const evQ = useQuery<{ items: SecEvent[] }>({
    queryKey: ['soc-events-24h'],
    queryFn: () => jget(`/events?limit=200&since=${new Date(Date.now() - 86400_000).toISOString()}`),
    refetchInterval: 10_000,
  });

  const layer1Stats = useMemo(() => layer1Counts(evQ.data?.items ?? []), [evQ.data]);
  const layer2Stats = useMemo(() => layer2Counts(evQ.data?.items ?? []), [evQ.data]);
  const layerCategoryStats = useMemo(() => categoryCounts(evQ.data?.items ?? []), [evQ.data]);

  const chartData = (summary?.hourlyBuckets ?? []).map((b) => ({
    hour: b.hour.slice(11, 13) + 'h',
    total: b.total,
    blocks: b.blocks,
    reviews: b.reviews,
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
        <p className="text-xs uppercase tracking-widest text-muted mb-2">Events per hour (last 24h)</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="total" stackId="a" fill="#3b82f6" />
              <Bar dataKey="reviews" stackId="b" fill="#f59e0b" />
              <Bar dataKey="blocks" stackId="b" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <LayerCard
          name="L1 — Sanitizer"
          subtitle="Deterministic signatures + decoding"
          count={layer1Stats.total}
          firedRules={layer1Stats.top}
        />
        <LayerCard
          name="L2 — Frontier scanner"
          subtitle="LLM classification of cleaned input"
          count={layer2Stats.invocations}
          firedRules={Object.entries(layer2Stats.verdicts).map(([k, v]) => ({ name: k, count: v }))}
        />
        <LayerCard
          name="Categories (24h)"
          subtitle="Cross-layer attack categorisation"
          count={Object.values(layerCategoryStats).reduce((a, b) => a + b, 0)}
          firedRules={Object.entries(layerCategoryStats).map(([k, v]) => ({ name: k, count: v }))}
        />
      </div>
    </div>
  );
}

function LayerCard({
  name, subtitle, count, firedRules,
}: { name: string; subtitle: string; count: number; firedRules: Array<{ name: string; count: number }> }) {
  return (
    <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
      <p className="text-xs uppercase tracking-widest text-muted">{name}</p>
      <p className="text-xs text-muted">{subtitle}</p>
      <p className="mt-2 text-3xl font-semibold">{count}</p>
      <p className="text-xs text-muted mb-2">fires in last 24h</p>
      <ul className="text-xs space-y-1">
        {firedRules.slice(0, 8).map((r) => (
          <li key={r.name} className="flex items-center justify-between">
            <span className="text-secondaryText truncate">{r.name}</span>
            <span className="text-primaryText">{r.count}</span>
          </li>
        ))}
        {firedRules.length === 0 && <li className="text-muted">— none yet —</li>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: LLM Calls
// ---------------------------------------------------------------------------

function LlmTab() {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const q = useQuery<{ items: LlmCall[]; byCallerLast24h: any[] }>({
    queryKey: ['soc-llm', errorsOnly],
    queryFn: () => jget(`/llm-calls?limit=100${errorsOnly ? '&errorsOnly=true' : ''}`),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
        <p className="text-xs uppercase tracking-widest text-muted mb-2">Caller summary — last 24h</p>
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="text-left py-1">Caller</th>
              <th className="text-right py-1">Calls</th>
              <th className="text-right py-1">Cached</th>
              <th className="text-right py-1">Errors</th>
              <th className="text-right py-1">Tokens</th>
              <th className="text-right py-1">Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.byCallerLast24h ?? []).map((r: any) => (
              <tr key={r.caller} className="border-t border-border-strong">
                <td className="py-1 font-mono">{r.caller}</td>
                <td className="py-1 text-right">{r.calls}</td>
                <td className="py-1 text-right">{r.cached}</td>
                <td className={`py-1 text-right ${r.errors > 0 ? 'text-red-400' : ''}`}>{r.errors}</td>
                <td className="py-1 text-right">{r.tokens?.toLocaleString() ?? '—'}</td>
                <td className="py-1 text-right font-semibold">${Number(r.cost ?? 0).toFixed(4)}</td>
              </tr>
            ))}
            {(q.data?.byCallerLast24h ?? []).length === 0 && (
              <tr><td colSpan={6} className="py-3 text-center text-muted">No calls in last 24h.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-muted">Recent calls</p>
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          errors only
        </label>
      </div>

      <div className="rounded-xl border border-border-strong bg-surface-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-faint text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Caller</th>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">ms</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.items ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border-strong">
                <td className="px-3 py-2 text-muted">{c.created_at.slice(11, 19)}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.caller}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.model}</td>
                <td className="px-3 py-2 text-right">{(c.prompt_tokens + c.completion_tokens).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">${c.cost_usd.toFixed(4)}</td>
                <td className="px-3 py-2 text-right">{c.duration_ms}</td>
                <td className="px-3 py-2">
                  {c.error ? <span className="text-red-400">err</span>
                    : c.cached_response ? <span className="text-amber-400">cached</span>
                    : <span className="text-emerald-400">ok</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Spend & Caps
// ---------------------------------------------------------------------------

function SpendTab() {
  const spendQ = useQuery<{ items: any[] }>({
    queryKey: ['soc-spend'],
    queryFn: () => jget('/spend'),
    refetchInterval: 5_000,
  });
  const settingsQ = useQuery<{ state: Array<{ key: string; value: string }> }>({
    queryKey: ['soc-settings'],
    queryFn: () => jget('/settings'),
    refetchInterval: 10_000,
  });

  const spendCap = settingsQ.data?.state.find((s) => s.key === 'spend_usd_per_hour')?.value;
  const callsCap = settingsQ.data?.state.find((s) => s.key === 'calls_per_hour')?.value;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
        <p className="text-xs uppercase tracking-widest text-muted">Active caps</p>
        <p className="mt-2 text-sm">
          Spend / hour: <span className="font-mono">{spendCap ?? 'default (env)'}</span>
        </p>
        <p className="text-sm">
          Calls / hour: <span className="font-mono">{callsCap ?? 'default (env)'}</span>
        </p>
        <p className="mt-2 text-xs text-muted">
          Edit in the Settings tab to override. Cleared values fall back to AGENT_SPEND_USD_PER_HOUR / AGENT_CALLS_PER_HOUR env defaults.
        </p>
      </div>

      <div className="rounded-xl border border-border-strong bg-surface-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-faint text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Caller</th>
              <th className="px-3 py-2 text-left">Window start</th>
              <th className="px-3 py-2 text-right">Calls in window</th>
              <th className="px-3 py-2 text-right">Cost (USD)</th>
              <th className="px-3 py-2 text-left">Window</th>
            </tr>
          </thead>
          <tbody>
            {(spendQ.data?.items ?? []).map((s: any) => (
              <tr key={s.id} className="border-t border-border-strong">
                <td className="px-3 py-2 font-mono">{s.caller}</td>
                <td className="px-3 py-2 text-muted text-xs">{s.window_start}</td>
                <td className="px-3 py-2 text-right">{s.call_count}</td>
                <td className="px-3 py-2 text-right">${Number(s.total_cost_usd).toFixed(4)}</td>
                <td className="px-3 py-2 text-xs">{s.window_seconds}s</td>
              </tr>
            ))}
            {(spendQ.data?.items ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No spend windows yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Settings (operator console controls)
// ---------------------------------------------------------------------------

function SettingsTab() {
  const qc = useQueryClient();
  const q = useQuery<{
    state: Array<{ key: string; value: string }>;
    bans: Array<{ hash: string; reason: string; expires_at: string | null; created_at: string }>;
    blocks: Array<{ id: string; category: string; blocked_until: string; reason: string }>;
  }>({
    queryKey: ['soc-settings'],
    queryFn: () => jget('/settings'),
    refetchInterval: 5_000,
  });

  const killOn = (q.data?.state.find((s) => s.key === 'kill_switch')?.value ?? 'off') === 'on';
  const spend = q.data?.state.find((s) => s.key === 'spend_usd_per_hour')?.value ?? '';
  const calls = q.data?.state.find((s) => s.key === 'calls_per_hour')?.value ?? '';

  const [spendInput, setSpendInput] = useState(spend);
  const [callsInput, setCallsInput] = useState(calls);

  useEffect(() => setSpendInput(spend), [spend]);
  useEffect(() => setCallsInput(calls), [calls]);

  const toggleKill = useMutation({
    mutationFn: () => jpost('/settings/kill-switch', { on: !killOn }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soc-settings'] }),
  });

  const saveCaps = useMutation({
    mutationFn: () => jpost('/settings/caps', {
      spendUsdPerHour: spendInput === '' ? null : Number(spendInput),
      callsPerHour: callsInput === '' ? null : Number(callsInput),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soc-settings'] }),
  });

  const deleteBan = useMutation({
    mutationFn: (hash: string) => jdel(`/bans/${hash}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soc-settings'] }),
  });

  const deleteBlock = useMutation({
    mutationFn: (id: string) => jdel(`/category-blocks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soc-settings'] }),
  });

  const [newCat, setNewCat] = useState('');
  const [newHours, setNewHours] = useState(2);
  const addBlock = useMutation({
    mutationFn: () => jpost('/category-blocks', {
      category: newCat,
      blockedUntil: new Date(Date.now() + newHours * 3600_000).toISOString(),
      reason: 'manual block from SOC',
    }),
    onSuccess: () => {
      setNewCat('');
      qc.invalidateQueries({ queryKey: ['soc-settings'] });
    },
  });

  return (
    <div className="space-y-4">
      {/* Kill switch */}
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted">Agent kill switch</p>
            <p className="text-sm text-secondaryText mt-1">
              {killOn
                ? 'Agent is currently SUSPENDED. New /chat turns refuse before reaching the LLM.'
                : 'Agent is running. Toggle ON to suspend immediately.'}
            </p>
          </div>
          <button
            onClick={() => toggleKill.mutate()}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              killOn
                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                : 'bg-red-500/20 border border-red-500/40 text-red-300'
            }`}
          >
            {killOn ? 'Resume agent' : 'Suspend agent'}
          </button>
        </div>
      </div>

      {/* Caps */}
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4 space-y-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted">Hot caps</p>
          <p className="text-xs text-muted">Empty = fall back to env defaults.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="text-muted">Spend USD / hour</span>
            <input
              type="number" step="0.1" min="0"
              value={spendInput} onChange={(e) => setSpendInput(e.target.value)}
              className="mt-1 w-full rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-sm text-secondaryText"
              placeholder="e.g. 2.0"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted">Calls / hour</span>
            <input
              type="number" min="0"
              value={callsInput} onChange={(e) => setCallsInput(e.target.value)}
              className="mt-1 w-full rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-sm text-secondaryText"
              placeholder="e.g. 500"
            />
          </label>
        </div>
        <button onClick={() => saveCaps.mutate()} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">Save caps</button>
      </div>

      {/* Banned hashes */}
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
        <p className="text-xs uppercase tracking-widest text-muted mb-2">Banned input hashes</p>
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr><th className="text-left py-1">Hash</th><th className="text-left">Reason</th><th className="text-left">Expires</th><th /></tr>
          </thead>
          <tbody>
            {(q.data?.bans ?? []).map((b) => (
              <tr key={b.hash} className="border-t border-border-strong">
                <td className="py-1 font-mono">{b.hash.slice(0, 24)}…</td>
                <td className="py-1">{b.reason || '—'}</td>
                <td className="py-1">{b.expires_at ?? 'never'}</td>
                <td className="py-1 text-right">
                  <button onClick={() => deleteBan.mutate(b.hash)} className="text-red-400 hover:underline">remove</button>
                </td>
              </tr>
            ))}
            {(q.data?.bans ?? []).length === 0 && (
              <tr><td colSpan={4} className="py-2 text-muted">No bans. Use the Live Events drill-down to ban a specific input_hash.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Category blocks */}
      <div className="rounded-xl border border-border-strong bg-surface-soft p-4">
        <p className="text-xs uppercase tracking-widest text-muted mb-2">Active category blocks</p>
        <table className="w-full text-xs mb-3">
          <thead className="text-muted">
            <tr><th className="text-left py-1">Category</th><th className="text-left">Until</th><th className="text-left">Reason</th><th /></tr>
          </thead>
          <tbody>
            {(q.data?.blocks ?? []).map((b) => (
              <tr key={b.id} className="border-t border-border-strong">
                <td className="py-1 font-mono">{b.category}</td>
                <td className="py-1">{b.blocked_until}</td>
                <td className="py-1">{b.reason || '—'}</td>
                <td className="py-1 text-right">
                  <button onClick={() => deleteBlock.mutate(b.id)} className="text-red-400 hover:underline">remove</button>
                </td>
              </tr>
            ))}
            {(q.data?.blocks ?? []).length === 0 && (
              <tr><td colSpan={4} className="py-2 text-muted">No active blocks.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center gap-2">
          <input
            value={newCat} onChange={(e) => setNewCat(e.target.value)}
            placeholder="category (e.g. jailbreak)"
            className="flex-1 rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-sm text-secondaryText"
          />
          <input
            type="number" min="1" max="168" value={newHours}
            onChange={(e) => setNewHours(Number(e.target.value))}
            className="w-24 rounded-md border border-border-strong bg-surface-faint px-2 py-1 text-sm text-secondaryText" placeholder="hours"
          />
          <button onClick={() => addBlock.mutate()} disabled={!newCat} className="rounded-md border border-border-strong bg-surface-faint px-3 py-1.5 text-xs text-secondaryText hover:bg-surface-soft hover:text-primaryText transition-colors">Block</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

function VerdictBadge({ v }: { v: 'allow' | 'review' | 'block' }) {
  const map: Record<string, string> = {
    allow: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
    review: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
    block: 'bg-red-500/15 border-red-500/40 text-red-300',
  };
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${map[v]}`}>{v}</span>;
}

function SevBadge({ s }: { s: 'low' | 'medium' | 'high' | 'critical' }) {
  const map: Record<string, string> = {
    low: 'text-muted',
    medium: 'text-amber-400',
    high: 'text-orange-400',
    critical: 'text-red-400 font-semibold',
  };
  return <span className={`text-xs uppercase ${map[s]}`}>{s}</span>;
}

function DirBadge({ d }: { d: 'inbound' | 'outbound' }) {
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${
      d === 'inbound' ? 'border-brand-cyan/40 text-brand-cyan' : 'border-brand-purple/40 text-brand-purple'
    }`}>
      {d === 'inbound' ? 'in' : 'out'}
    </span>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted">{k}</p>
      <p className="text-primaryText">{v}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregation helpers (run in render — small N)
// ---------------------------------------------------------------------------

function layer1Counts(events: SecEvent[]): { total: number; top: Array<{ name: string; count: number }> } {
  const m = new Map<string, number>();
  let total = 0;
  for (const ev of events) {
    const arr = safeJson<any[]>(ev.layer1_detections) ?? [];
    for (const d of arr) {
      const k = `${d.category}/${d.signature ?? '?'}`;
      m.set(k, (m.get(k) ?? 0) + 1);
      total += 1;
    }
  }
  const top = Array.from(m.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { total, top };
}

function layer2Counts(events: SecEvent[]): { invocations: number; verdicts: Record<string, number> } {
  const verdicts: Record<string, number> = {};
  let invocations = 0;
  for (const ev of events) {
    if (ev.layer2_verdict) {
      invocations += 1;
      verdicts[ev.layer2_verdict] = (verdicts[ev.layer2_verdict] ?? 0) + 1;
    }
  }
  return { invocations, verdicts };
}

function categoryCounts(events: SecEvent[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const ev of events) {
    const cats = safeJson<string[]>(ev.attack_categories) ?? [];
    for (const c of cats) m[c] = (m[c] ?? 0) + 1;
  }
  return m;
}
