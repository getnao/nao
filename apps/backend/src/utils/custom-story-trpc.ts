import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
	CustomStoryFileNotFoundError,
	CustomStoryNotFoundError,
	CustomStoryQueryExecutionError,
	CustomStoryQueryNotAllowedError,
	CustomStoryQueryNotFoundError,
} from '../services/custom-story';
import { InvalidStoryStateError } from '../services/custom-story-state';
import { InvalidStoryFilePathError } from './story-file-path';
import { MAX_STORY_SNAPSHOT_BYTES } from './story-snapshot';

export const storySnapshotHtml = z
	.string()
	.min(1)
	.refine((html) => Buffer.byteLength(html, 'utf8') <= MAX_STORY_SNAPSHOT_BYTES, {
		message: `The story snapshot exceeds ${MAX_STORY_SNAPSHOT_BYTES / 1024 / 1024} MB.`,
	});

export const storyStateChange = z.object({
	key: z.string(),
	value: z.unknown(),
});

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
	if (error instanceof CustomStoryQueryExecutionError) {
		return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
	}
	return toCustomStoryTrpcError(error);
}
