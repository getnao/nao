import { createHash } from 'node:crypto';

import type { ProviderSettings } from '../types/llm';

/** Databricks issues service principal tokens for an hour; each is renewed this long before it lapses. */
const TOKEN_RENEWAL_MARGIN_MS = 5 * 60_000;
/** The serving endpoint task of chat models; embeddings, completions and custom models answer other tasks. */
const CHAT_TASK = 'llm/v1/chat';
const CONTENT_BLOCKS_PATTERN = /"content"\s*:\s*\[/;

type ServicePrincipal = { clientId: string; clientSecret: string };
type DatabricksCredentials = { token: string } | ServicePrincipal;
type CachedToken = { token: Promise<string>; expiresAt: number };
type ContentBlock = { type: 'text'; text: string } | { type: 'reasoning'; summary: { text: string }[] };
type CompletionMessage = { content?: ContentBlock[] | string | null; reasoning_content?: string };
type Completion = { choices?: { message?: CompletionMessage; delta?: CompletionMessage }[] };

const servicePrincipalTokens = new Map<string, CachedToken>();

/** Settings for the OpenAI-compatible API that every serving endpoint of the workspace answers on. */
export function toDatabricksServingSettings(settings: ProviderSettings): ProviderSettings {
	const workspaceUrl = resolveWorkspaceUrl(settings);
	return {
		apiKey: '',
		baseURL: `${workspaceUrl}/serving-endpoints`,
		fetch: withOpenAIChatFormat(authorizedFetch(workspaceUrl, settings)),
	};
}

/** Names of the workspace serving endpoints that answer chat completions, which nao can use as models. */
export async function listDatabricksChatEndpoints(settings: ProviderSettings): Promise<string[]> {
	const workspaceUrl = resolveWorkspaceUrl(settings);
	const response = await authorizedFetch(workspaceUrl, settings)(`${workspaceUrl}/api/2.0/serving-endpoints`);
	if (!response.ok) {
		throw new Error(`Databricks could not list the serving endpoints: ${await describeFailure(response)}`);
	}
	const { endpoints = [] } = (await response.json()) as { endpoints?: { name: string; task?: string }[] };
	return endpoints
		.filter((endpoint) => endpoint.task === CHAT_TASK)
		.map((endpoint) => endpoint.name)
		.sort((a, b) => a.localeCompare(b));
}

/** The workspace origin, so a URL pasted with a path such as `/serving-endpoints` or `?o=` still works. */
function resolveWorkspaceUrl(settings: ProviderSettings): string {
	if (!settings.baseURL) {
		throw new Error('Databricks needs a workspace URL: set one on the provider before using it');
	}
	const workspaceUrl = toOrigin(settings.baseURL);
	if (!workspaceUrl.startsWith('https://')) {
		throw new Error('The Databricks workspace URL must use https');
	}
	return workspaceUrl;
}

function toOrigin(url: string): string {
	return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).origin;
}

/**
 * Serving endpoints stray from the OpenAI chat API in ways the SDK rejects: Llama refuses the `pattern`
 * keyword in tool schemas, reasoning models such as Qwen answer with a list of reasoning and text
 * blocks instead of a string, and errors are not nested under `error`, so only the status text shows.
 */
function withOpenAIChatFormat(servingFetch: typeof fetch): typeof fetch {
	return (async (input: string | URL, init?: RequestInit) => {
		const response = await servingFetch(input, withSupportedToolSchemas(init));
		return response.ok ? withStringContent(response) : withOpenAIError(response);
	}) as typeof fetch;
}

function withSupportedToolSchemas(init: RequestInit | undefined): RequestInit | undefined {
	if (typeof init?.body !== 'string' || !init.body.includes('"pattern"')) {
		return init;
	}
	const body = JSON.parse(init.body) as { tools?: { function?: { parameters?: unknown } }[] };
	body.tools = body.tools?.map((tool) =>
		tool.function
			? { ...tool, function: { ...tool.function, parameters: withoutPatterns(tool.function.parameters) } }
			: tool,
	);
	return { ...init, body: JSON.stringify(body) };
}

/** Keeps a property named `pattern`: only the keyword goes, the tool input is still checked against its schema. */
function withoutPatterns(schema: unknown): unknown {
	if (Array.isArray(schema)) {
		return schema.map(withoutPatterns);
	}
	if (!isRecord(schema)) {
		return schema;
	}
	return Object.fromEntries(
		Object.entries(schema)
			.filter(([keyword]) => keyword !== 'pattern')
			.map(([keyword, value]) => [
				keyword,
				keyword === 'properties' && isRecord(value)
					? mapValues(value, withoutPatterns)
					: withoutPatterns(value),
			]),
	);
}

async function withStringContent(response: Response): Promise<Response> {
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('text/event-stream') && response.body) {
		const body = response.body
			.pipeThrough(new TextDecoderStream())
			.pipeThrough(mapEventData(flattenCompletionContent))
			.pipeThrough(new TextEncoderStream());
		return rebuildResponse(response, body);
	}
	if (contentType.includes('application/json')) {
		return rebuildResponse(response, flattenCompletionContent(await response.text()));
	}
	return response;
}

async function withOpenAIError(response: Response): Promise<Response> {
	const text = await response.text();
	const { message, error_code: code } = parseJson<{ message?: string; error_code?: string }>(text) ?? {};
	return rebuildResponse(response, message ? JSON.stringify({ error: { message, code } }) : text);
}

/** Rewrites the `data:` lines of a server-sent event stream, whatever chunks the lines arrive split across. */
function mapEventData(map: (data: string) => string): TransformStream<string, string> {
	let pending = '';
	const mapLine = (line: string) => (line.startsWith('data:') ? `data: ${map(line.slice(5).trim())}` : line);
	return new TransformStream({
		transform(chunk, controller) {
			const lines = (pending + chunk).split('\n');
			pending = lines.pop() ?? '';
			controller.enqueue(lines.map((line) => `${mapLine(line)}\n`).join(''));
		},
		flush(controller) {
			if (pending) {
				controller.enqueue(mapLine(pending));
			}
		},
	});
}

/** Splits a list of content blocks into the `content` and `reasoning_content` strings the SDK reads. */
function flattenCompletionContent(json: string): string {
	const completion = CONTENT_BLOCKS_PATTERN.test(json) ? parseJson<Completion>(json) : null;
	if (!completion?.choices) {
		return json;
	}
	for (const choice of completion.choices) {
		flattenContentBlocks(choice.message);
		flattenContentBlocks(choice.delta);
	}
	return JSON.stringify(completion);
}

function flattenContentBlocks(message: CompletionMessage | undefined): void {
	if (!message || !Array.isArray(message.content)) {
		return;
	}
	const blocks = message.content;
	const text = blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
	const reasoning = blocks
		.flatMap((block) => (block.type === 'reasoning' ? block.summary.map((summary) => summary.text) : []))
		.join('');
	message.content = text || null;
	if (reasoning) {
		message.reasoning_content = (message.reasoning_content ?? '') + reasoning;
	}
}

function rebuildResponse(response: Response, body: BodyInit): Response {
	const headers = new Headers(response.headers);
	headers.delete('content-length');
	return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function parseJson<T>(text: string): T | null {
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapValues(record: Record<string, unknown>, map: (value: unknown) => unknown): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]));
}

function authorizedFetch(workspaceUrl: string, settings: ProviderSettings): typeof fetch {
	const baseFetch = settings.fetch ?? fetch;
	return (async (input: string | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		headers.set('Authorization', `Bearer ${await resolveAccessToken(workspaceUrl, settings, baseFetch)}`);
		return baseFetch(input, { ...init, headers });
	}) as typeof fetch;
}

async function resolveAccessToken(
	workspaceUrl: string,
	settings: ProviderSettings,
	baseFetch: typeof fetch,
): Promise<string> {
	const credentials = resolveCredentials(workspaceUrl, settings);
	if (!credentials) {
		throw new Error('Databricks needs a personal access token or a service principal client ID and secret');
	}
	return 'token' in credentials ? credentials.token : getServicePrincipalToken(workspaceUrl, credentials, baseFetch);
}

/** The environment's credentials only sign in to the environment's workspace, never to a URL set elsewhere. */
function resolveCredentials(workspaceUrl: string, settings: ProviderSettings): DatabricksCredentials | null {
	const { clientId, clientSecret } = settings.credentials ?? {};
	if (settings.apiKey) {
		return { token: settings.apiKey };
	}
	if (clientId && clientSecret) {
		return { clientId, clientSecret };
	}
	const envHost = process.env.DATABRICKS_HOST;
	return envHost && toOrigin(envHost) === workspaceUrl ? resolveEnvironmentCredentials() : null;
}

function resolveEnvironmentCredentials(): DatabricksCredentials | null {
	const { DATABRICKS_TOKEN, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET } = process.env;
	if (DATABRICKS_TOKEN) {
		return { token: DATABRICKS_TOKEN };
	}
	if (DATABRICKS_CLIENT_ID && DATABRICKS_CLIENT_SECRET) {
		return { clientId: DATABRICKS_CLIENT_ID, clientSecret: DATABRICKS_CLIENT_SECRET };
	}
	return null;
}

function getServicePrincipalToken(
	workspaceUrl: string,
	servicePrincipal: ServicePrincipal,
	baseFetch: typeof fetch,
): Promise<string> {
	const key = createHash('sha256')
		.update([workspaceUrl, servicePrincipal.clientId, servicePrincipal.clientSecret].join('\n'))
		.digest('hex');
	const cached = servicePrincipalTokens.get(key);
	if (cached && isFresh(cached)) {
		return cached.token;
	}

	evictExpiredTokens();
	const request = requestServicePrincipalToken(workspaceUrl, servicePrincipal, baseFetch);
	const entry: CachedToken = {
		token: request.then(({ accessToken }) => accessToken),
		expiresAt: Number.POSITIVE_INFINITY,
	};
	request.then(
		({ expiresInSeconds }) => {
			entry.expiresAt = Date.now() + expiresInSeconds * 1000 - TOKEN_RENEWAL_MARGIN_MS;
		},
		() => servicePrincipalTokens.delete(key),
	);
	servicePrincipalTokens.set(key, entry);
	return entry.token;
}

function isFresh(entry: CachedToken): boolean {
	return Date.now() < entry.expiresAt;
}

function evictExpiredTokens(): void {
	for (const [key, entry] of servicePrincipalTokens) {
		if (!isFresh(entry)) {
			servicePrincipalTokens.delete(key);
		}
	}
}

/** OAuth machine-to-machine sign-in against the workspace token endpoint. */
async function requestServicePrincipalToken(
	workspaceUrl: string,
	{ clientId, clientSecret }: ServicePrincipal,
	baseFetch: typeof fetch,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
	const response = await baseFetch(`${workspaceUrl}/oidc/v1/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }).toString(),
	});
	if (!response.ok) {
		throw new Error(`Databricks refused the service principal credentials: ${await describeFailure(response)}`);
	}
	const body = (await response.json()) as { access_token: string; expires_in: number };
	return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}

async function describeFailure(response: Response): Promise<string> {
	const text = await response.text().catch(() => '');
	return text ? `${response.status} ${text.slice(0, 500)}` : String(response.status);
}
