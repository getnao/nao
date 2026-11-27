import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimOnce: vi.fn(),
	deleteByProjectId: vi.fn(),
	ensureProjectSlackSettings: vi.fn(),
	getByProjectId: vi.fn(),
	getByTeamId: vi.fn(),
	stopProject: vi.fn(),
	upsert: vi.fn(),
}));

vi.mock('../../src/queries/project-slack-config.queries', () => ({
	ensureProjectSlackSettings: mocks.ensureProjectSlackSettings,
}));

vi.mock('../../src/queries/project-slack-installation.queries', () => ({
	deleteSlackInstallationByProjectId: mocks.deleteByProjectId,
	getSlackInstallationByProjectId: mocks.getByProjectId,
	getSlackInstallationByTeamId: mocks.getByTeamId,
	upsertSlackInstallation: mocks.upsert,
}));

vi.mock('../../src/utils/keyed-lock', () => ({
	claimOnce: mocks.claimOnce,
}));

vi.mock('../../src/services/slack', () => ({
	slackService: { stopProject: mocks.stopProject },
}));

import { __reloadEnvForTesting } from '../../src/env';
import {
	buildSlackOAuthAuthorizationUrl,
	disconnectSlackWorkspace,
	exchangeSlackOAuthCode,
	installSlackWorkspace,
	SLACK_OAUTH_SCOPES,
	SlackWorkspaceAlreadyConnectedError,
	verifySlackOAuthState,
} from '../../src/services/slack-oauth.service';

const PROJECT_ID = 'project-1';
const USER_ID = 'user-1';
const TEAM_ID = 'T123';

describe('Slack OAuth service', () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.BETTER_AUTH_URL = 'https://nao.test';
		process.env.BETTER_AUTH_SECRET = 'test-auth-secret-longer-than-twenty-characters';
		process.env.CLOUD_SLACK_OAUTH_CLIENT_ID = 'client-id';
		process.env.CLOUD_SLACK_OAUTH_CLIENT_SECRET = 'client-secret';
		process.env.CLOUD_SLACK_OAUTH_SIGNING_SECRET = 'signing-secret';
		__reloadEnvForTesting();

		vi.clearAllMocks();
		mocks.claimOnce.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('builds an authorization URL whose signed state can be verified once', async () => {
		const authorizationUrl = new URL(buildSlackOAuthAuthorizationUrl(PROJECT_ID, USER_ID));
		const state = authorizationUrl.searchParams.get('state');

		expect(authorizationUrl.origin + authorizationUrl.pathname).toBe('https://slack.com/oauth/v2/authorize');
		expect(authorizationUrl.searchParams.get('client_id')).toBe('client-id');
		expect(authorizationUrl.searchParams.get('scope')).toBe(SLACK_OAUTH_SCOPES.join(','));
		expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('https://nao.test/api/slack/oauth/callback');
		expect(state).toBeTruthy();

		const verified = await verifySlackOAuthState(state!, USER_ID);
		expect(verified).toMatchObject({ projectId: PROJECT_ID, userId: USER_ID });
		expect(mocks.claimOnce).toHaveBeenCalledWith(`slack-oauth-state:${verified.nonce}`, expect.any(Number));
	});

	it('rejects state that was modified after it was signed', async () => {
		const state = new URL(buildSlackOAuthAuthorizationUrl(PROJECT_ID, USER_ID)).searchParams.get('state')!;
		const [payload, signature] = state.split('.');
		const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		decoded.projectId = 'project-attacker';
		const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');

		await expect(verifySlackOAuthState(`${tamperedPayload}.${signature}`, USER_ID)).rejects.toThrow(
			'Invalid Slack OAuth state',
		);
		expect(mocks.claimOnce).not.toHaveBeenCalled();
	});

	it('rejects expired state and state returned for another user', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
		const expiredState = new URL(buildSlackOAuthAuthorizationUrl(PROJECT_ID, USER_ID)).searchParams.get('state')!;
		vi.advanceTimersByTime(10 * 60_000 + 1);

		await expect(verifySlackOAuthState(expiredState, USER_ID)).rejects.toThrow('expired');

		vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
		const otherUserState = new URL(buildSlackOAuthAuthorizationUrl(PROJECT_ID, USER_ID)).searchParams.get('state')!;
		await expect(verifySlackOAuthState(otherUserState, 'user-2')).rejects.toThrow('current user');
	});

	it('rejects a replayed state nonce', async () => {
		mocks.claimOnce.mockResolvedValue(false);
		const state = new URL(buildSlackOAuthAuthorizationUrl(PROJECT_ID, USER_ID)).searchParams.get('state')!;

		await expect(verifySlackOAuthState(state, USER_ID)).rejects.toThrow('already been used');
	});

	it('exchanges a code without exposing the client secret in the request body', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					ok: true,
					access_token: 'xoxb-token',
					scope: 'chat:write,users:read',
					bot_user_id: 'B123',
					team: { id: TEAM_ID, name: 'Test workspace' },
					enterprise: null,
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(exchangeSlackOAuthCode('temporary-code')).resolves.toEqual({
			teamId: TEAM_ID,
			teamName: 'Test workspace',
			enterpriseId: null,
			botUserId: 'B123',
			botToken: 'xoxb-token',
			scopes: 'chat:write,users:read',
		});

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://slack.com/api/oauth.v2.access');
		expect(new Headers(init.headers).get('authorization')).toBe(
			`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
		);
		expect((init.body as URLSearchParams).get('code')).toBe('temporary-code');
		expect((init.body as URLSearchParams).get('client_secret')).toBeNull();
		expect((init.body as URLSearchParams).get('redirect_uri')).toBe('https://nao.test/api/slack/oauth/callback');
	});

	it('rejects Slack OAuth error responses', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			),
		);

		await expect(exchangeSlackOAuthCode('bad-code')).rejects.toThrow('invalid_code');
	});

	it('prevents a workspace from being installed on a second project', async () => {
		mocks.getByTeamId.mockResolvedValue({ projectId: 'project-2', teamId: TEAM_ID });

		await expect(installSlackWorkspace(newInstallation())).rejects.toBeInstanceOf(
			SlackWorkspaceAlreadyConnectedError,
		);
		expect(mocks.upsert).not.toHaveBeenCalled();
	});

	it('reconnects a workspace already assigned to the same project', async () => {
		const installation = newInstallation();
		const stored = { ...installation, createdAt: new Date(), updatedAt: new Date() };
		mocks.getByTeamId.mockResolvedValue({ projectId: PROJECT_ID, teamId: TEAM_ID });
		mocks.upsert.mockResolvedValue(stored);

		await expect(installSlackWorkspace(installation)).resolves.toEqual(stored);
		expect(mocks.upsert).toHaveBeenCalledWith(installation);
		expect(mocks.ensureProjectSlackSettings).toHaveBeenCalledWith(PROJECT_ID);
	});

	it('uninstalls Slack before stopping and deleting the local installation', async () => {
		mocks.getByProjectId.mockResolvedValue(newInstallation());
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			),
		);

		await disconnectSlackWorkspace(PROJECT_ID);

		expect(mocks.stopProject).toHaveBeenCalledWith(PROJECT_ID);
		expect(mocks.deleteByProjectId).toHaveBeenCalledWith(PROJECT_ID);
	});

	it.each(['invalid_auth', 'token_revoked'])('clears the local installation when Slack reports %s', async (error) => {
		mocks.getByProjectId.mockResolvedValue(newInstallation());
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, error }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			),
		);

		await disconnectSlackWorkspace(PROJECT_ID);

		expect(mocks.stopProject).toHaveBeenCalledWith(PROJECT_ID);
		expect(mocks.deleteByProjectId).toHaveBeenCalledWith(PROJECT_ID);
	});
});

function newInstallation() {
	return {
		projectId: PROJECT_ID,
		teamId: TEAM_ID,
		teamName: 'Test workspace',
		enterpriseId: null,
		botUserId: 'B123',
		encryptedBotToken: 'xoxb-token',
		scopes: 'chat:write,users:read',
		installedByUserId: USER_ID,
	};
}
