const BASE_URL = '/api/social';
// Re-exported for hooks that build their own URLs (e.g. EventSource for
// the SSE run-events stream — react-query can't drive EventSource for us).
export const API_BASE = BASE_URL;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Only set Content-Type: application/json when there's actually a body.
  // Fastify rejects bodyless requests that declare a JSON content-type
  // (FST_ERR_CTP_EMPTY_JSON_BODY → 400) — that hits POST/PUT/PATCH/DELETE
  // alike when the dashboard sends header + no body.
  const hasBody = options?.body !== undefined && options?.body !== null;
  const headers: Record<string, string> = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(options?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  // 204 No Content has empty body — guard against res.json() throwing.
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Runs
export interface RunFilters {
  status?: string;
  platform?: string;
  campaign?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function fetchRuns(filters?: RunFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.platform) params.set('platform', filters.platform);
  if (filters?.campaign) params.set('campaign', filters.campaign);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return request<any>(`/runs${qs ? `?${qs}` : ''}`);
}

export function fetchRun(id: string) {
  return request<any>(`/runs/${id}`);
}

export function createRun(data: any) {
  return request<any>('/runs', { method: 'POST', body: JSON.stringify(data) });
}

/**
 * Fire-and-forget run starter for the Composer's AI Generate flow. Hits
 * `/runs/start`, which kicks off the full pipeline async on the engine
 * and returns 202 immediately. The new run appears on the Runs page
 * within a couple seconds via the polling already in place.
 */
export function startRun(data: { topic: string; platform: string; format?: string | null }) {
  return request<{ ok: boolean; runId: string; message: string }>('/runs/start', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Smart scheduler — same shape as startRun but persists `scheduled_at`
 * on the new run so the worker picks it up at the chosen time.
 */
export function scheduleRun(data: {
  topic: string;
  platform: string;
  format?: string | null;
  scheduled_at: string; // ISO timestamp
}) {
  return request<{ ok: boolean; runId: string; scheduled_at: string }>('/runs/schedule', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function retryStage(runId: string, stage: string) {
  return request<any>(`/runs/${runId}/retry`, {
    method: 'POST',
    body: JSON.stringify({ stage }),
  });
}

export function cancelRun(id: string) {
  return request<any>(`/runs/${id}/cancel`, { method: 'POST' });
}

// Approvals
export function approveRun(id: string, data: { notes?: string; reviewer?: string }) {
  // Engine requires `reviewer`; default to 'dashboard' so the operator
  // never has to type one. Override per-call when we add named operators.
  return request<any>(`/runs/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reviewer: data.reviewer ?? 'dashboard', notes: data.notes }),
  });
}

export function rejectRun(id: string, data: { notes: string; reviewer?: string }) {
  // Engine field is `notes` (not `reason`); operator must supply at least
  // a short rejection note so the rule-extractor / brand-voice learner can
  // turn it into a binding rule for future runs.
  return request<any>(`/runs/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reviewer: data.reviewer ?? 'dashboard', notes: data.notes }),
  });
}

export function requestRevision(id: string, data: { notes: string }) {
  return request<any>(`/runs/${id}/revision`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Draft & Media selection
export function regenerateDraft(runId: string) {
  return request<any>(`/runs/${runId}/regenerate-draft`, { method: 'POST' });
}

export function regenerateMedia(runId: string, prompt?: string) {
  return request<any>(`/runs/${runId}/regenerate-media`, {
    method: 'POST',
    body: prompt ? JSON.stringify({ prompt }) : undefined,
  });
}

export function selectDraft(runId: string, draftId: string) {
  return request<any>(`/runs/${runId}/select-draft`, {
    method: 'POST',
    body: JSON.stringify({ draftId }),
  });
}

export function selectMedia(runId: string, assetId: string) {
  return request<any>(`/runs/${runId}/select-media`, {
    method: 'POST',
    body: JSON.stringify({ assetId }),
  });
}

// Readability
export function improveReadability(
  runId: string,
  opts?: { content?: string; mode?: 'standard' | 'aggressive' },
) {
  return request<{ ok: boolean; original: string; improved: string; changes: string[] }>(
    `/runs/${runId}/improve-readability`,
    {
      method: 'POST',
      body:
        opts && (opts.content || opts.mode)
          ? JSON.stringify({ content: opts.content, mode: opts.mode })
          : undefined,
    },
  );
}

// Edit-and-learn
export function editDraft(runId: string, content: string, notes?: string) {
  return request<{
    ok: boolean;
    draft_id: string;
    learning_ids: string[];
    rules_extracted: Array<{ category: string; content: string; tags?: string[] }>;
    message: string;
  }>(`/runs/${runId}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content, notes }),
  });
}

export function rerunRun(runId: string) {
  return request<{
    ok: boolean;
    message: string;
    applicable_learnings: number;
  }>(`/runs/${runId}/rerun`, { method: 'POST' });
}

export function deleteRun(runId: string) {
  return request<{ ok: boolean; deleted: string }>(`/runs/${runId}`, {
    method: 'DELETE',
  });
}

export function cleanupCancelledRuns() {
  return request<{ ok: boolean; trashed: number }>(
    `/runs/cleanup-cancelled`,
    { method: 'POST' },
  );
}

// Trash
export interface TrashedRun {
  id: string;
  status: string;
  platform: string;
  campaign: string;
  createdAt: string;
  deletedAt: string;
}

export function fetchTrash() {
  return request<{ runs: TrashedRun[]; total: number }>(`/trash`);
}

export function restoreRun(runId: string) {
  return request<{ ok: boolean; restored: string }>(
    `/runs/${runId}/restore`,
    { method: 'POST' },
  );
}

export function purgeTrashedRun(runId: string) {
  return request<{ ok: boolean; purged: string }>(`/trash/${runId}`, {
    method: 'DELETE',
  });
}

export function emptyTrash() {
  return request<{ ok: boolean; purged: number }>(`/trash/empty`, {
    method: 'POST',
  });
}

// Brand voice profile
export interface BrandProfile {
  id: string;
  campaign_id: string | null;
  name: string;
  description: string;
  audience: string;
  tone: string;
  voice: string;
  writing_guidelines: string;
  banned_words: string[];
  required_phrases: string[];
  signature_phrases: string[];
  target_keywords: string[];
  target_hashtags: string[];
  audience_pain_points: string[];
  audience_aspirations: string[];
  archetype: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string;
  mission: string;
}

export function fetchBrandProfile(campaignId?: string) {
  const path = campaignId ? `/brand-profile/${campaignId}` : `/brand-profile`;
  return request<{ profile: BrandProfile | null }>(path);
}

export function saveBrandProfile(
  body: Partial<BrandProfile>,
  campaignId?: string,
) {
  const path = campaignId ? `/brand-profile/${campaignId}` : `/brand-profile`;
  return request<{ ok: boolean; profile: BrandProfile }>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// Codex OAuth (Sign in with ChatGPT)
export interface CodexAuthStatus {
  authenticated: boolean;
  authPath: string;
  expiresAt: string | null;
  expired: boolean;
}

export function fetchCodexAuthStatus() {
  return request<CodexAuthStatus>(`/auth/codex/status`);
}

export function startCodexLoginFlow() {
  return request<{ flowId: string; url: string }>(`/auth/codex/login`, {
    method: 'POST',
  });
}

export function pollCodexLoginFlow(flowId: string) {
  return request<{
    status: 'pending' | 'completed' | 'failed' | 'not_found';
    url: string | null;
    error: string | null;
  }>(`/auth/codex/flow/${flowId}`);
}

export function logoutCodex() {
  return request<{ ok: boolean }>(`/auth/codex/logout`, { method: 'POST' });
}

export interface EnvVarInfo {
  name: string;
  set: boolean;
  value: string | null;
  length: number;
}

export interface EnvStatusResponse {
  llm: EnvVarInfo[];
  media: EnvVarInfo[];
  postiz: EnvVarInfo[];
  telegram: EnvVarInfo[];
  api: EnvVarInfo[];
}

export function fetchEnvStatus() {
  return request<EnvStatusResponse>(`/auth/env-status`);
}

// Postiz
export function fetchPostizStatus() {
  return request<any>('/postiz/auth-status');
}

export function fetchIntegrations() {
  return request<any>('/postiz/integrations');
}

export function fetchCampaigns() {
  return request<any>('/campaigns');
}

export function createCampaign(data: any) {
  return request<any>('/campaigns', { method: 'POST', body: JSON.stringify(data) });
}

export function fetchCampaign(id: string) {
  return request<any>(`/campaigns/${id}`);
}

export function uploadToPostiz(runId: string) {
  return request<any>(`/runs/${runId}/postiz/upload`, { method: 'POST' });
}

export function createPostizPost(runId: string, data: any) {
  return request<any>(`/runs/${runId}/postiz/post`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function schedulePostizPost(runId: string, data: any) {
  return request<any>(`/runs/${runId}/postiz/schedule`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchPostAnalytics(runId: string) {
  return request<any>(`/runs/${runId}/analytics`);
}

// Config
export function fetchConfig() {
  return request<any>('/config');
}

export function updateConfig(data: any) {
  return request<any>('/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// Schedule / Reschedule
export function rescheduleRun(runId: string, scheduledAt: string) {
  return request<any>(`/runs/${runId}/reschedule`, {
    method: 'PATCH',
    body: JSON.stringify({ scheduledAt }),
  });
}

// Inbox (Postiz notifications)
export function fetchInboxStatus() {
  return request<any>('/inbox/status');
}

export function fetchInboxNotifications(page?: number) {
  return request<any>(`/inbox?page=${page ?? 1}`);
}

export function replyToPost(postId: string, content: string, commentId?: string) {
  return request<any>(`/inbox/post/${postId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ content, commentId }),
  });
}

export function reactToPost(postId: string, reaction?: string) {
  return request<any>(`/inbox/post/${postId}/react`, {
    method: 'POST',
    body: JSON.stringify({ reaction: reaction ?? 'like' }),
  });
}

// Research Library
export function fetchResearch(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return request<any>(`/research${qs}`);
}

export function fetchResearchItem(id: string) {
  return request<any>(`/research/${id}`);
}

export function updateResearchStatus(id: string, status: string) {
  return request<any>(`/research/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function promoteResearch(id: string, platform?: string) {
  return request<any>(`/research/${id}/promote`, {
    method: 'POST',
    body: JSON.stringify({ platform }),
  });
}

// Learnings
export function fetchLearnings(category?: string) {
  const qs = category ? `?category=${category}` : '';
  return request<any>(`/learnings${qs}`);
}

export function addLearningRule(data: { category: string; content: string; platform?: string; tags?: string[] }) {
  return request<any>('/learnings/rule', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deactivateLearning(id: string) {
  return request<any>(`/learnings/${id}`, { method: 'DELETE' });
}

// Summary
export function fetchSummary() {
  return request<any>('/summary');
}

// ── Import (Settings → Import Historical Content) ───────────────────────────

export interface ImportBatch {
  id: string;
  platform: string;
  filename: string;
  file_size: number;
  total_posts: number;
  notes: string;
  created_at: string;
}

export async function importPlatformFile(
  platform: string,
  file: File,
): Promise<{ ok: boolean; batchId: string; platform: string; filename: string; totalPosts: number }> {
  // Multipart upload — DO NOT route through the JSON `request()` helper
  // (which would set Content-Type: application/json and break the boundary).
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/social/import/${platform}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Import failed (${res.status}): ${text}`);
  }
  return res.json();
}

export function fetchImportHistory() {
  return request<{ batches: ImportBatch[] }>('/import/history');
}

export function deleteImportBatch(batchId: string) {
  return request<{ ok: boolean; deleted: string }>(`/import/${batchId}`, {
    method: 'DELETE',
  });
}

export function emptyImports() {
  return request<{ ok: boolean }>('/import/empty', { method: 'POST' });
}
