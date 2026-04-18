const BASE_URL = '/api/social';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
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
export function approveRun(id: string, data: { notes?: string }) {
  return request<any>(`/runs/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function rejectRun(id: string, data: { reason: string }) {
  return request<any>(`/runs/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(data),
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

export function regenerateMedia(runId: string) {
  return request<any>(`/runs/${runId}/regenerate-media`, { method: 'POST' });
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

// Summary
export function fetchSummary() {
  return request<any>('/summary');
}
