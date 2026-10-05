import * as storyFileQueries from '../queries/story-file.queries';
import type { JobHandler } from '../services/scheduler.service';

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export const STORY_BLOB_CLEANUP_JOB_NAME = 'story.blob-cleanup';

export async function runStoryBlobCleanup(): Promise<void> {
	await storyFileQueries.deleteUnreferencedFileBlobs(new Date(Date.now() - GRACE_PERIOD_MS));
}

export const storyBlobCleanupHandler: JobHandler = async () => {
	await runStoryBlobCleanup();
};
