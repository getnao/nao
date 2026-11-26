import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getRun: vi.fn(),
	listResultOutcomes: vi.fn(),
	getUserSkill: vi.fn(),
	getUserSkillById: vi.fn(),
}));

vi.mock('../../src/queries/test-run.queries', () => ({
	getRun: mocks.getRun,
	listResultOutcomes: mocks.listResultOutcomes,
}));
vi.mock('../../src/queries/user-skill.queries', () => ({
	getUserSkill: mocks.getUserSkill,
	getUserSkillById: mocks.getUserSkillById,
}));
vi.mock('../../src/utils/logger', () => ({ logger: { warn: vi.fn() } }));

import { renderContextEditorPrompt } from '../../src/components/ai/context-editor-prompt';
import { describeShownContextHubPage } from '../../src/services/context-hub-shown-page.service';

const SCOPE = { projectId: 'project-1', userId: 'user-1' };
const RUN = { id: 'run-1', status: 'completed', passedAttempts: 3, completedAttempts: 4, totalAttempts: 4 };
const RESULTS = [
	{ testPath: 'orders.yml', llmModelId: 'gpt-6', passed: true, message: null, errorMessage: null },
	{
		testPath: 'orders.yml',
		llmModelId: 'claude',
		passed: false,
		message: 'Counted returned orders.',
		errorMessage: null,
	},
	{ testPath: 'revenue.yml', llmModelId: 'gpt-6', passed: true, message: null, errorMessage: null },
	{ testPath: 'revenue.yml', llmModelId: 'claude', passed: true, message: null, errorMessage: null },
];

describe('describeShownContextHubPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getRun.mockResolvedValue(RUN);
		mocks.listResultOutcomes.mockResolvedValue(RESULTS);
	});

	it('narrows the run of an open test to that test and lists why it failed', async () => {
		const shown = await describeShownContextHubPage(
			{ type: 'test', path: '/tests/orders.yml', runId: 'run-1' },
			SCOPE,
		);

		expect(shown).toMatchObject({
			type: 'test',
			run: { passedAttempts: 1, completedAttempts: 2, failures: [{ testPath: 'orders.yml', model: 'claude' }] },
		});
		const prompt = renderContextEditorPrompt({ shown, hasRecommendations: false });
		expect(prompt).toContain('The test `/tests/orders.yml`');
		expect(prompt).toContain('1 of 2 answers passed');
		expect(prompt).toContain('failed with claude: Counted returned orders.');
	});

	it('puts the content of the personal skill on screen in the prompt, read for the user only', async () => {
		mocks.getUserSkill.mockResolvedValue({ name: 'my-orders', description: 'My orders.', body: 'Completed only.' });

		const shown = await describeShownContextHubPage({ type: 'personal-skill', name: 'my-orders' }, SCOPE);

		expect(mocks.getUserSkill).toHaveBeenCalledWith('project-1', 'user-1', 'my-orders');
		const prompt = renderContextEditorPrompt({ shown, hasRecommendations: false });
		expect(prompt).toContain('Their personal skill `my-orders`');
		expect(prompt).toContain('Completed only.');
		expect(prompt).toContain('update_personal_skill');
	});

	it('describes an open share request with its author and note, and drops one already handled', async () => {
		const request = { name: 'lapsed', description: 'Lapsed buyers.', body: 'Three orders.', shareNote: 'For CRM.' };
		mocks.getUserSkillById.mockResolvedValueOnce({ ...request, shareStatus: 'requested', authorName: 'Marie' });
		mocks.getUserSkillById.mockResolvedValueOnce({ ...request, shareStatus: 'accepted', authorName: 'Marie' });

		const open = await describeShownContextHubPage({ type: 'share-request', id: 'skill-1' }, SCOPE);
		const handled = await describeShownContextHubPage({ type: 'share-request', id: 'skill-1' }, SCOPE);

		const prompt = renderContextEditorPrompt({ shown: open, hasRecommendations: false });
		expect(prompt).toContain('A request from Marie');
		expect(prompt).toContain('For CRM.');
		expect(prompt).toContain('Three orders.');
		expect(prompt).toContain('request id `skill-1`');
		expect(handled).toEqual({ type: 'share-request', id: 'skill-1', request: null });
	});

	it('still describes the page when its content cannot be loaded', async () => {
		mocks.getRun.mockRejectedValue(new Error('database down'));

		await expect(describeShownContextHubPage({ type: 'tests', runId: 'run-1' }, SCOPE)).resolves.toEqual({
			type: 'tests',
			run: null,
		});
	});
});
