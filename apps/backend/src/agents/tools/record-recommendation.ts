import { z } from 'zod';

import { ProposedFinding } from '../../services/context-recommendations.reconcile';
import {
	CONTEXT_RECOMMENDATION_SEVERITIES,
	CONTEXT_RECOMMENDATION_SIGNAL_TYPES,
} from '../../types/context-recommendation';
import { createTool } from '../../utils/tools';

const InsightSchema = z.object({
	signalType: z.enum(CONTEXT_RECOMMENDATION_SIGNAL_TYPES),
	metric: z.string(),
	count: z.number().int().nonnegative(),
	exampleChatIds: z.array(z.string()).optional(),
	snippet: z.string().optional(),
});

const RecordSchema = z.object({
	suggestedFile: z.string().describe('Project-relative path of the context file to edit.'),
	subjectKey: z.string().describe('Stable subject within the file (table, column, or normalized rule).'),
	severity: z.enum(CONTEXT_RECOMMENDATION_SEVERITIES),
	title: z.string(),
	summary: z.string(),
	suggestedAction: z.string(),
	insights: z.array(InsightSchema).min(1),
});
type RecordInput = z.infer<typeof RecordSchema>;

const ResolveSchema = z.object({
	fingerprint: z.string().describe('Fingerprint of an existing recommendation you verified is now fixed.'),
});
type ResolveInput = z.infer<typeof ResolveSchema>;

type Ack = { _version: '1'; ok: true };

export interface RecommendationCollector {
	recorded: ProposedFinding[];
	resolvedFingerprints: string[];
	recordTool: ReturnType<typeof createTool<RecordInput, Ack>>;
	resolveTool: ReturnType<typeof createTool<ResolveInput, Ack>>;
}

export function createRecommendationCollector(): RecommendationCollector {
	const recorded: ProposedFinding[] = [];
	const resolvedFingerprints: string[] = [];

	const recordTool = createTool<RecordInput, Ack>({
		description:
			'Record one diagnostic recommendation for a single context resource (a file + subject). Call once per resource you find problematic, attaching the supporting insights.',
		inputSchema: RecordSchema,
		execute: async (input) => {
			recorded.push(input);
			return { _version: '1', ok: true };
		},
	});

	const resolveTool = createTool<ResolveInput, Ack>({
		description:
			'Mark an existing recommendation (by fingerprint) as resolved — only after you have verified the gap is actually fixed in the context files.',
		inputSchema: ResolveSchema,
		execute: async ({ fingerprint }) => {
			resolvedFingerprints.push(fingerprint);
			return { _version: '1', ok: true };
		},
	});

	return { recorded, resolvedFingerprints, recordTool, resolveTool };
}
