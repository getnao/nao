import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ isCloud: false, baseUrl: '' }));

vi.mock('../../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/env')>()),
	get isCloud() {
		return state.isCloud;
	},
}));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));
vi.mock('../../src/queries/project.queries', () => ({ getProjectById: vi.fn(async () => null) }));
vi.mock('../../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: vi.fn(async () => ({
		provider: 'openaiCompatible',
		apiKey: 'canary-key',
		baseUrl: state.baseUrl,
		enabledModels: ['internal-model'],
		customModels: [{ id: 'internal-model' }],
		modelSettings: {},
		credentials: null,
	})),
	getProjectLlmConfigs: vi.fn(async () => []),
}));

import { resolveProviderModel } from '../../src/utils/llm';

const captured: { url?: string; authorization?: string }[] = [];
const captureServer = http.createServer((request, response) => {
	captured.push({ url: request.url, authorization: request.headers.authorization });
	response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(chatCompletion()));
});

beforeAll(async () => {
	await new Promise<void>((resolve) => captureServer.listen(0, '127.0.0.1', resolve));
	state.baseUrl = `http://127.0.0.1:${(captureServer.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => captureServer.close(() => resolve())));

beforeEach(() => {
	captured.length = 0;
});

describe('a project base URL pointing at a private address', () => {
	it('is refused on cloud before any request leaves the server', async () => {
		state.isCloud = true;

		await expect(generateWithProjectModel()).rejects.toThrow('private address');
		expect(captured).toEqual([]);
	});

	it('is reached on a self-hosted instance, where internal endpoints are the point', async () => {
		state.isCloud = false;

		await generateWithProjectModel();
		expect(captured).toEqual([{ url: '/v1/chat/completions', authorization: 'Bearer canary-key' }]);
	});
});

async function generateWithProjectModel() {
	const resolved = await resolveProviderModel('project-1', 'openaiCompatible', 'internal-model');
	return resolved!.model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
}

function chatCompletion() {
	return {
		id: 'chatcmpl-1',
		object: 'chat.completion',
		created: 0,
		model: 'internal-model',
		choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};
}
