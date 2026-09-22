import { z } from 'zod';

import { ProposedFinding } from '../../services/context-recommendations.reconcile';
import {
	CONTEXT_RECOMMENDATION_CATEGORIES,
	CONTEXT_RECOMMENDATION_FIX_TARGETS,
	CONTEXT_RECOMMENDATION_ROOT_CAUSE_KINDS,
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
			'Stable identifier of the concrete fix to apply — the edit a maintainer would make — not the observed symptom nor the diagnosed root cause. This is the grouping key: two findings share it only when a single edit would resolve both, and they then collapse into one recommendation with each occurrence recorded as an insight; findings that each need their own independent edit get their own key, even when they trace back to the same root cause. Prefer a normalized verb-plus-target slug naming the specific thing changed.',
		),
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
	title: z
		.string()
		.describe(
			'Plain-language title a non-technical business user understands at a glance: name the PROBLEM as it is observed (what visibly goes wrong), not your conclusion about its cause (that belongs in rootCause) and not a technical fix statement. Synthesize it into one natural phrase and avoid technical identifiers. Hard rules: NO dashes, em-dashes, or "identifier:" prefixes appending detail; NO counts, metrics, time windows, file paths, or raw tool/table/column/argument names. Examples: write "Chart tool call with wrong arguments" instead of "display_chart: donut chart type missing x_axis_type — 1 failure this window"; write "Call of a table that doesn\'t exist returns an error" instead of "dim_countries: phantom table — 404 errors when agent tries lat/lon joins"; write "Audit queries fail on a column that does not exist" instead of "v_messages primary key is id, not message_id"; write "Previously diagnosed fixes are never applied" instead of "RULES.md too minimal".',
		),
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
	feedbackMessageIds: z
		.array(z.string())
		.optional()
		.describe(
			'IDs of downvoted messages (from v_messages where vote = "down") that this recommendation addresses.',
		),
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
			'Record one recommendation per concrete fix — the smallest edit that resolves the finding — grouping by that fix rather than by root cause. When one root cause decomposes into several independent edits, record several recommendations; when a single edit resolves a pattern seen across many chats, record one recommendation and attach each occurrence as an insight.',
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
