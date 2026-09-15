import { type DbtChartsStatus, DbtChartsStatusSchema } from '@nao/shared/dbt-charts';

import { env } from '../env';

const STATUS_CACHE_TTL_MS = 60_000;
let statusCache: { status: DbtChartsStatus; fetchedAt: number } | null = null;
let statusRefresh: Promise<DbtChartsStatus> | null = null;

export async function getDbtChartsStatus(): Promise<DbtChartsStatus> {
	if (statusCache && Date.now() - statusCache.fetchedAt < STATUS_CACHE_TTL_MS) {
		return statusCache.status;
	}
	statusRefresh ??= fetchDbtChartsStatus().finally(() => {
		statusRefresh = null;
	});
	return statusRefresh;
}

/** Synchronous view used while assembling agent tools and prompts; refreshes in the background when stale. */
export function isDbtChartsAvailable(): boolean {
	if (!statusCache || Date.now() - statusCache.fetchedAt >= STATUS_CACHE_TTL_MS) {
		void getDbtChartsStatus().catch(() => undefined);
	}
	return statusCache?.status.available ?? false;
}

export function fastapiUrl(path: string): string {
	return `http://localhost:${env.FASTAPI_PORT}${path}`;
}

export function internalHeaders(): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
	};
}

export async function readJsonOrThrow(response: Response): Promise<unknown> {
	if (response.ok) {
		return response.json();
	}
	const body = (await response.json().catch(() => ({ detail: response.statusText }))) as { detail?: unknown };
	const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? response.statusText);
	throw new Error(detail);
}

async function fetchDbtChartsStatus(): Promise<DbtChartsStatus> {
	try {
		const response = await fetch(fastapiUrl('/dbt_charts/status'), { headers: internalHeaders() });
		const status = DbtChartsStatusSchema.parse(await readJsonOrThrow(response));
		statusCache = { status, fetchedAt: Date.now() };
		return status;
	} catch (error) {
		const status: DbtChartsStatus = {
			available: false,
			version: null,
			install_hint: error instanceof Error ? error.message : 'dbt Charts status unavailable',
		};
		statusCache = { status, fetchedAt: Date.now() };
		return status;
	}
}
