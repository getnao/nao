import type { DBSharedStory } from '../db/abstractSchema';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { teardownStoryDelivery } from './story-delivery.service';

type StoryShare = Pick<DBSharedStory, 'id' | 'storyId' | 'projectId' | 'userId'>;

/** Delivery is torn down first: an enabled delivery without a share would reach every project member. */
export async function unshareStory(share: StoryShare): Promise<void> {
	await teardownStoryDelivery(share.storyId);
	await sharedStoryQueries.deleteSharedStory(share.id);
	await makeStoryPrivate(share);
}

/** Keeps the share if it was limited to specific people after being listed for revocation. */
export async function unshareProjectWideStory(share: StoryShare): Promise<void> {
	await teardownStoryDelivery(share.storyId);
	if (await sharedStoryQueries.deleteProjectWideSharedStory(share.id)) {
		await makeStoryPrivate(share);
	}
}

async function makeStoryPrivate(share: StoryShare): Promise<void> {
	const storyOwnerId = (await storyQueries.getStoryOwnerId(share.storyId)) ?? share.userId;
	await storyFolderQueries.ensureStoryPrivate(share.storyId, { storyOwnerId, projectId: share.projectId });
}
