import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createDraftFile: vi.fn(),
	createStrictFileAccess: vi.fn(),
	getRecommendationById: vi.fn(),
	readFileContent: vi.fn(),
	setRecommendationStatus: vi.fn(),
	writeFileContent: vi.fn(),
}));

vi.mock('../../src/services/context-explorer.service', () => ({
	createDraftFile: mocks.createDraftFile,
	readFileContent: mocks.readFileContent,
	writeFileContent: mocks.writeFileContent,
}));
vi.mock('../../src/services/context-explorer-access.service', () => ({
	createStrictFileAccess: mocks.createStrictFileAccess,
}));
vi.mock('../../src/queries/context-recommendation.queries', () => ({
	getRecommendationById: mocks.getRecommendationById,
	setRecommendationStatus: mocks.setRecommendationStatus,
}));

import {
	applyRecommendationToChanges,
	extractChangedSnippet,
} from '../../src/services/context-recommendation-apply.service';
import { createRecommendation } from '../helpers/context-recommendation';

const EDITOR = { id: 'user-1', name: 'Ada', email: 'ada@example.com' };
const ACCESS = { kind: 'strict' };
const HASH = 'a'.repeat(64);
const OLD_RULES = '# Rules\n\n## Revenue\nSum of amounts.\n';
const NEW_RULES = '# Rules\n\n## Revenue\nSum of amounts, refunds excluded.\n';
const RULES_EDIT = { path: 'RULES.md', kind: 'edit' as const, oldContent: OLD_RULES, newContent: NEW_RULES };

function apply() {
	return applyRecommendationToChanges({
		projectId: 'project-1',
		projectFolder: '/tmp/project',
		editor: EDITOR,
		recommendationId: 'rec-1',
	});
}

describe('applyRecommendationToChanges', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.createStrictFileAccess.mockResolvedValue(ACCESS);
		mocks.getRecommendationById.mockResolvedValue(
			createRecommendation({ id: 'rec-1', proposedEdits: [RULES_EDIT] }),
		);
	});

	it.each([
		{ current: OLD_RULES, written: NEW_RULES, label: 'the file it was proposed on' },
		{
			current: `${OLD_RULES}\n## Orders\nPaid only.\n`,
			written: `${NEW_RULES}\n## Orders\nPaid only.\n`,
			label: 'a file edited elsewhere since',
		},
	])('writes the edit in the user changes on $label and marks it applied', async ({ current, written }) => {
		mocks.readFileContent.mockResolvedValue({ content: current, hash: HASH });

		await expect(apply()).resolves.toEqual({
			recommendationId: 'rec-1',
			title: 'Exclude refunds from revenue',
			changedPaths: ['/RULES.md'],
			unchangedPaths: [],
			conflicts: [],
			status: 'applied',
		});
		expect(mocks.createStrictFileAccess).toHaveBeenCalledWith('project-1', '/tmp/project', EDITOR);
		expect(mocks.writeFileContent).toHaveBeenCalledWith('/RULES.md', written, HASH, ACCESS);
		expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
			id: 'rec-1',
			projectId: 'project-1',
			status: 'applied',
			userId: 'user-1',
		});
	});

	it('leaves a file that already holds the change as it is', async () => {
		mocks.readFileContent.mockResolvedValue({ content: `${NEW_RULES}\n## Orders\n`, hash: HASH });

		const result = await apply();

		expect(result).toMatchObject({ changedPaths: [], unchangedPaths: ['/RULES.md'], status: 'applied' });
		expect(mocks.writeFileContent).not.toHaveBeenCalled();
	});

	it.each([
		{ label: 'whose snippet is gone from the file', edit: RULES_EDIT, current: '# Rules\n\nRewritten by hand.\n' },
		{
			label: 'emptying a file changed since',
			edit: { ...RULES_EDIT, newContent: '' },
			current: '# Rules\n\nRewritten by hand.\n',
		},
	])('reports an edit $label as a conflict and keeps the recommendation open', async ({ edit, current }) => {
		mocks.getRecommendationById.mockResolvedValue(createRecommendation({ id: 'rec-1', proposedEdits: [edit] }));
		mocks.readFileContent.mockResolvedValue({ content: current, hash: HASH });

		const result = await apply();

		expect(result).toMatchObject({
			changedPaths: [],
			conflicts: [{ path: '/RULES.md', reason: expect.stringContaining('changed since') }],
			status: 'open',
		});
		expect(mocks.writeFileContent).not.toHaveBeenCalled();
		expect(mocks.setRecommendationStatus).not.toHaveBeenCalled();
	});

	it('creates a proposed file that does not exist yet', async () => {
		mocks.getRecommendationById.mockResolvedValue(
			createRecommendation({
				id: 'rec-1',
				proposedEdits: [{ path: 'docs/refunds.md', kind: 'create', oldContent: '', newContent: '# Refunds\n' }],
			}),
		);
		mocks.readFileContent.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND', message: 'File not found' }));

		await expect(apply()).resolves.toMatchObject({ changedPaths: ['/docs/refunds.md'], status: 'applied' });
		expect(mocks.createDraftFile).toHaveBeenCalledWith('/docs/refunds.md', '# Refunds\n', ACCESS);
	});

	it('leaves edits of a linked repository to a pull request', async () => {
		const repositoryEdit = {
			...RULES_EDIT,
			path: 'repos/dbt/models/orders.yml',
			targetRepo: {
				repoFullName: 'acme/dbt',
				branch: null,
				path: 'models/orders.yml',
				provider: 'github' as const,
			},
		};
		mocks.getRecommendationById.mockResolvedValue(
			createRecommendation({ id: 'rec-1', proposedEdits: [RULES_EDIT, repositoryEdit] }),
		);
		mocks.readFileContent.mockResolvedValue({ content: OLD_RULES, hash: HASH });

		const result = await apply();

		expect(result).toMatchObject({
			changedPaths: ['/RULES.md'],
			conflicts: [{ path: '/repos/dbt/models/orders.yml', reason: expect.stringContaining('acme/dbt') }],
			status: 'open',
		});
		expect(mocks.readFileContent).toHaveBeenCalledTimes(1);
	});

	it('reports an edit the user may not save as a conflict', async () => {
		mocks.readFileContent.mockResolvedValue({ content: OLD_RULES, hash: HASH });
		mocks.writeFileContent.mockRejectedValue(new Error('This branch is protected.'));

		await expect(apply()).resolves.toMatchObject({
			conflicts: [{ path: '/RULES.md', reason: 'This branch is protected.' }],
			status: 'open',
		});
	});

	it.each([
		{ label: 'not in the project', recommendation: null, error: 'not found' },
		{
			label: 'without edits',
			recommendation: createRecommendation({ fixKind: 'manual', proposedEdits: null }),
			error: 'no file edits',
		},
	])('refuses a recommendation $label', async ({ recommendation, error }) => {
		mocks.getRecommendationById.mockResolvedValue(recommendation);

		await expect(apply()).rejects.toThrow(error);
		expect(mocks.createStrictFileAccess).not.toHaveBeenCalled();
	});
});

describe('extractChangedSnippet', () => {
	it.each([
		{ oldContent: 'a\nb\nc\n', newContent: 'a\nB\nc\n', contextLines: 0, removed: 'b\n', added: 'B\n' },
		{ oldContent: 'a\nc\n', newContent: 'a\nb\nc\n', contextLines: 0, removed: '', added: 'b\n' },
		{ oldContent: 'a\nc\n', newContent: 'a\nb\nc\n', contextLines: 1, removed: 'a\nc\n', added: 'a\nb\nc\n' },
		{ oldContent: 'a\nb\nc\nd', newContent: 'a\nb\nC\nd', contextLines: 1, removed: 'b\nc\nd', added: 'b\nC\nd' },
		{ oldContent: '', newContent: '# New\n', contextLines: 1, removed: '', added: '# New\n' },
	])(
		'keeps $removed → $added of $oldContent with $contextLines context lines',
		({ oldContent, newContent, contextLines, removed, added }) => {
			expect(extractChangedSnippet(oldContent, newContent, contextLines)).toEqual({ removed, added });
		},
	);
});
