import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import type { QueryDataMap } from '@/components/story-embeds';
import { BrandingHead } from '@/components/branding-head';
import { PublicStoryBanner, ReadonlyStoryContent } from '@/components/story-readonly-content';
import { StoryDownload } from '@/components/story-download';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/main';

export const Route = createFileRoute('/public/stories/$shareId')({
	component: PublicStoryPage,
});

function PublicStoryPage() {
	const { shareId } = Route.useParams();
	const storyQuery = useQuery(trpc.storyShare.getPublic.queryOptions({ shareId }));
	const story = storyQuery.data;

	if (storyQuery.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center py-20'>
				<Spinner />
			</div>
		);
	}

	if (storyQuery.isError || !story) {
		return (
			<div className='flex flex-1 items-center justify-center px-4 py-20 text-center text-sm text-muted-foreground'>
				Story unavailable or no longer published.
			</div>
		);
	}

	return (
		<>
			<BrandingHead />
			<div className='flex min-h-screen flex-col'>
				<header className='border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
					<div className='mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-4 md:px-8'>
						<PublicStoryBanner />
						<div className='flex items-start justify-between gap-4'>
							<div className='min-w-0 space-y-1'>
								<h1 className='truncate text-xl font-semibold'>{story.title}</h1>
								{story.authorName ? (
									<p className='text-sm text-muted-foreground'>By {story.authorName}</p>
								) : null}
							</div>
							<StoryDownload shareId={shareId} isOwner={false} isPublicShare />
						</div>
					</div>
				</header>
				<ReadonlyStoryContent code={story.code} queryData={story.queryData as QueryDataMap | null} />
			</div>
		</>
	);
}
