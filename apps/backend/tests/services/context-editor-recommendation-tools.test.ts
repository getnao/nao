import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	applyRecommendationToChanges: vi.fn(),
	getRecommendationById: vi.fn(),
	listRecommendations: vi.fn(),
	setRecommendationStatus: vi.fn(),
}));

vi.mock('../../src/queries/context-recommendation.queries', () => ({
	getRecommendationById: mocks.getRecommendationById,
	listRecommendations: mocks.listRecommendations,
	setRecommendationStatus: mocks.setRecommendationStatus,
}));
vi.mock('../../src/services/context-recommendation-apply.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/context-recommendation-apply.service')>()),
	applyRecommendationToChanges: mocks.applyRecommendationToChanges,
}));

import { createContextEditorRecommendationTools } from '../../src/services/context-editor-recommendation-tools';
import { createRecommendation } from '../helpers/context-recommendation';
import { createToolContext, executeTool } from '../helpers/tool-context';

const EDITOR = { id: 'user-1', name: 'Ada', email: 'ada@example.com' };
const tools = createContextEditorRecommendationTools(EDITOR);
const context = createToolContext();

const RULES_RECOMMENDATION = createRecommendation({ id: 'rec-rules' });
const DOC_RECOMMENDATION = createRecommendation({
	id: 'rec-doc',
	title: 'Document refunds',
	proposedEdits: [{ path: 'docs/refunds.md', kind: 'create', oldContent: '', newContent: '# Refunds\n' }],
});
const MANUAL_RECOMMENDATION = createRecommendation({
	id: 'rec-manual',
	fixKind: 'manual',
	proposedEdits: null,
	fixGuidance: 'Describe the column in the dbt model.',
});

describe('createContextEditorRecommendationTools', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.listRecommendations.mockResolvedValue([RULES_RECOMMENDATION, DOC_RECOMMENDATION, MANUAL_RECOMMENDATION]);
	});

	it.each([
		{ path: undefined, ids: ['rec-rules', 'rec-doc', 'rec-manual'] },
		{ path: 'docs/refunds.md', ids: ['rec-doc'] },
		{ path: '/RULES.md', ids: ['rec-rules'] },
	])('lists the open recommendations changing $path', async ({ path, ids }) => {
		const output = await executeTool(tools.list_recommendations, { path }, context);

		expect(mocks.listRecommendations).toHaveBeenCalledWith('project-1', 'open');
		expect(output.recommendations.map((recommendation) => recommendation.id)).toEqual(ids);
		expect(output.totalCount).toBe(ids.length);
	});

	it('summarises a recommendation with the files its edits change', async () => {
		const output = await executeTool(tools.list_recommendations, {}, context);

		expect(output.recommendations).toEqual([
			expect.objectContaining({
				id: 'rec-rules',
				category: 'Semantic missing',
				affectedChats: 4,
				files: ['/RULES.md'],
				hasProposedEdits: true,
			}),
			expect.objectContaining({ id: 'rec-doc', files: ['/docs/refunds.md'] }),
			expect.objectContaining({ id: 'rec-manual', files: [], hasProposedEdits: false }),
		]);
	});

	it('reads a recommendation with the lines each edit removes and adds', async () => {
		mocks.getRecommendationById.mockResolvedValue(RULES_RECOMMENDATION);

		await expect(
			executeTool(tools.get_recommendation, { recommendation_id: 'rec-rules' }, context),
		).resolves.toMatchObject({
			id: 'rec-rules',
			rootCause: 'RULES.md does not say revenue excludes refunds.',
			edits: [
				{
					path: '/RULES.md',
					kind: 'edit',
					linkedRepository: null,
					removed: '# Revenue',
					added: '# Revenue\nRevenue excludes refunds.',
				},
			],
			signals: [{ metric: 'downvotes', count: 3, snippet: null }],
		});
		expect(mocks.getRecommendationById).toHaveBeenCalledWith('project-1', 'rec-rules');
	});

	it('applies a recommendation in the changes of the user of the chat', async () => {
		await executeTool(tools.apply_recommendation, { recommendation_id: 'rec-rules' }, context);

		expect(mocks.applyRecommendationToChanges).toHaveBeenCalledWith({
			projectId: 'project-1',
			projectFolder: '/tmp/project',
			editor: EDITOR,
			recommendationId: 'rec-rules',
		});
	});

	it('dismisses a recommendation on behalf of the user', async () => {
		mocks.getRecommendationById.mockResolvedValue(RULES_RECOMMENDATION);

		await expect(
			executeTool(
				tools.set_recommendation_status,
				{ recommendation_id: 'rec-rules', status: 'dismissed' },
				context,
			),
		).resolves.toEqual({
			recommendationId: 'rec-rules',
			title: 'Exclude refunds from revenue',
			status: 'dismissed',
		});
		expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
			id: 'rec-rules',
			projectId: 'project-1',
			status: 'dismissed',
			userId: 'user-1',
		});
	});

	it('does not touch a recommendation from another project', async () => {
		mocks.getRecommendationById.mockResolvedValue(null);

		await expect(
			executeTool(tools.set_recommendation_status, { recommendation_id: 'rec-9', status: 'dismissed' }, context),
		).rejects.toThrow('Recommendation rec-9 not found in this project.');
		expect(mocks.setRecommendationStatus).not.toHaveBeenCalled();
	});
});
