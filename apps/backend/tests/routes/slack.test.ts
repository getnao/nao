import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	error: vi.fn(),
	getProjectSlackConfig: vi.fn(),
	getSlackInstallationByTeamId: vi.fn(),
	getWebhooks: vi.fn(),
	post: vi.fn(),
	warn: vi.fn(),
}));

vi.mock('../../src/env', () => ({
	env: { CLOUD_SLACK_OAUTH_SIGNING_SECRET: 'test-signing-secret' },
}));

vi.mock('../../src/queries/project-slack-config.queries', () => ({
	getProjectSlackConfig: mocks.getProjectSlackConfig,
}));

vi.mock('../../src/queries/project-slack-installation.queries', () => ({
	getSlackInstallationByTeamId: mocks.getSlackInstallationByTeamId,
}));

vi.mock('../../src/services/slack', () => ({
	slackService: { getWebhooks: mocks.getWebhooks },
}));

vi.mock('../../src/utils/logger', () => ({
	logger: { error: mocks.error, warn: mocks.warn },
}));

vi.mock('../../src/utils/utils', () => ({
	convertHeaders: (headers: Record<string, string>) => new Headers(headers),
}));

import { slackRoutes } from '../../src/routes/slack';

const SIGNING_SECRET = 'test-signing-secret';

describe('shared Slack webhook route', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await slackRoutes({ post: mocks.post } as never);
	});

	it('answers Slack URL verification after validating the signature', async () => {
		const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-value' });
		const response = await sharedHandler()(signedRequest(body, 'application/json'), reply());

		expect(response.statusCode).toBe(200);
		expect(response.contentType).toBe('text/plain');
		expect(response.body).toBe('challenge-value');
		expect(mocks.getSlackInstallationByTeamId).not.toHaveBeenCalled();
	});

	it.each([
		['missing signature', signedRequest('{}', 'application/json', { signature: undefined })],
		['stale timestamp', signedRequest('{}', 'application/json', { timestamp: String(nowSeconds() - 301) })],
	])('rejects a %s', async (_name, request) => {
		const response = await sharedHandler()(request, reply());

		expect(response.statusCode).toBe(401);
		expect(mocks.getSlackInstallationByTeamId).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'JSON event',
			body: JSON.stringify({ type: 'event_callback', team_id: 'T-JSON' }),
			contentType: 'application/json',
			teamId: 'T-JSON',
		},
		{
			name: 'slash command',
			body: new URLSearchParams({ command: '/new', team_id: 'T-SLASH' }).toString(),
			contentType: 'application/x-www-form-urlencoded',
			teamId: 'T-SLASH',
		},
		{
			name: 'interactive payload',
			body: new URLSearchParams({
				payload: JSON.stringify({ type: 'block_actions', team: { id: 'T-ACTION' } }),
			}).toString(),
			contentType: 'application/x-www-form-urlencoded',
			teamId: 'T-ACTION',
		},
	])('extracts the workspace from a $name', async ({ body, contentType, teamId }) => {
		mocks.getSlackInstallationByTeamId.mockResolvedValue(null);

		const response = await sharedHandler()(signedRequest(body, contentType), reply());

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe('ok');
		expect(mocks.getSlackInstallationByTeamId).toHaveBeenCalledWith(teamId);
		expect(mocks.warn).toHaveBeenCalledWith(
			'Slack request received for an unknown workspace.',
			expect.objectContaining({ context: { teamId } }),
		);
	});

	it('routes a known workspace through its project Slack adapter', async () => {
		const body = JSON.stringify({ type: 'event_callback', team_id: 'T123' });
		const slackConfig = { projectId: 'project-1', botToken: 'xoxb-token' };
		const adapter = vi.fn().mockResolvedValue(
			new Response('handled', {
				status: 202,
				headers: { 'x-slack-test': 'yes' },
			}),
		);
		mocks.getSlackInstallationByTeamId.mockResolvedValue({ projectId: 'project-1', teamId: 'T123' });
		mocks.getProjectSlackConfig.mockResolvedValue(slackConfig);
		mocks.getWebhooks.mockResolvedValue({ slack: adapter });

		const response = await sharedHandler()(signedRequest(body, 'application/json'), reply());

		expect(mocks.getProjectSlackConfig).toHaveBeenCalledWith('project-1');
		expect(mocks.getWebhooks).toHaveBeenCalledWith(slackConfig);
		expect(adapter).toHaveBeenCalledOnce();
		expect(await (adapter.mock.calls[0][0] as Request).text()).toBe(body);
		expect(response.statusCode).toBe(202);
		expect(response.headers['x-slack-test']).toBe('yes');
		expect(response.body).toBe('handled');
	});
});

function sharedHandler() {
	return mocks.post.mock.calls[0][2] as (
		request: ReturnType<typeof signedRequest>,
		response: ReturnType<typeof reply>,
	) => Promise<ReturnType<typeof reply>>;
}

function signedRequest(body: string, contentType: string, overrides: { signature?: string; timestamp?: string } = {}) {
	const timestamp = overrides.timestamp ?? String(nowSeconds());
	const signature =
		'signature' in overrides
			? overrides.signature
			: `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;
	const headers: Record<string, string> = {
		'content-type': contentType,
		'x-slack-request-timestamp': timestamp,
	};
	if (signature) {
		headers['x-slack-signature'] = signature;
	}
	return { headers, method: 'POST', rawBody: body, url: '/api/webhooks/slack' };
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function reply() {
	return {
		statusCode: 200,
		body: undefined as unknown,
		contentType: undefined as string | undefined,
		headers: {} as Record<string, string>,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		type(value: string) {
			this.contentType = value;
			return this;
		},
		header(name: string, value: string) {
			this.headers[name] = value;
			return this;
		},
		send(body: unknown) {
			this.body = body;
			return this;
		},
	};
}
