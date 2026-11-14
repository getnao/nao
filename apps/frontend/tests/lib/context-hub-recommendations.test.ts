import { describe, expect, it } from 'vitest';

import {
	findContextFileEdit,
	groupRecommendationsByFile,
	listContextFileEdits,
} from '@/lib/context-hub-recommendations';

const RULES_EDIT = {
	path: 'RULES.md',
	kind: 'edit' as const,
	oldContent: '# Rules\n',
	newContent: '# Rules\nNo refunds.\n',
};
const DOC_EDIT = { path: 'docs/refunds.md', kind: 'create' as const, oldContent: '', newContent: '# Refunds\n' };
const REPOSITORY_EDIT = {
	path: 'repos/dbt/models/orders.yml',
	kind: 'edit' as const,
	oldContent: 'a',
	newContent: 'b',
	targetRepo: { repoFullName: 'acme/dbt' },
};

describe('context hub recommendations', () => {
	it.each([
		{ fixKind: 'patch', edits: [RULES_EDIT, REPOSITORY_EDIT], paths: ['/RULES.md'] },
		{ fixKind: 'manual', edits: [RULES_EDIT], paths: [] },
		{ fixKind: 'patch', edits: null, paths: [] },
	])('lists the context files a $fixKind fix changes', ({ fixKind, edits, paths }) => {
		const contextFileEdits = listContextFileEdits({ id: 'rec-1', fixKind, proposedEdits: edits });

		expect(contextFileEdits.map((edit) => edit.path)).toEqual(paths);
	});

	it('finds the edit a recommendation proposes on a hub file', () => {
		const recommendation = { id: 'rec-1', fixKind: 'patch', proposedEdits: [RULES_EDIT, DOC_EDIT] };

		expect(findContextFileEdit(recommendation, '/docs/refunds.md')).toMatchObject({ newContent: '# Refunds\n' });
		expect(findContextFileEdit(recommendation, '/docs/orders.md')).toBeNull();
	});

	it('groups the recommendations by the files they change, in their order', () => {
		const rules = { id: 'rec-rules', fixKind: 'patch', proposedEdits: [RULES_EDIT] };
		const both = { id: 'rec-both', fixKind: 'patch', proposedEdits: [DOC_EDIT, RULES_EDIT] };

		const byFile = groupRecommendationsByFile([rules, both]);

		expect([...byFile].map(([path, recommendations]) => [path, recommendations.map(({ id }) => id)])).toEqual([
			['/RULES.md', ['rec-rules', 'rec-both']],
			['/docs/refunds.md', ['rec-both']],
		]);
	});
});
