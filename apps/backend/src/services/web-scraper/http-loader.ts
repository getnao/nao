import type { WebRobotRecipe, WebRobotSource } from '@nao/shared/web-robot';

import { delay, headersForOrigin, readResponseWithLimit, resolveHeaders } from './request';
import type { TemplateScope } from './template';
import { renderTemplate } from './template';
import type { WebRobotLoadedSource } from './types';
import { assertPublicHttpUrl, canonicalHttpUrl, WebRobotUrlError } from './url-policy';

type HttpLikeSource = Extract<WebRobotSource, { type: 'http' | 'api' }>;

class RetryableHttpError extends Error {}

export type HttpLoaderOptions = {
	recipe: WebRobotRecipe;
	scope: TemplateScope;
	env: Record<string, string>;
	signal?: AbortSignal;
};

export const loadHttpSource = async (
	source: HttpLikeSource,
	options: HttpLoaderOptions,
): Promise<WebRobotLoadedSource> => {
	const rendered = renderTemplate(source, options.scope);
	const initialUrl = buildRequestUrl(rendered);
	const headers = resolveHeaders(rendered.headers, options.env);
	const body = requestBody(rendered);
	if (isJsonBody(rendered.body) && !hasHeader(headers, 'content-type')) {
		headers['content-type'] = 'application/json';
	}
	const request = {
		method: rendered.method,
		headers: {
			...(options.recipe.request.userAgent ? { 'user-agent': options.recipe.request.userAgent } : {}),
			...headers,
		},
		body,
	};

	return fetchWithPolicy(initialUrl, request, options);
};

const fetchWithPolicy = async (
	initialUrl: URL,
	request: { method: string; headers: Record<string, string>; body?: BodyInit },
	options: HttpLoaderOptions,
): Promise<WebRobotLoadedSource> => {
	const url = initialUrl;
	let requestCount = 0;
	let lastError: unknown;

	for (let attempt = 0; attempt <= options.recipe.request.retries; attempt += 1) {
		try {
			const result = await fetchFollowingRedirects(url, request, options, () => {
				requestCount += 1;
			});
			return { ...result, requests: requestCount };
		} catch (error) {
			lastError = error;
			if (!isRetryable(error) || attempt === options.recipe.request.retries) {
				break;
			}
			await delay(Math.min(2_000, 250 * 2 ** attempt), options.signal);
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const fetchFollowingRedirects = async (
	initialUrl: URL,
	request: { method: string; headers: Record<string, string>; body?: BodyInit },
	options: HttpLoaderOptions,
	onRequest: () => void,
): Promise<WebRobotLoadedSource> => {
	let url = initialUrl;
	let method = request.method;
	let body = request.body;

	const initialOrigin = initialUrl.origin;
	for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
		await assertPublicHttpUrl(url.toString(), options.recipe.allowedHosts);
		onRequest();

		const response = await fetch(url, {
			method,
			headers: headersForOrigin(request.headers, url.origin, initialOrigin),
			body,
			redirect: 'manual',
			signal: requestSignal(options),
		});

		if (!isRedirect(response.status)) {
			if (response.status === 429 || response.status >= 500) {
				throw new RetryableHttpError(`HTTP ${response.status} while fetching ${url.toString()}`);
			}
			return toLoadedSource(response, url, options.recipe.limits.maxResponseBytes);
		}

		const location = response.headers.get('location');
		if (!location) {
			return toLoadedSource(response, url, options.recipe.limits.maxResponseBytes);
		}

		url = await assertPublicHttpUrl(location, options.recipe.allowedHosts, { baseUrl: url.toString() });
		if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
			method = 'GET';
			body = undefined;
		}
	}

	throw new Error(`Too many redirects while fetching ${initialUrl.toString()}`);
};

const buildRequestUrl = (source: HttpLikeSource): URL => {
	const url = new URL(canonicalHttpUrl(source.url));
	if (source.type !== 'api') {
		return url;
	}

	for (const [key, value] of Object.entries(source.query)) {
		if (value === undefined || value === null) {
			continue;
		}
		if (Array.isArray(value)) {
			for (const entry of value) {
				url.searchParams.append(key, String(entry));
			}
			continue;
		}
		url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
	}

	return url;
};

const isJsonBody = (body: unknown): boolean => {
	return (
		body !== undefined &&
		body !== null &&
		typeof body === 'object' &&
		!(body instanceof FormData) &&
		!(body instanceof URLSearchParams)
	);
};

const hasHeader = (headers: Record<string, string>, name: string): boolean => {
	return Object.keys(headers).some((header) => header.toLowerCase() === name);
};

const requestBody = (source: HttpLikeSource): BodyInit | undefined => {
	if (source.body === undefined || source.body === null || source.method === 'GET') {
		return undefined;
	}
	return typeof source.body === 'string' || source.body instanceof FormData || source.body instanceof URLSearchParams
		? source.body
		: JSON.stringify(source.body);
};

const toLoadedSource = async (
	response: Response,
	url: URL,
	maxResponseBytes: number,
): Promise<WebRobotLoadedSource> => {
	const bodyText = await readResponseWithLimit(response, maxResponseBytes);
	const contentType = response.headers.get('content-type') ?? undefined;
	const bodyJson = parseJsonBody(bodyText, contentType);

	return {
		url: url.toString(),
		finalUrl: response.url || url.toString(),
		status: response.status,
		contentType,
		bodyText,
		bodyJson,
		captures: [],
		requests: 0,
	};
};

const parseJsonBody = (bodyText: string, contentType?: string): unknown => {
	if (!contentType?.includes('json') && !looksLikeJson(bodyText)) {
		return undefined;
	}
	try {
		return JSON.parse(bodyText);
	} catch {
		return undefined;
	}
};

const looksLikeJson = (body: string): boolean => {
	const trimmed = body.trim();
	return trimmed.startsWith('{') || trimmed.startsWith('[');
};

const requestSignal = (options: HttpLoaderOptions): AbortSignal => {
	const timeout = AbortSignal.timeout(options.recipe.request.timeoutMs);
	return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
};

const isRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

const isRetryable = (error: unknown): boolean => {
	if (error instanceof RetryableHttpError) {
		return true;
	}
	if (error instanceof WebRobotUrlError) {
		return false;
	}
	return !(error instanceof Error) || (error.name !== 'AbortError' && error.name !== 'TimeoutError');
};
