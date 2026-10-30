import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	getProjectByOrgAndName: vi.fn(),
	getProjectByUserId: vi.fn(),
	getUser: vi.fn(),
	validateApiKey: vi.fn(),
}));

vi.mock('../src/auth', () => ({
	getSession: mocks.getSession,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByOrgAndName: mocks.getProjectByOrgAndName,
	getProjectByUserId: mocks.getProjectByUserId,
}));
vi.mock('../src/queries/user.queries', () => ({
	getUser: mocks.getUser,
}));
vi.mock('../src/services/api-key.service', () => ({
	isApiKey: (token: string) => token.startsWith('nao_'),
	validateApiKey: mocks.validateApiKey,
}));

import { sessionOrApiKeyAuthMiddleware } from '../src/middleware/auth';

const KEY_CREATOR = { id: 'creator-id', deactivatedAt: null };
const ORG_PROJECT = { id: 'org-project-id', orgId: 'org-id' };

describe('sessionOrApiKeyAuthMiddleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.validateApiKey.mockResolvedValue({ createdBy: KEY_CREATOR.id, organization: { id: 'org-id' } });
		mocks.getUser.mockResolvedValue(KEY_CREATOR);
		mocks.getProjectByOrgAndName.mockResolvedValue(ORG_PROJECT);
		mocks.getProjectByUserId.mockResolvedValue(null);
	});

	it('authenticates as the key creator on the named project of the key organization', async () => {
		const { request, reply } = await authenticate({
			authorization: 'Bearer nao_valid',
			'x-nao-project-name': 'shop',
		});

		expect(mocks.validateApiKey).toHaveBeenCalledWith('nao_valid');
		expect(mocks.getProjectByOrgAndName).toHaveBeenCalledWith('org-id', 'shop');
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(request.user).toBe(KEY_CREATOR);
		expect(request.actorUserId).toBe(KEY_CREATOR.id);
		expect(request.project).toBe(ORG_PROJECT);
		expect(reply.status).not.toHaveBeenCalled();
	});

	it('rejects an unknown API key without falling back to session auth', async () => {
		mocks.validateApiKey.mockResolvedValue(null);

		const { request, reply } = await authenticate({ authorization: 'Bearer nao_revoked' });

		expect(reply.status).toHaveBeenCalledWith(401);
		expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid API key' });
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(request.user).toBeUndefined();
	});

	it('rejects a key whose creator is deactivated', async () => {
		mocks.getUser.mockResolvedValue({ ...KEY_CREATOR, deactivatedAt: new Date() });

		const { request, reply } = await authenticate({ authorization: 'Bearer nao_valid' });

		expect(reply.status).toHaveBeenCalledWith(401);
		expect(request.user).toBeUndefined();
	});

	it('rejects a key whose creator no longer exists', async () => {
		mocks.getUser.mockResolvedValue(null);

		const { reply } = await authenticate({ authorization: 'Bearer nao_valid' });

		expect(reply.status).toHaveBeenCalledWith(401);
	});

	it('falls back to the default project when it belongs to the key organization', async () => {
		mocks.getProjectByOrgAndName.mockResolvedValue(null);
		mocks.getProjectByUserId.mockResolvedValue(ORG_PROJECT);

		const { request } = await authenticate({
			authorization: 'Bearer nao_valid',
			'x-nao-project-name': 'local-folder-name-differs',
		});

		expect(mocks.getProjectByUserId).toHaveBeenCalledWith(KEY_CREATOR.id, null);
		expect(request.project).toBe(ORG_PROJECT);
	});

	it('does not select a default project outside the key organization', async () => {
		mocks.getProjectByOrgAndName.mockResolvedValue(null);
		mocks.getProjectByUserId.mockResolvedValue({ id: 'other-project-id', orgId: 'other-org-id' });

		const { request, reply } = await authenticate({
			authorization: 'Bearer nao_valid',
			'x-nao-project-name': 'shop',
			'x-nao-project-id': 'other-project-id',
		});

		expect(mocks.getProjectByUserId).toHaveBeenCalledWith(KEY_CREATOR.id, 'other-project-id');
		expect(request.project).toBeNull();
		expect(reply.status).not.toHaveBeenCalled();
	});

	it('uses session auth for bearer tokens that are not API keys', async () => {
		const sessionUser = { id: 'session-user-id' };
		mocks.getSession.mockResolvedValue({ user: sessionUser, session: { id: 'session-id' } });
		mocks.getProjectByUserId.mockResolvedValue(ORG_PROJECT);

		const { request, reply } = await authenticate({
			authorization: 'Bearer cli-session-token',
			'x-nao-project-id': 'org-project-id',
		});

		expect(mocks.validateApiKey).not.toHaveBeenCalled();
		expect(mocks.getProjectByUserId).toHaveBeenCalledWith('session-user-id', 'org-project-id');
		expect(request.user).toBe(sessionUser);
		expect(request.project).toBe(ORG_PROJECT);
		expect(reply.status).not.toHaveBeenCalled();
	});

	it('rejects requests with neither an API key nor a session', async () => {
		mocks.getSession.mockResolvedValue(null);

		const { reply } = await authenticate({});

		expect(reply.status).toHaveBeenCalledWith(401);
		expect(reply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
	});
});

async function authenticate(headers: Record<string, string>) {
	const request: Record<string, unknown> = { headers };
	const reply = createReply();
	await sessionOrApiKeyAuthMiddleware(request as never, reply as never);
	return { request, reply };
}

function createReply() {
	const reply = {
		status: vi.fn(),
		send: vi.fn((body) => body),
	};
	reply.status.mockReturnValue(reply);
	return reply;
}
