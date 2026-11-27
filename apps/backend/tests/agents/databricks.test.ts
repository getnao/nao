import { describe, expect, it, vi } from 'vitest';

import { listDatabricksChatEndpoints, toDatabricksServingSettings } from '../../src/agents/databricks';
import type { ProviderSettings } from '../../src/types/llm';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';

const WORKSPACE = 'https://dbc-123.cloud.databricks.com';
const CHAT_URL = `${WORKSPACE}/serving-endpoints/chat/completions`;
const REASONING_AND_TEXT = [
	{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Adding 2 and 3.' }] },
	{ type: 'text', text: '5' },
];

describe('toDatabricksServingSettings', () => {
	restoreProcessEnvAfterEach({
		unset: ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_CLIENT_ID', 'DATABRICKS_CLIENT_SECRET'],
	});

	it.each([
		WORKSPACE,
		`${WORKSPACE}/`,
		`${WORKSPACE}/serving-endpoints`,
		`${WORKSPACE}/?o=42`,
		'dbc-123.cloud.databricks.com',
	])('points at the serving endpoints of the workspace for %s', (baseURL) => {
		expect(toDatabricksServingSettings({ apiKey: 'dapi-token', baseURL }).baseURL).toBe(
			`${WORKSPACE}/serving-endpoints`,
		);
	});

	it('authenticates every call with the personal access token', async () => {
		const fake = fakeFetch();
		const { fetch } = toDatabricksServingSettings({ apiKey: 'dapi-token', baseURL: WORKSPACE, fetch: fake.fetch });

		await fetch!(`${WORKSPACE}/serving-endpoints/chat/completions`, { method: 'POST', headers: { a: 'b' } });

		expect(fake.calls).toEqual([
			{ url: `${WORKSPACE}/serving-endpoints/chat/completions`, authorization: 'Bearer dapi-token' },
		]);
	});

	it('signs the service principal in once and reuses its token', async () => {
		const fake = fakeFetch();
		const settings = servicePrincipalSettings('sp-reused', fake.fetch);

		await toDatabricksServingSettings(settings).fetch!(`${WORKSPACE}/serving-endpoints/chat/completions`);
		await toDatabricksServingSettings(settings).fetch!(`${WORKSPACE}/serving-endpoints/chat/completions`);

		expect(fake.calls).toEqual([
			{ url: `${WORKSPACE}/oidc/v1/token`, authorization: `Basic ${btoa('sp-reused:sp-secret')}` },
			{ url: `${WORKSPACE}/serving-endpoints/chat/completions`, authorization: 'Bearer m2m-token' },
			{ url: `${WORKSPACE}/serving-endpoints/chat/completions`, authorization: 'Bearer m2m-token' },
		]);
	});

	it.each([
		{ env: { DATABRICKS_TOKEN: 'dapi-env' }, authorization: 'Bearer dapi-env' },
		{
			env: { DATABRICKS_CLIENT_ID: 'sp-env', DATABRICKS_CLIENT_SECRET: 'sp-secret' },
			authorization: 'Bearer m2m-token',
		},
	])('only signs the environment credentials in to the environment workspace', async ({ env, authorization }) => {
		Object.assign(process.env, { DATABRICKS_HOST: 'dbc-123.cloud.databricks.com', ...env });
		const fake = fakeFetch();
		const call = (baseURL: string) =>
			toDatabricksServingSettings({ apiKey: '', baseURL, fetch: fake.fetch }).fetch!(`${baseURL}/x`);

		await expect(call('https://elsewhere.example.com')).rejects.toThrow(
			'personal access token or a service principal',
		);
		await call(WORKSPACE);

		expect(fake.calls.at(-1)).toEqual({ url: `${WORKSPACE}/x`, authorization });
	});

	it('drops the pattern keyword that Llama refuses, but keeps a property named pattern', async () => {
		const sent: unknown[] = [];
		const { fetch } = servingSettings(async (_input, init) => {
			sent.push(JSON.parse(String(init?.body)));
			return Response.json({});
		});
		const parameters = {
			type: 'object',
			properties: {
				chart_type: { type: 'string', pattern: '^[a-z]+$' },
				pattern: { type: 'array', items: { type: 'string', pattern: '^x' } },
			},
		};

		await fetch!(CHAT_URL, {
			method: 'POST',
			body: JSON.stringify({ tools: [{ type: 'function', function: { name: 'chart', parameters } }] }),
		});

		expect(sent).toEqual([
			{
				tools: [
					{
						type: 'function',
						function: {
							name: 'chart',
							parameters: {
								type: 'object',
								properties: {
									chart_type: { type: 'string' },
									pattern: { type: 'array', items: { type: 'string' } },
								},
							},
						},
					},
				],
			},
		]);
	});

	it.each([
		{
			name: 'a streamed chunk',
			response: () =>
				new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: REASONING_AND_TEXT } }] })}\n\n`, {
					headers: { 'Content-Type': 'text/event-stream' },
				}),
			read: (text: string) => JSON.parse(text.replace(/^data: /, '')).choices[0].delta,
		},
		{
			name: 'a whole completion',
			response: () => Response.json({ choices: [{ message: { content: REASONING_AND_TEXT } }] }),
			read: (text: string) => JSON.parse(text).choices[0].message,
		},
		{
			name: 'a completion serialized with spaces',
			response: () =>
				new Response(JSON.stringify({ choices: [{ message: { content: REASONING_AND_TEXT } }] }, null, 2), {
					headers: { 'Content-Type': 'application/json' },
				}),
			read: (text: string) => JSON.parse(text).choices[0].message,
		},
	])('turns the content blocks of reasoning models into strings in $name', async ({ response, read }) => {
		const { fetch } = servingSettings(async () => response());

		const text = await (await fetch!(CHAT_URL, { method: 'POST', body: '{}' })).text();

		expect(read(text)).toEqual({ content: '5', reasoning_content: 'Adding 2 and 3.' });
	});

	it('nests the Databricks error under `error` so its message reaches the user', async () => {
		const { fetch } = servingSettings(async () =>
			Response.json(
				{ error_code: 'BAD_REQUEST', message: 'the "pattern" keyword is not supported' },
				{ status: 400 },
			),
		);

		const response = await fetch!(CHAT_URL, { method: 'POST', body: '{}' });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { message: 'the "pattern" keyword is not supported', code: 'BAD_REQUEST' },
		});
	});
});

describe('listDatabricksChatEndpoints', () => {
	it('lists the chat endpoints only, by name', async () => {
		const fake = fakeFetch({
			endpoints: [
				{ name: 'team-gpt', task: 'llm/v1/chat' },
				{ name: 'gte-large', task: 'llm/v1/embeddings' },
				{ name: 'churn-model' },
				{ name: 'databricks-claude-sonnet-4-5', task: 'llm/v1/chat' },
			],
		});

		await expect(
			listDatabricksChatEndpoints({ apiKey: 'dapi-token', baseURL: WORKSPACE, fetch: fake.fetch }),
		).resolves.toEqual(['databricks-claude-sonnet-4-5', 'team-gpt']);
		expect(fake.calls).toEqual([
			{ url: `${WORKSPACE}/api/2.0/serving-endpoints`, authorization: 'Bearer dapi-token' },
		]);
	});

	it('refuses a plain http workspace URL before sending any credentials', async () => {
		const fake = fakeFetch();

		await expect(
			listDatabricksChatEndpoints({
				apiKey: 'dapi-token',
				baseURL: 'http://dbc-123.cloud.databricks.com',
				fetch: fake.fetch,
			}),
		).rejects.toThrow('must use https');
		expect(fake.calls).toEqual([]);
	});

	it('relays why Databricks refused the request', async () => {
		const failing = vi.fn(async () => new Response('{"message":"Invalid access token."}', { status: 403 }));

		await expect(
			listDatabricksChatEndpoints({
				apiKey: 'bad',
				baseURL: WORKSPACE,
				fetch: failing as unknown as typeof fetch,
			}),
		).rejects.toThrow('403 {"message":"Invalid access token."}');
	});
});

function servingSettings(answer: (input: string | URL, init?: RequestInit) => Promise<Response>): ProviderSettings {
	return toDatabricksServingSettings({ apiKey: 'dapi-token', baseURL: WORKSPACE, fetch: answer as typeof fetch });
}

function servicePrincipalSettings(clientId: string, fetch: typeof globalThis.fetch): ProviderSettings {
	return { apiKey: '', baseURL: WORKSPACE, credentials: { clientId, clientSecret: 'sp-secret' }, fetch };
}

/** Answers the token endpoint with an hour-long token and every other URL with `body`. */
function fakeFetch(body: unknown = {}) {
	const calls: { url: string; authorization: string | null }[] = [];
	const fetch = (async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
		const payload = url.endsWith('/oidc/v1/token') ? { access_token: 'm2m-token', expires_in: 3600 } : body;
		return new Response(JSON.stringify(payload), { status: 200 });
	}) as typeof globalThis.fetch;
	return { fetch, calls };
}
