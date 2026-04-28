import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
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
  const t = useT();
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
      setToast({ kind: 'success', message: t('brand.saved') });
    },
    onError: (err) => {
      setToast({ kind: 'error', message: t('brand.save_failed', { message: (err as Error).message }) });
    },
  });

  const set = <K extends keyof DraftProfile>(key: K, value: DraftProfile[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primaryText flex items-center gap-2">
            <Sparkles className="h-6 w-6" /> {t('brand.title')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('brand.subtitle')}</p>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || isLoading}
          className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? t('brand.saving') : t('brand.save_profile')}
        </button>
      </div>

      {toast && (
        <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-surface-soft animate-skeleton-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <Section label={t('brand.section.identity')}>
            <Field label={t('brand.field.name')} value={draft.name} onChange={(v) => set('name', v)} placeholder={t('brand.field.name_ph')} />
            <Field label={t('brand.field.description')} value={draft.description} onChange={(v) => set('description', v)} placeholder={t('brand.field.description_ph')} />
            <Textarea label={t('brand.field.mission')} value={draft.mission} onChange={(v) => set('mission', v)} placeholder={t('brand.field.mission_ph')} rows={3} />
            <Select
              label={t('brand.field.archetype')}
              value={draft.archetype}
              onChange={(v) => set('archetype', v)}
              options={ARCHETYPES}
              noneLabel={t('brand.field.archetype_none')}
            />
          </Section>

          <Section label={t('brand.section.audience')}>
            <Textarea label={t('brand.field.audience')} value={draft.audience} onChange={(v) => set('audience', v)} placeholder={t('brand.field.audience_ph')} rows={2} />
            <Field
              label={t('brand.field.pain_points')}
              value={draft.audience_pain_points}
              onChange={(v) => set('audience_pain_points', v)}
              placeholder={t('brand.field.pain_points_ph')}
            />
            <Field
              label={t('brand.field.aspirations')}
              value={draft.audience_aspirations}
              onChange={(v) => set('audience_aspirations', v)}
              placeholder={t('brand.field.aspirations_ph')}
            />
          </Section>

          <Section label={t('brand.section.voice_tone')}>
            <Textarea label={t('brand.field.tone')} value={draft.tone} onChange={(v) => set('tone', v)} placeholder={t('brand.field.tone_ph')} rows={2} />
            <Textarea label={t('brand.field.voice')} value={draft.voice} onChange={(v) => set('voice', v)} placeholder={t('brand.field.voice_ph')} rows={2} />
            <Textarea label={t('brand.field.writing_guidelines')} value={draft.writing_guidelines} onChange={(v) => set('writing_guidelines', v)} placeholder={t('brand.field.writing_guidelines_ph')} rows={4} />
          </Section>

          <Section label={t('brand.section.vocabulary')}>
            <Field label={t('brand.field.banned')} value={draft.banned_words} onChange={(v) => set('banned_words', v)} placeholder={t('brand.field.banned_ph')} />
            <Field label={t('brand.field.required')} value={draft.required_phrases} onChange={(v) => set('required_phrases', v)} placeholder={t('brand.field.required_ph')} />
            <Field label={t('brand.field.signature')} value={draft.signature_phrases} onChange={(v) => set('signature_phrases', v)} placeholder={t('brand.field.signature_ph')} />
          </Section>

          <Section label={t('brand.section.seo_geo')}>
            <Field label={t('brand.field.keywords')} value={draft.target_keywords} onChange={(v) => set('target_keywords', v)} placeholder={t('brand.field.keywords_ph')} />
            <Field label={t('brand.field.hashtags')} value={draft.target_hashtags} onChange={(v) => set('target_hashtags', v)} placeholder={t('brand.field.hashtags_ph')} />
          </Section>

          <Section label={t('brand.section.visual')}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ColorField label={t('brand.field.primary')} value={draft.primary_color} onChange={(v) => set('primary_color', v)} />
              <ColorField label={t('brand.field.secondary')} value={draft.secondary_color} onChange={(v) => set('secondary_color', v)} />
              <ColorField label={t('brand.field.accent')} value={draft.accent_color} onChange={(v) => set('accent_color', v)} />
            </div>
            <Field label={t('brand.field.logo')} value={draft.logo_url} onChange={(v) => set('logo_url', v)} placeholder="https://..." />
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-strong bg-surface-faint p-5 space-y-3">
      <h3 className="text-sm font-semibold text-secondaryText uppercase tracking-wider">{label}</h3>
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
      <span className="text-xs text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg bg-black/30 border border-border-strong px-3 py-2 text-sm text-primaryText placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
      <span className="text-xs text-muted">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg bg-black/30 border border-border-strong px-3 py-2 text-sm text-primaryText placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  noneLabel = '— none —',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  noneLabel?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-black/30 border border-border-strong px-3 py-2 text-sm text-primaryText focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-zinc-900">
            {o || noneLabel}
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
      <span className="text-xs text-muted">{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-lg bg-black/30 border border-border-strong px-2 py-1.5">
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
          className="flex-1 bg-transparent text-sm text-primaryText placeholder:text-faint focus:outline-none font-mono"
        />
      </div>
    </label>
  );
}
