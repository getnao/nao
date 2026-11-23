import { prepareRestrictedStoryCode } from '@nao/shared/story-viewer-restrictions';

import type { DBSharedStory } from '../db/abstractSchema';
import type { SharedStoryWithLatest } from '../queries/shared-story.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { withKpiPreviewData } from '../utils/story-query-data';
import { buildViewerSafeStorySource } from '../utils/story-structure';
import { extractStorySummary } from '../utils/story-summary';
import { teardownStoryDelivery } from './story-delivery.service';
import { hasEffectiveWarehouseRestrictions } from './user-group-context-access.service';

type StoryShare = Pick<DBSharedStory, 'id' | 'storyId' | 'projectId' | 'userId'>;

/**
 * Shared stories as `userId` gets them listed. Code, summary, KPI preview and stored thumbnail all come from the
 * owner's rows, so a viewer with restricted warehouse access gets none of them for someone else's story, and does
 * not see standalone stories, which cannot be rebuilt with their access.
 */
export async function listSharedStoriesForViewer(stories: SharedStoryWithLatest[], projectId: string, userId: string) {
	const isRestricted = await hasEffectiveWarehouseRestrictions(projectId, userId);
	const items = stories
		.map(({ ownerUserId, ...story }) => ({ ...story, canShowThumbnail: !isRestricted || ownerUserId === userId }))
		.filter((story) => story.chatId || story.canShowThumbnail)
		.map((story) => {
			const code = story.canShowThumbnail ? story.code : withoutOwnerCopy(story.code);
			return {
				...story,
				code,
				storySlug: story.slug,
				summary: extractStorySummary(code),
				sharing: {
					visibility: story.visibility,
					sharedWithCount: story.sharedWithCount,
					sharedWithGroupCount: story.sharedWithGroupCount,
					isPinned: story.isPinned,
				},
			};
		});
	const previewed = await withKpiPreviewData(
		items.filter((story) => story.canShowThumbnail),
		(story) => story.storyId,
	);
	const previewByStoryId = new Map(previewed.map((story) => [story.storyId, story.kpiPreviewData]));
	return items.map((story) => ({ ...story, kpiPreviewData: previewByStoryId.get(story.storyId) ?? null }));
}

function withoutOwnerCopy(code: string): string {
	return prepareRestrictedStoryCode(buildViewerSafeStorySource(code)).code;
}

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
