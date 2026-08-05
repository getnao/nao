import { createHash } from 'crypto';

import {
	ContextRecommendationCategory,
	ContextRecommendationFixTarget,
	ContextRecommendationRootCauseKind,
	ContextRecommendationStatus,
	RecommendationImpact,
	RecommendationInsight,
	TriggerRef,
	WindowTotals,
} from '../types/context-recommendation';

export interface ProposedFinding {
	suggestedFile: string;
	subjectKey: string;
	category: ContextRecommendationCategory;
	rootCause: string;
	rootCauseKind?: ContextRecommendationRootCauseKind;
	fixTarget?: ContextRecommendationFixTarget;
	title: string;
	summary: string;
	suggestedAction: string;
	insights: RecommendationInsight[];
	feedbackMessageIds?: string[];
}

export interface ExistingRecommendation {
	id: string;
	fingerprint: string;
	status: ContextRecommendationStatus;
	occurrenceCount: number;
}

export type ReconcileAction =
	| {
			kind: 'insert';
			fingerprint: string;
			finding: ProposedFinding;
			impact: RecommendationImpact;
			impactScore: number;
			feedbackMessageIds: string[];
	  }
	| {
			kind: 'update';
			id: string;
			finding: ProposedFinding;
			impact: RecommendationImpact;
			impactScore: number;
			reopen: boolean;
			feedbackMessageIds: string[];
	  }
	| { kind: 'resolve'; id: string };

/** Every unique trigger target id (message id or tool call id) referenced by the insights. */
export function collectTriggerTargetIds(items: { insights: RecommendationInsight[] }[]): string[] {
	const targetIds = new Set<string>();
	for (const item of items) {
		for (const insight of item.insights) {
			for (const ref of insight.triggerRefs ?? []) {
				if (ref.targetId) {
					targetIds.add(ref.targetId);
				}
			}
		}
	}
	return [...targetIds];
}

/** Every unique chatId referenced by the insights. */
export function collectTriggerChatIds(items: { insights: RecommendationInsight[] }[]): string[] {
	const chatIds = new Set<string>();
	for (const item of items) {
		for (const insight of item.insights) {
			for (const ref of insight.triggerRefs ?? []) {
				chatIds.add(ref.chatId);
			}
		}
	}
	return [...chatIds];
}

/**
 * Repairs the trigger refs of recommendation insights against the database. The
 * recording agent occasionally transcribes a chatId incorrectly, which breaks the chat
 * replay link. When a ref carries a targetId that resolves to a real chat, that chat is
 * authoritative; otherwise the recorded chatId is kept only when it exists in the
 * project. Refs that resolve to nothing are dropped.
 */
export function repairTriggerRefs<T extends { insights: RecommendationInsight[] }>(
	items: T[],
	resolvedByTarget: Map<string, string>,
	validChatIds: Set<string>,
): T[] {
	return items.map((item) => ({
		...item,
		insights: item.insights.map((insight) => ({
			...insight,
			triggerRefs: insight.triggerRefs
				? repairRefs(insight.triggerRefs, resolvedByTarget, validChatIds)
				: insight.triggerRefs,
		})),
	}));
}

function repairRefs(
	refs: TriggerRef[],
	resolvedByTarget: Map<string, string>,
	validChatIds: Set<string>,
): TriggerRef[] {
	const repaired: TriggerRef[] = [];
	const seen = new Set<string>();
	for (const ref of refs) {
		const resolvedChatId = ref.targetId ? resolvedByTarget.get(ref.targetId) : undefined;
		const chatId = resolvedChatId ?? (validChatIds.has(ref.chatId) ? ref.chatId : undefined);
		if (!chatId) {
			continue;
		}
		const key = `${chatId}\u0000${ref.targetId ?? ''}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		repaired.push({ chatId, targetId: ref.targetId });
	}
	return repaired;
}

export function fingerprintFor(suggestedFile: string, subjectKey: string): string {
	return createHash('sha256').update(`${suggestedFile} ${subjectKey}`).digest('hex');
}

/**
 * Scores a finding so recommendations can be ordered (highest impact first) and
 * weak signals filtered out via the impact floor. The score blends two things:
 * the share of the window's total friction the finding accounts for, and how many
 * distinct chats it touched.
 */
export function computeImpact(
	insights: RecommendationInsight[],
	totals: WindowTotals,
): { impact: RecommendationImpact; impactScore: number } {
	const affectedChats = new Set(insights.flatMap((insight) => insight.triggerRefs?.map((r) => r.chatId) ?? [])).size;
	const findingCount = insights.reduce((sum, insight) => sum + insight.count, 0);
	const totalFriction = totals.errors + totals.downvotes + totals.regenerations;
	const failureShare = totalFriction === 0 ? 0 : Math.min(1, findingCount / totalFriction);

	const impact: RecommendationImpact = { affectedChats, failureShare };
	const impactScore = Math.round(failureShare * 100) + affectedChats * 5;
	return { impact, impactScore };
}

export function reconcile(input: {
	existing: ExistingRecommendation[];
	recorded: ProposedFinding[];
	resolvedFingerprints: string[];
	dismissedFingerprints: string[];
	totals: WindowTotals;
	impactFloor: number;
}): ReconcileAction[] {
	const { existing, recorded, resolvedFingerprints, dismissedFingerprints, totals, impactFloor } = input;
	const byFingerprint = new Map(existing.map((r) => [r.fingerprint, r]));
	const dismissed = new Set(dismissedFingerprints);
	const actions: ReconcileAction[] = [];
	const handled = new Set<string>();

	// Collapse repeat recordings of the same resource within a run (last wins) so a
	// fingerprint yields exactly one action and never a duplicate insert.
	const recordedByFingerprint = new Map<string, ProposedFinding>();
	for (const finding of recorded) {
		recordedByFingerprint.set(fingerprintFor(finding.suggestedFile, finding.subjectKey), finding);
	}

	for (const [fingerprint, finding] of recordedByFingerprint) {
		if (dismissed.has(fingerprint)) {
			continue;
		}
		const { impact, impactScore } = computeImpact(finding.insights, totals);
		const current = byFingerprint.get(fingerprint);
		if (current) {
			handled.add(fingerprint);
			const reopen = current.status === 'applied';
			const feedbackMessageIds = finding.feedbackMessageIds ?? [];
			actions.push({ kind: 'update', id: current.id, finding, impact, impactScore, reopen, feedbackMessageIds });
		} else if (impactScore >= impactFloor) {
			const feedbackMessageIds = finding.feedbackMessageIds ?? [];
			actions.push({ kind: 'insert', fingerprint, finding, impact, impactScore, feedbackMessageIds });
		}
	}

	for (const fingerprint of resolvedFingerprints) {
		if (handled.has(fingerprint) || dismissed.has(fingerprint)) {
			continue;
		}
		const current = byFingerprint.get(fingerprint);
		if (current && current.status === 'open') {
			actions.push({ kind: 'resolve', id: current.id });
		}
	}

	return actions;
}
