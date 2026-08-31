import type { CandidateItem, GemOption, RunProgress, StateResponse, UpdateProgress } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const resp = await fetch(url, {
		...init,
		headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
	});
	const text = await resp.text();
	const body = text ? JSON.parse(text) : {};
	if (!resp.ok) throw new Error(body.error ?? `${resp.status} ${resp.statusText}`);
	return body as T;
}

export const api = {
	state: () => request<StateResponse>('/api/state'),
	importProfile: (json: string) =>
		request<{ className: string; spec: string; created: boolean; label: string; kept: { selection: number; bench: number }; dropped: string[] }>(
			'/api/profile',
			{ method: 'POST', body: JSON.stringify({ json }) },
		),
	activateProfile: (id: string) => request<{ ok: boolean }>('/api/profiles/activate', { method: 'POST', body: JSON.stringify({ id }) }),
	renameProfile: (id: string, label: string) =>
		request<{ ok: boolean }>('/api/profiles/rename', { method: 'POST', body: JSON.stringify({ id, label }) }),
	deleteProfile: (id: string) => request<{ ok: boolean }>('/api/profiles/delete', { method: 'POST', body: JSON.stringify({ id }) }),
	catalog: () => request<{ items: CandidateItem[] }>('/api/catalog'),
	saveSelection: (ids: number[]) => request<{ count: number }>('/api/selection', { method: 'POST', body: JSON.stringify({ ids }) }),
	saveBench: (ids: number[]) => request<{ count: number }>('/api/bench', { method: 'POST', body: JSON.stringify({ ids }) }),
	saveConfig: (config: unknown) => request<StateResponse>('/api/config', { method: 'POST', body: JSON.stringify(config) }),
	gems: () => request<{ gems: GemOption[] }>('/api/gems'),
	startRun: () => request<{ ok: boolean }>('/api/run', { method: 'POST', body: '{}' }),
	abortRun: () => request<{ ok: boolean }>('/api/run/abort', { method: 'POST', body: '{}' }),
	progress: () => request<RunProgress>('/api/progress'),
	downloadUpdate: () => request<{ ok: boolean }>('/api/update/download', { method: 'POST', body: '{}' }),
	updateProgress: () => request<UpdateProgress>('/api/update/progress'),
};
