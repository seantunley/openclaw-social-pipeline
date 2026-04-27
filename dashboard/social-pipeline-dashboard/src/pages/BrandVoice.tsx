import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Sparkles } from 'lucide-react';
import Toast, { type ToastKind } from '@/components/Toast';
import { fetchBrandProfile, saveBrandProfile } from '@/lib/api';

type DraftProfile = {
  name: string;
  description: string;
  audience: string;
  tone: string;
  voice: string;
  writing_guidelines: string;
  banned_words: string;
  required_phrases: string;
  signature_phrases: string;
  target_keywords: string;
  target_hashtags: string;
  audience_pain_points: string;
  audience_aspirations: string;
  archetype: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string;
  mission: string;
};

const empty: DraftProfile = {
  name: '',
  description: '',
  audience: '',
  tone: '',
  voice: '',
  writing_guidelines: '',
  banned_words: '',
  required_phrases: '',
  signature_phrases: '',
  target_keywords: '',
  target_hashtags: '',
  audience_pain_points: '',
  audience_aspirations: '',
  archetype: '',
  primary_color: '',
  secondary_color: '',
  accent_color: '',
  logo_url: '',
  mission: '',
};

const ARCHETYPES = [
  '',
  'Sage',
  'Caregiver',
  'Hero',
  'Outlaw',
  'Magician',
  'Ruler',
  'Creator',
  'Innocent',
  'Explorer',
  'Lover',
  'Jester',
  'Everyman',
];

export default function BrandVoice() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['brand-profile'],
    queryFn: () => fetchBrandProfile(),
  });

  const [draft, setDraft] = useState<DraftProfile>(empty);
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);

  useEffect(() => {
    if (data?.profile) {
      const p = data.profile;
      setDraft({
        name: p.name,
        description: p.description,
        audience: p.audience,
        tone: p.tone,
        voice: p.voice,
        writing_guidelines: p.writing_guidelines,
        banned_words: p.banned_words.join(', '),
        required_phrases: p.required_phrases.join(' | '),
        signature_phrases: p.signature_phrases.join(' | '),
        target_keywords: p.target_keywords.join(', '),
        target_hashtags: p.target_hashtags.join(' '),
        audience_pain_points: p.audience_pain_points.join('; '),
        audience_aspirations: p.audience_aspirations.join('; '),
        archetype: p.archetype,
        primary_color: p.primary_color,
        secondary_color: p.secondary_color,
        accent_color: p.accent_color,
        logo_url: p.logo_url,
        mission: p.mission,
      });
    }
  }, [data]);

  const save = useMutation({
    // The API accepts both string[] (canonical) and the comma/semicolon
    // separated string form for list fields — its serialiseInput handles
    // both. Cast through Partial<BrandProfile> to satisfy the typed signature.
    mutationFn: () => saveBrandProfile(draft as unknown as Partial<import('@/lib/api').BrandProfile>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profile'] });
      setToast({ kind: 'success', message: 'Brand voice saved. Future runs will apply it.' });
    },
    onError: (err) => {
      setToast({ kind: 'error', message: `Save failed: ${(err as Error).message}` });
    },
  });

  const set = <K extends keyof DraftProfile>(key: K, value: DraftProfile[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <Sparkles className="h-6 w-6" /> Brand voice
          </h1>
          <p className="mt-1 text-sm text-muted">
            Loaded into every prompt at run time. Free-text fields are appended verbatim;
            list fields take comma-separated values.
          </p>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || isLoading}
          className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      {toast && (
        <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-white/5 animate-skeleton-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <Section label="Identity">
            <Field label="Brand name" value={draft.name} onChange={(v) => set('name', v)} placeholder="e.g. Latch & Learn" />
            <Field label="One-liner description" value={draft.description} onChange={(v) => set('description', v)} placeholder="What you do, in one sentence" />
            <Textarea label="Mission" value={draft.mission} onChange={(v) => set('mission', v)} placeholder="Long-form mission statement" rows={3} />
            <Select
              label="Archetype"
              value={draft.archetype}
              onChange={(v) => set('archetype', v)}
              options={ARCHETYPES}
            />
          </Section>

          <Section label="Audience">
            <Textarea label="Primary audience" value={draft.audience} onChange={(v) => set('audience', v)} placeholder="Who you write to. Be specific." rows={2} />
            <Field
              label="Pain points (semicolon-separated)"
              value={draft.audience_pain_points}
              onChange={(v) => set('audience_pain_points', v)}
              placeholder="e.g. low milk supply; no paid leave; nobody told them what was normal"
            />
            <Field
              label="Aspirations (semicolon-separated)"
              value={draft.audience_aspirations}
              onChange={(v) => set('audience_aspirations', v)}
              placeholder="e.g. confident first 6 weeks; sustained breastfeeding through return-to-work"
            />
          </Section>

          <Section label="Voice & tone">
            <Textarea label="Tone" value={draft.tone} onChange={(v) => set('tone', v)} placeholder="warm, authoritative, not preachy, lightly self-deprecating" rows={2} />
            <Textarea label="Voice" value={draft.voice} onChange={(v) => set('voice', v)} placeholder="second person, contractions allowed, no exclamation marks, never address the reader as 'guys'" rows={2} />
            <Textarea label="Writing guidelines" value={draft.writing_guidelines} onChange={(v) => set('writing_guidelines', v)} placeholder="sentence length cap, paragraph rhythm, opening conventions" rows={4} />
          </Section>

          <Section label="Vocabulary">
            <Field label="Banned words / phrases (comma-separated)" value={draft.banned_words} onChange={(v) => set('banned_words', v)} placeholder="game-changer, leverage, synergy" />
            <Field label="Required phrases (separated by |)" value={draft.required_phrases} onChange={(v) => set('required_phrases', v)} placeholder="Trust your body. | We see you." />
            <Field label="Signature phrases (separated by |)" value={draft.signature_phrases} onChange={(v) => set('signature_phrases', v)} placeholder="optional repeating phrases" />
          </Section>

          <Section label="SEO + GEO targeting">
            <Field label="Target keywords (comma-separated)" value={draft.target_keywords} onChange={(v) => set('target_keywords', v)} placeholder="breastfeeding support, donor milk, NICU mom" />
            <Field label="Default hashtags (space-separated)" value={draft.target_hashtags} onChange={(v) => set('target_hashtags', v)} placeholder="#breastfeeding #latchandlearn #nicumom" />
          </Section>

          <Section label="Visual identity">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ColorField label="Primary" value={draft.primary_color} onChange={(v) => set('primary_color', v)} />
              <ColorField label="Secondary" value={draft.secondary_color} onChange={(v) => set('secondary_color', v)} />
              <ColorField label="Accent" value={draft.accent_color} onChange={(v) => set('accent_color', v)} />
            </div>
            <Field label="Logo URL" value={draft.logo_url} onChange={(v) => set('logo_url', v)} placeholder="https://..." />
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">{label}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-zinc-900">
            {o || '— none —'}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-lg bg-black/30 border border-white/10 px-2 py-1.5">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none font-mono"
        />
      </div>
    </label>
  );
}
