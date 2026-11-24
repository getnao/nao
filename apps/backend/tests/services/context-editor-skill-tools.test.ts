import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserSkill: vi.fn(),
	updateUserSkill: vi.fn(),
	requestPersonalSkillShare: vi.fn(),
	acceptShareRequest: vi.fn(),
	declineShareRequest: vi.fn(),
	createStrictFileAccess: vi.fn(),
}));

vi.mock('../../src/queries/user-skill.queries', () => ({
	getUserSkill: mocks.getUserSkill,
	updateUserSkill: mocks.updateUserSkill,
}));
vi.mock('../../src/services/user-skill.service', () => ({
	requestPersonalSkillShare: mocks.requestPersonalSkillShare,
	acceptShareRequest: mocks.acceptShareRequest,
	declineShareRequest: mocks.declineShareRequest,
}));
vi.mock('../../src/services/context-explorer-access.service', () => ({
	createStrictFileAccess: mocks.createStrictFileAccess,
}));

import { createContextEditorSkillTools } from '../../src/services/context-editor-skill-tools';
import { createToolContext, executeTool } from '../helpers/tool-context';

const EDITOR = { id: 'user-1', name: 'Ada', email: 'ada@example.com' };
const SKILL = { name: 'my-orders', description: 'My orders.', body: 'Completed only.', shareStatus: 'private' };
const tools = createContextEditorSkillTools(EDITOR);
const context = createToolContext({ projectId: 'project-1', projectFolder: '/tmp/project' });

describe('createContextEditorSkillTools', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getUserSkill.mockResolvedValue(SKILL);
		mocks.updateUserSkill.mockImplementation(async (_project, _user, _name, changes) => ({ ...SKILL, ...changes }));
	});

	it('changes only the parts of the user’s own skill it is given', async () => {
		const output = await executeTool(
			tools.update_personal_skill,
			{ name: 'my-orders', description: 'When I ask for my Monday numbers.' },
			context,
		);

		expect(mocks.updateUserSkill).toHaveBeenCalledWith('project-1', 'user-1', 'my-orders', {
			description: 'When I ask for my Monday numbers.',
		});
		expect(output).toMatchObject({ description: 'When I ask for my Monday numbers.', body: 'Completed only.' });
	});

	it('refuses to change a skill the user does not own', async () => {
		mocks.getUserSkill.mockResolvedValue(null);

		await expect(
			executeTool(tools.update_personal_skill, { name: 'someone-else', body: 'New steps.' }, context),
		).rejects.toThrow("You have no personal skill called 'someone-else'.");
		expect(mocks.updateUserSkill).not.toHaveBeenCalled();
	});

	it('asks to share the user’s skill with the note for the reviewer', async () => {
		mocks.requestPersonalSkillShare.mockResolvedValue({ ...SKILL, shareStatus: 'requested' });

		const output = await executeTool(
			tools.request_personal_skill_share,
			{ name: 'my-orders', note: 'The team needs it.' },
			context,
		);

		expect(mocks.requestPersonalSkillShare).toHaveBeenCalledWith(
			'project-1',
			'user-1',
			'my-orders',
			'The team needs it.',
		);
		expect(output).toMatchObject({ shareStatus: 'requested' });
	});

	it('adds an accepted request to the reviewer’s changes, and declines without touching the files', async () => {
		mocks.createStrictFileAccess.mockResolvedValue({ kind: 'strict' });
		mocks.acceptShareRequest.mockResolvedValue({ path: '/agent/skills/lapsed.md' });

		const accepted = await executeTool(
			tools.review_share_request,
			{ request_id: 'request-1', decision: 'accept' },
			context,
		);
		const declined = await executeTool(
			tools.review_share_request,
			{ request_id: 'request-2', decision: 'decline' },
			context,
		);

		expect(mocks.createStrictFileAccess).toHaveBeenCalledWith('project-1', '/tmp/project', EDITOR);
		expect(mocks.acceptShareRequest).toHaveBeenCalledWith('project-1', 'request-1', { kind: 'strict' });
		expect(accepted).toEqual({ requestId: 'request-1', decision: 'accept', path: '/agent/skills/lapsed.md' });
		expect(mocks.declineShareRequest).toHaveBeenCalledWith('project-1', 'request-2');
		expect(declined).toEqual({ requestId: 'request-2', decision: 'decline', path: null });
		expect(mocks.createStrictFileAccess).toHaveBeenCalledTimes(1);
	});
});
