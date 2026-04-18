import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Check } from 'lucide-react';
import { fetchConfig, updateConfig } from '@/lib/api';
import { cn } from '@/lib/utils';

const PLATFORMS = [
  'linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'youtube',
  'threads', 'bluesky', 'pinterest', 'reddit', 'vk',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-zinc-200 mb-4 uppercase tracking-wider">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-zinc-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-10 h-5 rounded-full transition-colors',
          value ? 'bg-indigo-600' : 'bg-zinc-700'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            value && 'translate-x-5'
          )}
        />
      </button>
    </label>
  );
}

function NumberInput({ label, value, onChange, min = 1, max = 10 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-300">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
      />
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-zinc-300">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
      />
    </div>
  );
}

function MultiSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-zinc-300">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() =>
              onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
            }
            className={cn(
              'px-3 py-1 rounded-full text-xs transition-colors',
              value.includes(opt)
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
  });

  const [form, setForm] = useState<any>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const g = form.general || {};
  const h = form.humanizer || {};
  const mp = form.marketing_psychology || {};
  const m = form.media || {};
  const pz = form.postiz || {};
  const pl = form.pipeline || {};

  const update = (section: string, key: string, value: any) => {
    setForm((prev: any) => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [key]: value },
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
          <p className="text-zinc-400 mt-1">Configure the social content pipeline</p>
        </div>
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            saved
              ? 'bg-emerald-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          )}
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saved ? 'Saved' : 'Save Settings'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Section title="General">
          <MultiSelect
            label="Default Platforms"
            options={PLATFORMS}
            value={g.default_platforms || []}
            onChange={(v) => update('general', 'default_platforms', v)}
          />
          <NumberInput
            label="Max Variants Per Run"
            value={g.max_variants || 3}
            onChange={(v) => update('general', 'max_variants', v)}
          />
          <Toggle
            label="Require Approval Before Schedule"
            value={g.approval_required_before_schedule ?? true}
            onChange={(v) => update('general', 'approval_required_before_schedule', v)}
          />
          <Toggle
            label="Require Approval Before Publish"
            value={g.approval_required_before_publish ?? true}
            onChange={(v) => update('general', 'approval_required_before_publish', v)}
          />
        </Section>

        <Section title="Humanizer">
          <Toggle
            label="Enabled"
            value={h.enabled ?? true}
            onChange={(v) => update('humanizer', 'enabled', v)}
          />
          <NumberInput
            label="Aggressiveness (1-10)"
            value={h.aggressiveness || 5}
            onChange={(v) => update('humanizer', 'aggressiveness', v)}
          />
        </Section>

        <Section title="Marketing Psychology">
          <Toggle
            label="Enabled"
            value={mp.enabled ?? true}
            onChange={(v) => update('marketing_psychology', 'enabled', v)}
          />
          <NumberInput
            label="Default Intensity (1-10)"
            value={mp.default_intensity || 5}
            onChange={(v) => update('marketing_psychology', 'default_intensity', v)}
          />
        </Section>

        <Section title="Media Generation">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-300">Default Mode</span>
            <select
              value={m.default_mode || 'image'}
              onChange={(e) => update('media', 'default_mode', e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="both">Both</option>
              <option value="none">None</option>
            </select>
          </div>
          <TextInput
            label="Image Provider"
            value={m.provider || ''}
            onChange={(v) => update('media', 'provider', v)}
            placeholder="e.g. fal-ai, dall-e"
          />
          <TextInput
            label="Image Model"
            value={m.model || ''}
            onChange={(v) => update('media', 'model', v)}
            placeholder="e.g. nano-banana-2"
          />
        </Section>

        <Section title="Postiz Integration">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-300">Adapter Mode</span>
            <select
              value={pz.use_cli_or_api || 'api'}
              onChange={(e) => update('postiz', 'use_cli_or_api', e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="api">API</option>
              <option value="cli">CLI</option>
            </select>
          </div>
          <TextInput
            label="API Base URL"
            value={pz.api_base_url || ''}
            onChange={(v) => update('postiz', 'api_base_url', v)}
            placeholder="https://app.postiz.com/api"
          />
          <TextInput
            label="Analytics Sync Frequency"
            value={pz.analytics_sync_frequency || '6h'}
            onChange={(v) => update('postiz', 'analytics_sync_frequency', v)}
            placeholder="e.g. 1h, 6h, 24h"
          />
        </Section>

        <Section title="Pipeline">
          <NumberInput
            label="Stage Retry Limit"
            value={pl.stage_retry_limits || 3}
            onChange={(v) => update('pipeline', 'stage_retry_limits', v)}
            max={10}
          />
          <Toggle
            label="Auto Analytics Sync"
            value={pl.auto_analytics_sync ?? true}
            onChange={(v) => update('pipeline', 'auto_analytics_sync', v)}
          />
          <Toggle
            label="Nightly Summary Job"
            value={pl.nightly_summary_job ?? false}
            onChange={(v) => update('pipeline', 'nightly_summary_job', v)}
          />
        </Section>
      </div>
    </div>
  );
}
