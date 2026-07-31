import { z } from 'zod';

import { ProposedFinding } from '../../services/context-recommendations.reconcile';
import {
	CONTEXT_RECOMMENDATION_CATEGORIES,
	CONTEXT_RECOMMENDATION_FIX_TARGETS,
	CONTEXT_RECOMMENDATION_ROOT_CAUSE_KINDS,
	CONTEXT_RECOMMENDATION_SEVERITIES,
	CONTEXT_RECOMMENDATION_SIGNAL_TYPES,
} from '../../types/context-recommendation';
import { createTool } from '../../utils/tools';

const TriggerRefSchema = z.object({
	chatId: z.string(),
	targetId: z
		.string()
		.optional()
		.describe(
			'Origin of the finding in the chat, used to scroll to and highlight it in the replay: the tool_call_id of the failing tool call for tool_error signals, otherwise the message_id of the message that shows the problem.',
		),
});

const InsightSchema = z.object({
	signalType: z.enum(CONTEXT_RECOMMENDATION_SIGNAL_TYPES),
	metric: z.string(),
	count: z.number().int().nonnegative(),
	triggerRefs: z.array(TriggerRefSchema).optional(),
	snippet: z.string().optional(),
});

const RecordSchema = z.object({
	suggestedFile: z.string().describe('Project-relative path of the context file to edit.'),
	subjectKey: z
		.string()
		.describe(
			'Stable identifier of the FIX to apply, not the symptom observed. Findings that share one root cause must share one subjectKey so they collapse into a single recommendation (e.g. "read-columns-before-query"). Use a table/column name only when that column itself is the thing being corrected (e.g. a data_model metadata fix), never to split one shared rule gap across the tables it affected — those go in insights.',
		),
	severity: z.enum(CONTEXT_RECOMMENDATION_SEVERITIES),
	category: z.enum(CONTEXT_RECOMMENDATION_CATEGORIES),
	rootCause: z
		.string()
		.describe(
			'One sentence explaining the exact sequence that led to this finding (what was read/not read, what mistake followed).',
		),
	rootCauseKind: z
		.enum(CONTEXT_RECOMMENDATION_ROOT_CAUSE_KINDS)
		.optional()
		.describe(
			'context_missing: the needed context does not exist. context_wrong: it exists but is incorrect/outdated. context_not_retrieved: it exists and is correct but the agent failed to fetch it.',
		),
	fixTarget: z
		.enum(CONTEXT_RECOMMENDATION_FIX_TARGETS)
		.optional()
		.describe(
			'Which nao resource to change: rules (RULES.md guidance), data_model (table/column metadata), doc (prose docs), skill (a reusable agent skill), metric (a semantic-layer metric definition).',
		),
	title: z.string().describe('Short label naming the gap (max ~10 words). The WHAT — not the cause, impact, or fix.'),
	summary: z
		.string()
		.describe(
			'The observable symptom and its impact: what users experienced and how often it happened. Do NOT restate the root cause or the fix.',
		),
	suggestedAction: z
		.string()
		.describe(
			'The concrete change to make, phrased as an imperative and referencing the target file. The HOW — do not restate the problem.',
		),
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
			'Record one diagnostic recommendation per distinct fix (a file + the correction to make). Call once per root cause, not once per affected table/column — attach every symptom of that root cause as insights on the same recommendation.',
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
