import type { DBSharedStory } from '../db/abstractSchema';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { teardownStoryDelivery } from './story-delivery.service';

export async function unshareStory(
	share: Pick<DBSharedStory, 'id' | 'storyId' | 'projectId' | 'userId'>,
): Promise<void> {
	await sharedStoryQueries.deleteSharedStory(share.id);
	const storyOwnerId = (await storyQueries.getStoryOwnerId(share.storyId)) ?? share.userId;
	await storyFolderQueries.ensureStoryPrivate(share.storyId, { storyOwnerId, projectId: share.projectId });
	await teardownStoryDelivery(share.storyId);
}
