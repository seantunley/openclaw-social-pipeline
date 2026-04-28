import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  KeyRound,
  Sliders,
  Plug,
  Cpu,
  Info,
  Upload,
  Trash2,
  FileJson,
  AlertTriangle,
  Hash,
  Layers,
  Image as ImageIcon,
  Film,
  Link2,
  ShieldCheck,
  MessageCircle,
} from 'lucide-react';
import {
  fetchConfig,
  updateConfig,
  fetchEnvStatus,
  fetchImportHistory,
  importPlatformFile,
  deleteImportBatch,
  emptyImports,
} from '@/lib/api';
import type { EnvVarInfo, ImportBatch } from '@/lib/api';
import { cn } from '@/lib/utils';
import CodexAuthCard from '@/components/CodexAuthCard';
import Toast, { type ToastKind } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useT } from '@/lib/i18n';
import { PLATFORMS_ORDERED, getPlatformSpec, type PlatformId, type PlatformSpec } from '@/lib/platforms';

const PLATFORMS = [
  'linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'youtube',
  'threads', 'bluesky', 'pinterest', 'reddit', 'vk',
];

type TabKey = 'auth' | 'pipeline' | 'integrations' | 'platforms' | 'import' | 'system';

const TABS: Array<{ key: TabKey; labelKey: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'auth', labelKey: 'settings.tabs.auth', icon: KeyRound },
  { key: 'pipeline', labelKey: 'settings.tabs.pipeline', icon: Sliders },
  { key: 'integrations', labelKey: 'settings.tabs.integrations', icon: Plug },
  { key: 'platforms', labelKey: 'settings.tabs.platforms', icon: Layers },
  { key: 'import', labelKey: 'settings.tabs.import', icon: Upload },
  { key: 'system', labelKey: 'settings.tabs.system', icon: Cpu },
];

export default function Settings() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('auth');
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primaryText">{t('settings.title')}</h1>
        <p className="text-muted mt-1 text-sm">{t('settings.subtitle')}</p>
      </div>

      {toast && (
        <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
      )}

      <div className="flex flex-wrap gap-1 border-b border-border-strong">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active ? 'text-primaryText' : 'text-muted hover:text-secondaryText',
              )}
            >
              <Icon className="h-4 w-4" />
              {t(tab.labelKey)}
              {active && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-indigo-500" />
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'auth' && <AuthTab />}
      {activeTab === 'pipeline' && <PipelineTab onToast={setToast} />}
      {activeTab === 'integrations' && <IntegrationsTab onToast={setToast} />}
      {activeTab === 'platforms' && <PlatformsTab />}
      {activeTab === 'import' && <ImportTab onToast={setToast} />}
      {activeTab === 'system' && <SystemTab />}
    </div>
  );
}

// ─── Authentication tab ─────────────────────────────────────────────────────

function AuthTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['env-status'],
    queryFn: fetchEnvStatus,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <Card title="Sign in with ChatGPT" subtitle="Wired ✓ — fully functional">
        <CodexAuthCard />
      </Card>

      <Card
        title="Environment variables"
        subtitle="The bot reads secrets from engine/.env at runtime. Update the file and restart the API to change them — these can't be edited from the dashboard."
      >
        {isLoading ? (
          <Skeleton lines={6} />
        ) : (
          <div className="space-y-4">
            <EnvGroup label="LLM" vars={data?.llm ?? []} />
            <EnvGroup label="Media" vars={data?.media ?? []} />
            <EnvGroup label="Postiz" vars={data?.postiz ?? []} />
            <EnvGroup label="Telegram bot" vars={data?.telegram ?? []} />
            <EnvGroup label="API" vars={data?.api ?? []} />
          </div>
        )}
      </Card>
    </div>
  );
}

function EnvGroup({ label, vars }: { label: string; vars: EnvVarInfo[] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-muted mb-2">{label}</p>
      <div className="space-y-1.5">
        {vars.map((v) => (
          <div
            key={v.name}
            className="flex items-center justify-between rounded-md bg-surface-faint border border-border-strong px-3 py-2"
          >
            <code className="text-xs text-secondaryText">{v.name}</code>
            <div className="flex items-center gap-2 text-xs">
              {v.set ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-300">
                    {v.value ? <code className="text-secondaryText">{v.value}</code> : `set (${v.length} chars)`}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5 text-faint" />
                  <span className="text-muted">not set</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pipeline tab ───────────────────────────────────────────────────────────

function PipelineTab({ onToast }: { onToast: (t: { kind: ToastKind; message: string }) => void }) {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({ queryKey: ['config'], queryFn: fetchConfig });
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      onToast({ kind: 'success', message: 'Settings saved.' });
    },
    onError: (err) => {
      onToast({ kind: 'error', message: `Save failed: ${(err as Error).message}` });
    },
  });

  const update = (section: string, key: string, value: any) => {
    setForm((prev: any) => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [key]: value },
    }));
  };

  if (isLoading) return <Skeleton lines={10} />;

  const g = form.general || {};
  const h = form.humanizer || {};
  const mp = form.marketing_psychology || {};
  const m = form.media || {};
  const pl = form.pipeline || {};

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex justify-end">
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>

      <Card title="General" subtitle="Run-level defaults.">
        <Row>
          <MultiSelect
            label="Default platforms"
            options={PLATFORMS}
            value={g.default_platforms || []}
            onChange={(v) => update('general', 'default_platforms', v)}
          />
          <Status state="not-wired" note="Bot uses BOT_DEFAULT_PLATFORM env var instead." />
        </Row>
        <Row>
          <NumberInput
            label="Max variants per run"
            value={g.max_variants || 3}
            onChange={(v) => update('general', 'max_variants', v)}
          />
          <Status state="not-wired" note="Pipeline currently emits one variant; the multi-angle flow will use this." />
        </Row>
        <Row>
          <Toggle
            label="Require approval before publish"
            value={g.approval_required_before_publish ?? true}
            onChange={(v) => update('general', 'approval_required_before_publish', v)}
          />
          <Status state="implicit" note="Approval is always required today — every run ends in pending_approval." />
        </Row>
      </Card>

      <Card title="Humanizer" subtitle="Strips AI writing tells from the draft.">
        <Row>
          <Toggle
            label="Enabled"
            value={h.enabled ?? true}
            onChange={(v) => update('humanizer', 'enabled', v)}
          />
          <Status state="not-wired" note="Pipeline always runs humanize. Wire to skip stage when false." />
        </Row>
        <Row>
          <NumberInput
            label="Aggressiveness (1–10)"
            value={h.aggressiveness || 5}
            onChange={(v) => update('humanizer', 'aggressiveness', v)}
          />
          <Status state="not-wired" />
        </Row>
      </Card>

      <Card title="Marketing psychology">
        <Row>
          <Toggle
            label="Enabled"
            value={mp.enabled ?? true}
            onChange={(v) => update('marketing_psychology', 'enabled', v)}
          />
          <Status state="not-wired" />
        </Row>
        <Row>
          <NumberInput
            label="Default intensity (1–10)"
            value={mp.default_intensity || 5}
            onChange={(v) => update('marketing_psychology', 'default_intensity', v)}
          />
          <Status state="not-wired" />
        </Row>
      </Card>

      <Card title="Media generation">
        <Row>
          <SelectField
            label="Default mode"
            value={m.default_mode || 'image'}
            onChange={(v) => update('media', 'default_mode', v)}
            options={[
              { value: 'image', label: 'Image' },
              { value: 'video', label: 'Video' },
              { value: 'both', label: 'Both' },
              { value: 'none', label: 'None' },
            ]}
          />
          <Status state="not-wired" note="Pipeline always generates one image at 1:1." />
        </Row>
      </Card>

      <Card title="Pipeline">
        <Row>
          <NumberInput
            label="Stage retry limit"
            value={pl.stage_retry_limits || 3}
            onChange={(v) => update('pipeline', 'stage_retry_limits', v)}
            max={10}
          />
          <Status state="not-wired" note="Pipeline doesn't auto-retry stages today." />
        </Row>
        <Row>
          <Toggle
            label="Auto analytics sync"
            value={pl.auto_analytics_sync ?? true}
            onChange={(v) => update('pipeline', 'auto_analytics_sync', v)}
          />
          <Status state="not-wired" />
        </Row>
      </Card>
    </div>
  );
}

// ─── Integrations tab ────────────────────────────────────────────────────────

function IntegrationsTab({ onToast }: { onToast: (t: { kind: ToastKind; message: string }) => void }) {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({ queryKey: ['config'], queryFn: fetchConfig });
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      onToast({ kind: 'success', message: 'Saved (preferences only — env vars take precedence at runtime).' });
    },
  });

  const update = (section: string, key: string, value: any) => {
    setForm((prev: any) => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [key]: value },
    }));
  };

  if (isLoading) return <Skeleton lines={8} />;

  const pz = form.postiz || {};

  return (
    <div className="space-y-6 max-w-3xl">
      <Card
        title="Postiz"
        subtitle="At runtime the engine reads POSTIZ_MODE / POSTIZ_API_URL / POSTIZ_API_KEY from engine/.env. These dashboard fields are stored as preferences for now and don't override the env vars."
      >
        <div className="flex justify-end mb-2">
          <button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save preferences
          </button>
        </div>
        <Row>
          <SelectField
            label="Adapter mode"
            value={pz.use_cli_or_api || 'api'}
            onChange={(v) => update('postiz', 'use_cli_or_api', v)}
            options={[
              { value: 'api', label: 'API' },
              { value: 'cli', label: 'CLI' },
            ]}
          />
          <Status state="not-wired" />
        </Row>
        <Row>
          <TextInput
            label="API base URL"
            value={pz.api_base_url || ''}
            onChange={(v) => update('postiz', 'api_base_url', v)}
            placeholder="http://localhost:5000"
          />
          <Status state="not-wired" />
        </Row>
      </Card>

      <Card
        title="Image generation"
        subtitle="Order of providers tried at runtime: fal.ai → OpenAI gpt-image-1. Configure keys in engine/.env (FAL_API_KEY, OPENAI_API_KEY)."
      >
        <p className="text-xs text-muted">
          No editable fields here yet — provider order is hard-coded with graceful fallback. The
          first working provider wins; if both fail, the pipeline still produces text-only output.
        </p>
      </Card>
    </div>
  );
}

// ─── Platforms tab ──────────────────────────────────────────────────────────

function PlatformsTab() {
  const t = useT();
  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h2 className="text-sm font-semibold text-secondaryText uppercase tracking-wider">
          {t('settings.platforms.title')}
        </h2>
        <p className="mt-1 text-xs text-muted leading-relaxed max-w-2xl">
          {t('settings.platforms.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PLATFORMS_ORDERED.map((spec) => (
          <PlatformSpecCard key={spec.id} spec={spec} />
        ))}
      </div>
    </div>
  );
}

function PlatformSpecCard({ spec }: { spec: PlatformSpec }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border-strong bg-surface-faint overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-border-strong"
        style={{ background: `linear-gradient(90deg, ${spec.color}18, transparent)` }}
      >
        <span style={{ color: spec.color }} className="text-xl leading-none">
          {spec.icon}
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-primaryText">{spec.label}</h3>
          <code className="text-[10px] uppercase tracking-widest text-muted">{spec.id}</code>
        </div>
      </div>

      <div className="p-4 space-y-4 text-xs">
        {/* Content section */}
        <Section title={t('settings.platforms.content_section')}>
          <SpecRow icon={Hash} label={t('settings.platforms.char_limit')}>
            <span className="font-medium text-secondaryText">
              {spec.content.charLimit.toLocaleString()}
            </span>
            {spec.content.premiumLimit && (
              <span className="text-muted">
                {' '}/ {t('settings.platforms.premium_limit')}{' '}
                {spec.content.premiumLimit.toLocaleString()}
              </span>
            )}
          </SpecRow>
          <SpecRow icon={Hash} label={t('settings.platforms.hashtags')}>
            {t('settings.platforms.hashtags_range', {
              min: spec.content.hashtags.min,
              max: spec.content.hashtags.max,
            })}
          </SpecRow>
          <SpecRow icon={Link2} label={t('settings.platforms.links')}>
            {t(`settings.platforms.link.${spec.content.linkBehaviour}`)}
          </SpecRow>
          {spec.content.disclosures.length > 0 && (
            <SpecRow icon={ShieldCheck} label={t('settings.platforms.disclosures')}>
              <div className="flex flex-wrap gap-1">
                {spec.content.disclosures.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center rounded-full border border-border-strong bg-surface-soft px-1.5 py-0.5 text-[10px] text-secondaryText"
                  >
                    {t(`settings.platforms.disclosure.${d}`)}
                  </span>
                ))}
              </div>
            </SpecRow>
          )}
          {spec.content.replyAudience && (
            <SpecRow icon={MessageCircle} label={t('settings.platforms.reply_audience')}>
              {spec.content.replyAudience.length} options
            </SpecRow>
          )}
        </Section>

        {/* Media section */}
        <Section title={t('settings.platforms.media_section')}>
          <SpecRow icon={ImageIcon} label={t('settings.platforms.image_aspect')}>
            <span className="font-medium text-secondaryText">{spec.media.imageAspectRatio}</span>
            <span className="text-muted">
              {' '}· {spec.media.imageDimensions.width}×{spec.media.imageDimensions.height}
            </span>
          </SpecRow>
          {spec.media.altFormats?.length ? (
            <SpecRow icon={Layers} label={t('settings.platforms.alt_formats')}>
              <div className="flex flex-wrap gap-1">
                {spec.media.altFormats.map((f) => (
                  <span
                    key={f.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface-soft px-1.5 py-0.5 text-[10px] text-secondaryText"
                  >
                    {f.label} <code className="text-muted">{f.aspectRatio}</code>
                  </span>
                ))}
              </div>
            </SpecRow>
          ) : null}
          <SpecRow icon={Film} label={t('settings.platforms.video_duration')}>
            {formatDuration(spec.media.videoMaxDurationSec, t)}
          </SpecRow>
          <SpecRow icon={Layers} label={t('settings.platforms.carousel')}>
            <span className={spec.media.supportsCarousel ? 'text-emerald-300' : 'text-muted'}>
              {spec.media.supportsCarousel
                ? t('settings.platforms.yes')
                : t('settings.platforms.no')}
            </span>
          </SpecRow>
        </Section>

        {/* Import section */}
        <Section title={t('settings.platforms.import_section')}>
          <SpecRow icon={FileJson} label={t('settings.platforms.file')}>
            <code className="text-secondaryText">{spec.import.files}</code>
          </SpecRow>
          <SpecRow icon={Info} label={t('settings.platforms.where')}>
            <span className="text-muted">{spec.import.hint}</span>
          </SpecRow>
          <SpecRow icon={Upload} label={t('settings.platforms.accepted')}>
            <code className="text-muted">{spec.import.accept}</code>
          </SpecRow>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function SpecRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
      <Icon className="h-3 w-3 mt-0.5 text-faint shrink-0" />
      <span className="text-muted">{label}</span>
      <div className="text-right text-secondaryText min-w-0">{children}</div>
    </div>
  );
}

function formatDuration(seconds: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (seconds < 60) return t('settings.platforms.video_seconds', { seconds });
  if (seconds < 3600) {
    return t('settings.platforms.video_minutes', { minutes: Math.round(seconds / 60) });
  }
  return t('settings.platforms.video_hours', { hours: Math.round(seconds / 3600) });
}

// ─── Import tab ─────────────────────────────────────────────────────────────

function ImportTab({ onToast }: { onToast: (t: { kind: ToastKind; message: string }) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['import-history'],
    queryFn: fetchImportHistory,
  });

  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>('twitter');
  const [confirm, setConfirm] = useState<
    | { kind: 'one'; batchId: string; platform: string }
    | { kind: 'all' }
    | null
  >(null);

  const importMutation = useMutation({
    mutationFn: ({ platform, file }: { platform: PlatformId; file: File }) =>
      importPlatformFile(platform, file),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['import-history'] });
      onToast({
        kind: 'success',
        message: t('settings.import.success', {
          count: res.totalPosts,
          platform: getPlatformSpec(res.platform).label,
        }),
      });
    },
    onError: (err) => {
      onToast({
        kind: 'error',
        message: t('settings.import.failed', { message: (err as Error).message }),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteImportBatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-history'] }),
  });

  const emptyMutation = useMutation({
    mutationFn: emptyImports,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-history'] }),
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importMutation.mutate({ platform: selectedPlatform, file });
    e.target.value = '';
  };

  const spec = getPlatformSpec(selectedPlatform);
  // Only platforms with a parser registered. Threads/Bluesky/Pinterest/VK use
  // shared or no exports — surface those as a separate, disabled list later
  // if/when needed.
  const supported: PlatformId[] = [
    'twitter',
    'instagram',
    'facebook',
    'linkedin',
    'tiktok',
    'youtube',
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <Card title={t('settings.import.title')} subtitle={t('settings.import.subtitle')}>
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted mb-2">
              {t('settings.import.pick_platform')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {supported.map((id) => {
                const p = getPlatformSpec(id);
                const on = id === selectedPlatform;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedPlatform(id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors',
                      on
                        ? 'border-indigo-400/50 bg-indigo-500/10 text-indigo-200'
                        : 'border-border-strong text-secondaryText hover:bg-surface-soft',
                    )}
                  >
                    <span style={{ color: p.color }} className="text-base">{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border-strong bg-black/20 p-4 space-y-2 text-sm">
            <div className="flex items-start gap-2 text-secondaryText">
              <FileJson className="h-4 w-4 mt-0.5 text-muted shrink-0" />
              <div>
                <p className="text-secondaryText font-medium">{spec.import.files}</p>
                <p className="text-xs text-muted mt-0.5">{spec.import.hint}</p>
              </div>
            </div>
            <div className="text-xs text-muted">
              {t('settings.import.accepted')}: <code className="text-secondaryText">{spec.import.accept}</code>
            </div>
          </div>

          <label
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/15 bg-black/20 px-6 py-8 text-sm text-secondaryText cursor-pointer hover:bg-surface-faint',
              importMutation.isPending && 'opacity-60 cursor-wait',
            )}
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('settings.import.uploading')}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {t('settings.import.upload')}
              </>
            )}
            <input
              type="file"
              accept={spec.import.accept}
              onChange={onFile}
              disabled={importMutation.isPending}
              className="hidden"
            />
          </label>
        </div>
      </Card>

      <Card title={t('settings.import.history')}>
        {isLoading ? (
          <Skeleton lines={3} />
        ) : !data?.batches?.length ? (
          <p className="text-sm text-muted">{t('settings.import.no_history')}</p>
        ) : (
          <div className="space-y-2">
            {data.batches.map((b) => (
              <BatchRow
                key={b.id}
                batch={b}
                onDelete={() => setConfirm({ kind: 'one', batchId: b.id, platform: b.platform })}
              />
            ))}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setConfirm({ kind: 'all' })}
                className="flex items-center gap-2 text-xs text-rose-400 hover:text-rose-300"
              >
                <AlertTriangle className="h-3 w-3" />
                {t('settings.import.delete_all')}
              </button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirm}
        destructive
        title={
          confirm?.kind === 'one'
            ? t('settings.import.delete_one')
            : t('settings.import.delete_all')
        }
        message={
          confirm?.kind === 'one'
            ? t('settings.import.delete_one')
            : t('settings.import.delete_all')
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        busy={deleteMutation.isPending || emptyMutation.isPending}
        onConfirm={async () => {
          if (!confirm) return;
          if (confirm.kind === 'one') await deleteMutation.mutateAsync(confirm.batchId);
          else await emptyMutation.mutateAsync();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function BatchRow({ batch, onDelete }: { batch: ImportBatch; onDelete: () => void }) {
  const spec = getPlatformSpec(batch.platform);
  const date = new Date(batch.created_at).toLocaleString();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-strong bg-surface-faint px-3 py-2">
      <span style={{ color: spec.color }} className="text-base">{spec.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-secondaryText truncate">{batch.filename || spec.label}</p>
        <p className="text-[11px] text-muted">
          {batch.total_posts.toLocaleString()} posts · {(batch.file_size / 1024).toFixed(0)} KB · {date}
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1.5 rounded-md p-1.5 text-muted hover:bg-surface-soft hover:text-rose-400"
        aria-label="Delete batch"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── System tab ─────────────────────────────────────────────────────────────

function SystemTab() {
  return (
    <div className="space-y-6 max-w-3xl">
      <Card title="Pointers">
        <ul className="space-y-2 text-sm text-secondaryText">
          <li className="flex justify-between">
            <span className="text-muted">Engine version</span>
            <code className="text-secondaryText">0.2.0</code>
          </li>
          <li className="flex justify-between">
            <span className="text-muted">Dashboard</span>
            <code className="text-secondaryText">http://localhost:3001</code>
          </li>
          <li className="flex justify-between">
            <span className="text-muted">API</span>
            <code className="text-secondaryText">http://localhost:3000</code>
          </li>
          <li className="flex justify-between">
            <span className="text-muted">DB path</span>
            <code className="text-secondaryText">engine/data/social-pipeline.db</code>
          </li>
          <li className="flex justify-between">
            <span className="text-muted">Codex auth file</span>
            <code className="text-secondaryText">~/.codex/auth.json</code>
          </li>
        </ul>
      </Card>

      <Card title="Notes" subtitle="What honestly works vs. what's still placeholder.">
        <div className="space-y-2 text-sm">
          <p className="flex items-start gap-2 text-emerald-300">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <strong>Wired and active:</strong> Codex OAuth sign-in, brand voice profile, edit
              draft + extract rules, pipeline rule injection, run trash, image fallback, all
              REST endpoints, dashboard polling.
            </span>
          </p>
          <p className="flex items-start gap-2 text-amber-300">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <strong>Stored as preferences but ignored at runtime:</strong> most of the Pipeline
              tab toggles. Saving them updates social_config in the DB, but the bot doesn't read
              the table — it reads engine/.env. Fixing that is a focused follow-up: load config
              once per run and gate stages on it.
            </span>
          </p>
          <p className="flex items-start gap-2 text-muted">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <strong>Not yet built:</strong> multi-angle research (7 topics → operator picks),
              scheduled publishing, analytics sync from Postiz, Telegram bot UI, theme toggle.
            </span>
          </p>
        </div>
      </Card>
    </div>
  );
}

// ─── Shared building blocks ─────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-strong bg-surface-faint p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-secondaryText uppercase tracking-wider">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-muted leading-relaxed">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
      {children}
    </div>
  );
}

function Status({ state, note }: { state: 'wired' | 'implicit' | 'not-wired'; note?: string }) {
  const map = {
    wired: { label: 'Wired', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    implicit: { label: 'Implicit', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
    'not-wired': { label: 'Not wired yet', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  };
  const { label, color } = map[state];
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium', color)}>
        {label}
      </span>
      {note && <span className="text-[11px] text-muted max-w-[24ch] text-right">{note}</span>}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-secondaryText">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-10 h-5 rounded-full transition-colors',
          value ? 'bg-indigo-600' : 'bg-zinc-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            value && 'translate-x-5',
          )}
        />
      </button>
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min = 1,
  max = 10,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-secondaryText">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 bg-zinc-900 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-secondaryText focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

function TextInput({
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
    <div className="space-y-1 flex-1 min-w-0">
      <label className="text-sm text-secondaryText">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-900 border border-border-strong rounded-lg px-3 py-2 text-sm text-secondaryText focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-secondaryText">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-900 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-secondaryText focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-zinc-900">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-secondaryText">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() =>
              onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
            }
            className={cn(
              'px-2.5 py-1 rounded-full text-xs transition-colors',
              value.includes(opt)
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-muted hover:bg-zinc-700',
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function Skeleton({ lines = 5 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-8 rounded bg-surface-soft animate-skeleton-pulse" />
      ))}
    </div>
  );
}
