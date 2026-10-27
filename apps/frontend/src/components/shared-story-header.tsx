import { useState } from 'react';

import type { StoryPageHeaderProps, StoryRefreshFailure } from '@/components/story-page-header';
import { StorySubscriptionDialog } from '@/components/side-panel/story-subscription-dialog';
import { StoryPageHeader } from '@/components/story-page-header';

interface SharedStoryHeaderProps {
	title: string;
	authorName: string;
	storyChatHeader?: Pick<StoryPageHeaderProps, 'storyChat' | 'canDuplicate'>;
	isLive: boolean;
	cachedAt?: string | Date | null;
	lastRefreshFailure?: StoryRefreshFailure | null;
	isRefreshing: boolean;
	canRefresh: boolean;
	onRefresh: () => void;
	storyId: string | null;
	download: StoryPageHeaderProps['download'];
}

export function SharedStoryHeader({
	title,
	authorName,
	storyChatHeader,
	isLive,
	cachedAt,
	lastRefreshFailure,
	isRefreshing,
	canRefresh,
	onRefresh,
	storyId,
	download,
}: SharedStoryHeaderProps) {
	const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
	const canManageNotifications = isLive && Boolean(storyId);

	return (
		<>
			<StoryPageHeader
				title={title}
				authorName={authorName}
				{...storyChatHeader}
				live={
					isLive
						? {
								isLive: true,
								cachedAt,
								lastRefreshFailure,
								isRefreshing,
								canRefresh,
								onRefresh,
								isInActionsMenu: true,
								onManageNotifications: canManageNotifications
									? () => setIsSubscriptionOpen(true)
									: undefined,
							}
						: undefined
				}
				download={download}
				storyId={storyId}
			/>

			{storyId && (
				<StorySubscriptionDialog
					open={isSubscriptionOpen}
					onOpenChange={setIsSubscriptionOpen}
					storyId={storyId}
				/>
			)}
		</>
	);
}
