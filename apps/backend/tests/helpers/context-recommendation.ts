import type { DBContextRecommendation } from '../../src/db/abstractSchema';

/** A recommendation as the database returns it, proposing one edit to RULES.md. */
export function createRecommendation(overrides: Partial<DBContextRecommendation> = {}): DBContextRecommendation {
	return {
		id: 'rec',
		projectId: 'project-1',
		runId: 'run-1',
		fingerprint: 'fingerprint',
		suggestedFile: 'RULES.md',
		subjectKey: 'revenue',
		status: 'open',
		impactScore: 80,
		impact: { affectedChats: 4, failureShare: 0.5 },
		insights: [
			{ signalType: 'downvote_theme', metric: 'downvotes', count: 3, triggerRefs: [{ chatId: 'chat-1' }] },
		],
		title: 'Exclude refunds from revenue',
		summary: 'Revenue answers include refunded orders.',
		suggestedAction: 'Document that revenue excludes refunds.',
		fixKind: 'patch',
		fixTarget: 'rules',
		category: 'semantic_missing',
		rootCause: 'RULES.md does not say revenue excludes refunds.',
		rootCauseKind: 'context_missing',
		proposedEdits: [
			{
				path: 'RULES.md',
				kind: 'edit',
				oldContent: '# Revenue',
				newContent: '# Revenue\nRevenue excludes refunds.',
			},
		],
		fixGuidance: null,
		fixPrompt: null,
		prUrl: null,
		prBranch: null,
		prCreatedAt: null,
		llmProvider: null,
		llmModelId: null,
		firstSeenAt: new Date('2026-10-01T03:00:00.000Z'),
		lastSeenAt: new Date('2026-10-20T03:00:00.000Z'),
		occurrenceCount: 2,
		statusChangedAt: null,
		statusChangedBy: null,
		createdAt: new Date('2026-10-01T03:00:00.000Z'),
		...overrides,
	};
}
