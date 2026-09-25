import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
	CustomStoryFileNotFoundError,
	CustomStoryNotFoundError,
	CustomStoryQueryNotAllowedError,
	CustomStoryQueryNotFoundError,
} from '../services/custom-story';
import { InvalidStoryFilePathError } from './story-file-path';
import { MAX_STORY_SNAPSHOT_BYTES } from './story-snapshot';

export const storySnapshotHtml = z.string().min(1).max(MAX_STORY_SNAPSHOT_BYTES);

export function toCustomStoryTrpcError(error: unknown): unknown {
	if (
		error instanceof CustomStoryNotFoundError ||
		error instanceof CustomStoryFileNotFoundError ||
		error instanceof CustomStoryQueryNotFoundError ||
		error instanceof InvalidStoryFilePathError
	) {
		return new TRPCError({ code: 'NOT_FOUND', message: error.message });
	}
	if (error instanceof CustomStoryQueryNotAllowedError) {
		return new TRPCError({ code: 'FORBIDDEN', message: error.message });
	}
	return error;
}

/** A failing query is the story's content, not a server fault: its message reaches the frame instead of a masked 500. */
export function toCustomStoryQueryTrpcError(error: unknown): unknown {
	const mapped = toCustomStoryTrpcError(error);
	if (mapped === error && error instanceof Error) {
		return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
	}
	return mapped;
}
