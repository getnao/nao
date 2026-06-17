import { createHash } from 'crypto';

import {
	ContextRecommendationSeverity,
	ContextRecommendationStatus,
	RecommendationImpact,
	RecommendationInsight,
	WindowTotals,
} from '../types/context-recommendation';

export interface ProposedFinding {
	suggestedFile: string;
	subjectKey: string;
	severity: ContextRecommendationSeverity;
	title: string;
	summary: string;
	suggestedAction: string;
	insights: RecommendationInsight[];
}

export interface ExistingRecommendation {
	id: string;
	fingerprint: string;
	status: ContextRecommendationStatus;
	snoozedUntil: Date | null;
	occurrenceCount: number;
}

export type ReconcileAction =
	| {
			kind: 'insert';
			fingerprint: string;
			finding: ProposedFinding;
			impact: RecommendationImpact;
			impactScore: number;
	  }
	| {
			kind: 'update';
			id: string;
			finding: ProposedFinding;
			impact: RecommendationImpact;
			impactScore: number;
			reopen: boolean;
	  }
	| { kind: 'resolve'; id: string };

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
	const affectedChats = new Set(insights.flatMap((insight) => insight.exampleChatIds ?? [])).size;
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
	now: Date;
}): ReconcileAction[] {
	const { existing, recorded, resolvedFingerprints, dismissedFingerprints, totals, impactFloor, now } = input;
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
			const snoozeExpired =
				current.status === 'snoozed' && current.snoozedUntil !== null && current.snoozedUntil <= now;
			const reopen = current.status === 'applied' || snoozeExpired;
			actions.push({ kind: 'update', id: current.id, finding, impact, impactScore, reopen });
		} else if (impactScore >= impactFloor) {
			actions.push({ kind: 'insert', fingerprint, finding, impact, impactScore });
		}
	}

	for (const fingerprint of resolvedFingerprints) {
		if (handled.has(fingerprint) || dismissed.has(fingerprint)) {
			continue;
		}
		const current = byFingerprint.get(fingerprint);
		if (current && (current.status === 'open' || current.status === 'acknowledged')) {
			actions.push({ kind: 'resolve', id: current.id });
		}
	}

	return actions;
}
