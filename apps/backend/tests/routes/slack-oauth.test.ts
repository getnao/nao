import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	buildAuthorizationUrl: vi.fn(),
	exchangeCode: vi.fn(),
	get: vi.fn(),
	getSession: vi.fn(),
	getUserRoleInProject: vi.fn(),
	installWorkspace: vi.fn(),
	verifyState: vi.fn(),
}));

vi.mock('../../src/auth', () => ({
	getSession: mocks.getSession,
}));

vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));

vi.mock('../../src/services/slack-oauth.service', () => ({
	buildSlackOAuthAuthorizationUrl: mocks.buildAuthorizationUrl,
	exchangeSlackOAuthCode: mocks.exchangeCode,
	installSlackWorkspace: mocks.installWorkspace,
	verifySlackOAuthState: mocks.verifyState,
}));

vi.mock('../../src/utils/utils', () => ({
	convertHeaders: (headers: Record<string, string>) => new Headers(headers),
}));

import { slackOAuthRoutes } from '../../src/routes/slack-oauth';

const SESSION = { user: { id: 'user-1' } };

describe('Slack OAuth routes', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await slackOAuthRoutes({ get: mocks.get } as never);
	});

	it('requires a signed-in user before starting installation', async () => {
		mocks.getSession.mockResolvedValue(null);

		const response = await installHandler()(request({ projectId: 'project-1' }), reply());

		expect(response.redirectUrl).toContain('slack=unauthorized');
		expect(mocks.getUserRoleInProject).not.toHaveBeenCalled();
	});

	it('only lets project admins start installation', async () => {
		mocks.getSession.mockResolvedValue(SESSION);
		mocks.getUserRoleInProject.mockResolvedValue('user');

		const response = await installHandler()(request({ projectId: 'project-1' }), reply());

		expect(response.redirectUrl).toContain('slack=forbidden');
		expect(mocks.buildAuthorizationUrl).not.toHaveBeenCalled();
	});

	it('redirects an admin to the server-built Slack authorization URL', async () => {
		mocks.getSession.mockResolvedValue(SESSION);
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.buildAuthorizationUrl.mockReturnValue('https://slack.com/oauth/v2/authorize?state=signed');

		const response = await installHandler()(request({ projectId: 'project-1' }), reply());

		expect(mocks.buildAuthorizationUrl).toHaveBeenCalledWith('project-1', SESSION.user.id);
		expect(response.redirectUrl).toBe('https://slack.com/oauth/v2/authorize?state=signed');
	});

	it('verifies the callback session and persists Slack access for the signed project', async () => {
		mocks.getSession.mockResolvedValue(SESSION);
		mocks.verifyState.mockResolvedValue({
			projectId: 'project-1',
			userId: SESSION.user.id,
			nonce: 'nonce-1',
			expiresAt: Date.now() + 60_000,
		});
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.exchangeCode.mockResolvedValue({
			teamId: 'T123',
			teamName: 'Test workspace',
			enterpriseId: null,
			botUserId: 'B123',
			botToken: 'xoxb-token',
			scopes: 'chat:write',
		});

		const response = await callbackHandler()(request({ code: 'temporary-code', state: 'signed-state' }), reply());

		expect(mocks.verifyState).toHaveBeenCalledWith('signed-state', SESSION.user.id);
		expect(mocks.exchangeCode).toHaveBeenCalledWith('temporary-code');
		expect(mocks.installWorkspace).toHaveBeenCalledWith({
			projectId: 'project-1',
			teamId: 'T123',
			teamName: 'Test workspace',
			enterpriseId: null,
			botUserId: 'B123',
			encryptedBotToken: 'xoxb-token',
			scopes: 'chat:write',
			installedByUserId: SESSION.user.id,
		});
		expect(response.redirectUrl).toContain('slack=connected');
	});

	it('does not exchange a code when callback state verification fails', async () => {
		mocks.getSession.mockResolvedValue(SESSION);
		mocks.verifyState.mockRejectedValue(new Error('Invalid Slack OAuth state'));

		const response = await callbackHandler()(request({ code: 'temporary-code', state: 'invalid-state' }), reply());

		expect(response.redirectUrl).toContain('slack=error');
		expect(mocks.exchangeCode).not.toHaveBeenCalled();
		expect(mocks.installWorkspace).not.toHaveBeenCalled();
	});
});

function installHandler() {
	return mocks.get.mock.calls[0][1] as RouteHandler;
}

function callbackHandler() {
	return mocks.get.mock.calls[1][2] as RouteHandler;
}

type RouteHandler = (
	request: ReturnType<typeof request>,
	response: ReturnType<typeof reply>,
) => Promise<ReturnType<typeof reply>>;

function request(query: Record<string, string>) {
	return {
		actorUserId: undefined as string | undefined,
		headers: {},
		query,
	};
}

function reply() {
	return {
		redirectUrl: undefined as string | undefined,
		redirect(url: string) {
			this.redirectUrl = url;
			return this;
		},
	};
}
