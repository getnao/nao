import type { LlmSelectedModel } from '@nao/shared/types';
import { generateText, Output } from 'ai';
import { createHash } from 'crypto';
import { z } from 'zod';

import { llmTelemetry } from '../agents/telemetry';
import * as crQueries from '../queries/context-recommendation.queries';
import type { RecommendationInsight } from '../types/context-recommendation';
import { resolveProviderModel } from '../utils/llm';
import { logger } from '../utils/logger';
import type { ExistingRecommendation } from './context-recommendations.reconcile';
import { fingerprintFor } from './context-recommendations.reconcile';

const FeedbackClusterSchema = z.object({
	clusters: z.array(
		z.object({
			title: z.string().describe('Short title for this group of related feedback (max 80 chars).'),
			summary: z
				.string()
				.describe(
					'One paragraph describing the shared pattern behind these downvotes and why the context needs improvement.',
				),
			suggestedAction: z.string().describe('Concrete first step to address the issue in the context files.'),
			suggestedFile: z
				.string()
				.describe(
					'Project-relative path of the context file most relevant to fix (e.g. RULES.md, semantics/revenue.md).',
				),
			subjectKey: z
				.string()
				.describe(
					'Stable machine-readable identifier for the subject within the file (table, column, or normalized rule slug).',
				),
			memberMessageIds: z.array(z.string()).min(1).describe('IDs of the downvoted messages in this cluster.'),
		}),
	),
});

type FeedbackCluster = z.infer<typeof FeedbackClusterSchema>['clusters'][number];

const FALLBACK_SUGGESTED_FILE = 'RULES.md';
const FALLBACK_SUBJECT_KEY = 'unclustered_downvotes';

export async function ensureFeedbackCoverage(
	projectId: string,
	runId: string,
	model: LlmSelectedModel,
	context: { existing: ExistingRecommendation[]; dismissedFingerprints: string[] },
): Promise<void> {
	const unlinked = await crQueries.getUnlinkedNegativeFeedbacks(projectId);
	if (unlinked.length === 0) {
		return;
	}

	const remaining = await attachFeedbackToExistingRecommendations(projectId, unlinked);
	if (remaining.length === 0) {
		return;
	}

	const dismissedSet = new Set(context.dismissedFingerprints);
	const existingByFingerprint = new Map(context.existing.map((r) => [r.fingerprint, r]));

	const clusters = await clusterFeedbacks(projectId, model, remaining);
	if (clusters.length > 0) {
		await applyFeedbackClusters(projectId, runId, clusters, { dismissedSet, existingByFingerprint });
	} else {
		await applyFallbackRecos(projectId, runId, remaining, { dismissedSet, existingByFingerprint });
	}
}

export async function normalizeFeedbackLinks(projectId: string): Promise<void> {
	const links = await crQueries.listAllFeedbackLinks(projectId);
	const linksByMessage = new Map<string, crQueries.FeedbackOwnershipRow[]>();
	for (const link of links) {
		const group = linksByMessage.get(link.messageId) ?? [];
		group.push(link);
		linksByMessage.set(link.messageId, group);
	}

	const staleLinks: { recommendationId: string; messageId: string }[] = [];
	for (const [messageId, group] of linksByMessage) {
		if (group.length <= 1) {
			continue;
		}
		const owner = pickFeedbackOwner(messageId, group);
		for (const link of group) {
			if (link.recommendationId !== owner.recommendationId) {
				staleLinks.push({ recommendationId: link.recommendationId, messageId });
			}
		}
	}
	await crQueries.deleteFeedbackLinks(staleLinks);
}

function pickFeedbackOwner(messageId: string, group: crQueries.FeedbackOwnershipRow[]): crQueries.FeedbackOwnershipRow {
	const active = group.filter((link) => link.status !== 'dismissed');
	const candidates = active.length > 0 ? active : group;
	const origins = candidates.filter((link) => insightsReferenceTarget(link.insights, messageId));
	const pool = origins.length > 0 ? origins : candidates;
	return pool.reduce((best, current) => (isStrongerOwner(current, best) ? current : best));
}

function insightsReferenceTarget(insights: RecommendationInsight[], messageId: string): boolean {
	return (insights ?? []).some((insight) => insight.triggerRefs?.some((ref) => ref.targetId === messageId));
}

function isStrongerOwner(a: crQueries.FeedbackOwnershipRow, b: crQueries.FeedbackOwnershipRow): boolean {
	if (a.impactScore !== b.impactScore) {
		return a.impactScore > b.impactScore;
	}
	return a.createdAt.getTime() > b.createdAt.getTime();
}

async function attachFeedbackToExistingRecommendations(
	projectId: string,
	unlinked: crQueries.UnlinkedFeedback[],
): Promise<crQueries.UnlinkedFeedback[]> {
	const recommendations = await crQueries.getReconcilableRecommendations(projectId);
	const recIdByTarget = new Map<string, string>();
	const recIdsByChat = new Map<string, Set<string>>();
	for (const rec of recommendations) {
		for (const insight of rec.insights ?? []) {
			for (const ref of insight.triggerRefs ?? []) {
				if (ref.targetId && !recIdByTarget.has(ref.targetId)) {
					recIdByTarget.set(ref.targetId, rec.id);
				}
				const chatRecs = recIdsByChat.get(ref.chatId) ?? new Set<string>();
				chatRecs.add(rec.id);
				recIdsByChat.set(ref.chatId, chatRecs);
			}
		}
	}

	const remaining: crQueries.UnlinkedFeedback[] = [];
	for (const feedback of unlinked) {
		const recId = resolveRecommendationForFeedback(feedback, recIdByTarget, recIdsByChat);
		if (recId) {
			await crQueries.linkFeedbackToRecommendation(projectId, recId, [feedback.messageId]);
		} else {
			remaining.push(feedback);
		}
	}
	return remaining;
}

function resolveRecommendationForFeedback(
	feedback: crQueries.UnlinkedFeedback,
	recIdByTarget: Map<string, string>,
	recIdsByChat: Map<string, Set<string>>,
): string | null {
	const strongMatch = recIdByTarget.get(feedback.messageId);
	if (strongMatch) {
		return strongMatch;
	}
	const chatRecs = recIdsByChat.get(feedback.chatId);
	if (chatRecs && chatRecs.size === 1) {
		return [...chatRecs][0];
	}
	return null;
}

async function clusterFeedbacks(
	projectId: string,
	model: LlmSelectedModel,
	unlinked: crQueries.UnlinkedFeedback[],
): Promise<FeedbackCluster[]> {
	const providerModel = await resolveProviderModel(projectId, model.provider, model.modelId);
	if (!providerModel) {
		logger.warn(`Feedback coverage: could not resolve model ${model.provider}/${model.modelId}`, {
			source: 'agent',
		});
		return [];
	}

	const feedbackList = unlinked
		.map(
			(f) =>
				`- message_id: ${f.messageId} | chat_id: ${f.chatId} | user: ${f.userName}` +
				(f.explanation ? ` | explanation: ${f.explanation}` : ''),
		)
		.join('\n');

	try {
		const { output } = await generateText({
			model: providerModel.model,
			system:
				'You are an analyst helping improve an AI analytics agent by grouping user complaints into actionable context improvement recommendations. ' +
				'Group the downvoted messages below by shared root cause, then for each group output a recommendation pointing to the context file that should be fixed. ' +
				'Be conservative: only group messages that share a clear pattern. Isolated complaints become their own cluster. ' +
				'Respond ONLY with the JSON schema — no extra text.',
			messages: [
				{
					role: 'user',
					content: `These ${unlinked.length} downvoted messages are not yet covered by any recommendation:\n\n${feedbackList}\n\nGroup them and return the clusters.`,
				},
			],
			output: Output.object({ schema: FeedbackClusterSchema }),
			maxOutputTokens: 2000,
			experimental_telemetry: llmTelemetry('nao-feedback-coverage', { projectId }),
		});

		return output?.clusters ?? [];
	} catch (err) {
		logger.warn(`Feedback coverage: LLM clustering failed — ${String(err)}`, { source: 'agent' });
		return [];
	}
}

async function applyFeedbackClusters(
	projectId: string,
	runId: string,
	clusters: FeedbackCluster[],
	context: { dismissedSet: Set<string>; existingByFingerprint: Map<string, ExistingRecommendation> },
): Promise<void> {
	const { dismissedSet, existingByFingerprint } = context;
	const allLinked = clusters.flatMap((c) => c.memberMessageIds);
	const dismissedMemberIds = new Set<string>();

	for (const cluster of clusters) {
		const fingerprint = fingerprintFor(cluster.suggestedFile, cluster.subjectKey);
		if (dismissedSet.has(fingerprint)) {
			for (const messageId of cluster.memberMessageIds) {
				dismissedMemberIds.add(messageId);
			}
			continue;
		}
		const recId = await upsertBackfillRecommendation(projectId, runId, fingerprint, cluster, existingByFingerprint);
		await crQueries.linkFeedbackToRecommendation(projectId, recId, cluster.memberMessageIds);
	}

	const unaccountedIds = (await getStillUnlinked(projectId, allLinked)).filter(
		(messageId) => !dismissedMemberIds.has(messageId),
	);
	if (unaccountedIds.length > 0) {
		const unlinked = await crQueries.getUnlinkedNegativeFeedbacks(projectId);
		const remaining = unlinked.filter((f) => unaccountedIds.includes(f.messageId));
		await applyFallbackRecos(projectId, runId, remaining, context);
	}
}

async function applyFallbackRecos(
	projectId: string,
	runId: string,
	unlinked: crQueries.UnlinkedFeedback[],
	context: { dismissedSet: Set<string>; existingByFingerprint: Map<string, ExistingRecommendation> },
): Promise<void> {
	if (unlinked.length === 0) {
		return;
	}
	const { dismissedSet, existingByFingerprint } = context;
	const memberMessageIds = unlinked.map((f) => f.messageId);
	const subjectKey = fallbackSubjectKey(memberMessageIds);
	const fingerprint = fingerprintFor(FALLBACK_SUGGESTED_FILE, subjectKey);
	if (dismissedSet.has(fingerprint)) {
		return;
	}

	const cluster: FeedbackCluster = {
		title: 'Downvoted responses awaiting review',
		summary:
			`${memberMessageIds.length} downvoted ${memberMessageIds.length === 1 ? 'response has' : 'responses have'} ` +
			'no matching recommendation yet. Review the linked chats to find the shared gap in the context.',
		suggestedAction:
			'Open the linked chats and update RULES.md or the relevant semantics file to address the recurring complaints.',
		suggestedFile: FALLBACK_SUGGESTED_FILE,
		subjectKey,
		memberMessageIds,
	};
	const recId = await upsertBackfillRecommendation(projectId, runId, fingerprint, cluster, existingByFingerprint);
	await crQueries.linkFeedbackToRecommendation(projectId, recId, memberMessageIds);
}

function fallbackSubjectKey(messageIds: string[]): string {
	const digest = createHash('sha256')
		.update([...messageIds].sort().join(','))
		.digest('hex');
	return `${FALLBACK_SUBJECT_KEY}:${digest}`;
}

async function upsertBackfillRecommendation(
	projectId: string,
	runId: string,
	fingerprint: string,
	cluster: FeedbackCluster,
	existingByFingerprint: Map<string, ExistingRecommendation>,
): Promise<string> {
	const existing = existingByFingerprint.get(fingerprint);
	if (existing) {
		return existing.id;
	}

	const byFingerprint = await crQueries.getRecommendationByFingerprint(projectId, fingerprint);
	if (byFingerprint) {
		return byFingerprint.id;
	}

	const rec = await crQueries.insertRecommendation({
		projectId,
		runId,
		fingerprint,
		suggestedFile: cluster.suggestedFile,
		subjectKey: cluster.subjectKey,
		title: cluster.title,
		summary: cluster.summary,
		suggestedAction: cluster.suggestedAction,
		category: 'other',
		insights: [
			{
				signalType: 'downvote_theme',
				metric: 'unaddressed_downvotes',
				count: cluster.memberMessageIds.length,
			},
		],
		impactScore: 0,
	});
	return rec.id;
}

async function getStillUnlinked(projectId: string, messageIds: string[]): Promise<string[]> {
	if (messageIds.length === 0) {
		return [];
	}
	const unlinked = await crQueries.getUnlinkedNegativeFeedbacks(projectId);
	const unlinkedSet = new Set(unlinked.map((f) => f.messageId));
	return messageIds.filter((id) => unlinkedSet.has(id));
}
