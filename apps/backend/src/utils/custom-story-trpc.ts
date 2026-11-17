import { STORY_FILTER_ID_REGEX } from '@nao/shared/sql-template';
import { STORY_LLM_MAX_OUTPUT_TOKENS, type StoryModelRequest } from '@nao/shared/story-models';
import { STORY_QUERY_PARAM_VALUE_REGEX, type StoryQueryInputs } from '@nao/shared/story-query-inputs';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
	CustomStoryFileNotFoundError,
	CustomStoryNotFoundError,
	CustomStoryQueryExecutionError,
	CustomStoryQueryNotFoundError,
} from '../services/custom-story';
import { CustomStoryModelError } from '../services/custom-story-model';
import { CustomStoryQueryNotAllowedError } from '../services/custom-story-query-access';
import { CustomStorySqlError, MAX_CUSTOM_STORY_SQL_LENGTH } from '../services/custom-story-sql';
import { InvalidStoryStateError } from '../services/custom-story-state';
import { InvalidStoryFilePathError } from './story-file-path';
import { MAX_STORY_SNAPSHOT_BYTES } from './story-snapshot';

export const storySnapshotHtml = z
	.string()
	.min(1)
	.refine((html) => Buffer.byteLength(html, 'utf8') <= MAX_STORY_SNAPSHOT_BYTES, {
		message: `The story snapshot exceeds ${MAX_STORY_SNAPSHOT_BYTES / 1024 / 1024} MB.`,
	});

export const STANDALONE_QUERY_SQL_UNAVAILABLE =
	'This story keeps the rows of its queries but not their SQL. Edit it in a chat to work on its queries.';

export const STANDALONE_SQL_UNAVAILABLE = 'Only stories built in a chat can run their own SQL.';

export const storyStateChange = z.object({
	key: z.string(),
	value: z.unknown(),
	shared: z.boolean(),
});

export const mapBoundaryKey = z.string().min(1).max(64);

const MAX_FILTER_TEXT_LENGTH = 1_000;
const MAX_FILTER_LIST_LENGTH = 500;

const filterText = z.string().max(MAX_FILTER_TEXT_LENGTH);
const storyQueryKey = z.string().regex(STORY_FILTER_ID_REGEX);

const storyQueryFilters = z.record(
	storyQueryKey,
	z.union([
		filterText,
		z.number().finite(),
		z.array(filterText).max(MAX_FILTER_LIST_LENGTH),
		z.object({ from: filterText, to: filterText }),
		z.object({ contains: filterText }),
		z.null(),
	]),
);

export const storyQueryInputs = z
	.object({
		filters: storyQueryFilters.optional(),
		params: z
			.record(storyQueryKey, z.string().max(MAX_FILTER_TEXT_LENGTH).regex(STORY_QUERY_PARAM_VALUE_REGEX))
			.optional(),
	})
	.optional() satisfies z.ZodType<StoryQueryInputs | undefined>;

export const storySqlRequest = z.object({
	sql: z.string().trim().min(1).max(MAX_CUSTOM_STORY_SQL_LENGTH),
	databaseId: z.string().optional(),
	filters: storyQueryFilters.optional(),
});

const MAX_MODEL_PROMPT_LENGTH = 200_000;
const MAX_MODEL_SYSTEM_LENGTH = 20_000;
const MAX_MODEL_SCHEMA_LENGTH = 20_000;

export const storyModelRequest = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('llm'),
		model: z.string().max(500).optional(),
		prompt: z.string().trim().min(1).max(MAX_MODEL_PROMPT_LENGTH),
		system: z.string().max(MAX_MODEL_SYSTEM_LENGTH).optional(),
		schema: z
			.record(z.string(), z.unknown())
			.refine((schema) => JSON.stringify(schema).length <= MAX_MODEL_SCHEMA_LENGTH, {
				message: `The schema exceeds ${MAX_MODEL_SCHEMA_LENGTH} characters.`,
			})
			.optional(),
		maxOutputTokens: z.number().int().positive().max(STORY_LLM_MAX_OUTPUT_TOKENS).optional(),
	}),
]) satisfies z.ZodType<StoryModelRequest>;

export function toCustomStoryTrpcError(error: unknown): unknown {
	if (
		error instanceof CustomStoryNotFoundError ||
		error instanceof CustomStoryFileNotFoundError ||
		error instanceof CustomStoryQueryNotFoundError
	) {
		return new TRPCError({ code: 'NOT_FOUND', message: error.message });
	}
	if (error instanceof InvalidStoryFilePathError || error instanceof InvalidStoryStateError) {
		return new TRPCError({ code: 'BAD_REQUEST', message: error.message });
	}
	if (error instanceof CustomStoryQueryNotAllowedError) {
		return new TRPCError({ code: 'FORBIDDEN', message: error.message });
	}
	return error;
}

/** A failing query is the story's content, not a server fault: its message reaches the frame instead of a masked 500. */
export function toCustomStoryQueryTrpcError(error: unknown): unknown {
	if (
		error instanceof CustomStoryQueryExecutionError ||
		error instanceof CustomStorySqlError ||
		error instanceof CustomStoryModelError
	) {
		return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
	}
	return toCustomStoryTrpcError(error);
}
