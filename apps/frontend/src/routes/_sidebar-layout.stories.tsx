import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { trpc } from '@/main';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/auth-client';

export const Route = createFileRoute('/_sidebar-layout/stories')({
	component: StoriesPage,
});

function StoriesPage() {
	const { data: session } = useSession();
	const userStories = useQuery(trpc.story.listAll.queryOptions());
	const sharedStories = useQuery(trpc.storyShare.list.queryOptions());

	const othersSharedStories = useMemo(
		() => sharedStories.data?.filter((s) => s.userId !== session?.user?.id) ?? [],
		[sharedStories.data, session?.user?.id],
	);

	const hasUserStories = (userStories.data?.length ?? 0) > 0;
	const hasSharedStories = othersSharedStories.length > 0;
	const isEmpty = !hasUserStories && !hasSharedStories && !userStories.isLoading && !sharedStories.isLoading;

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-panel'>
			<div className='max-w-5xl w-full mx-auto px-8 py-10'>
				<h1 className='text-xl font-semibold tracking-tight mb-8'>Stories</h1>

				{isEmpty && <EmptyState />}

				{hasUserStories && (
					<section className='mb-10'>
						<h2 className='text-sm font-medium text-muted-foreground mb-4'>My Stories</h2>
						<div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3'>
							{userStories.data!.map((story) => (
								<Link
									key={`${story.chatId}-${story.storyId}`}
									to='/$chatId'
									params={{ chatId: story.chatId }}
									state={{ openStoryId: story.storyId }}
									className={cn(
										'group aspect-[4/3] rounded-lg border bg-background p-4 flex items-end',
										'transition-colors hover:border-foreground/20 hover:bg-sidebar-accent',
									)}
								>
									<span className='text-sm font-medium line-clamp-3 leading-snug'>{story.title}</span>
								</Link>
							))}
						</div>
					</section>
				)}

				{hasSharedStories && (
					<section>
						<h2 className='text-sm font-medium text-muted-foreground mb-4'>Shared in Project</h2>
						<div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3'>
							{othersSharedStories.map((story) => (
								<Link
									key={story.id}
									to='/shared/$shareId'
									params={{ shareId: story.id }}
									className={cn(
										'group aspect-[4/3] rounded-lg border bg-background p-4 flex items-end',
										'transition-colors hover:border-foreground/20 hover:bg-sidebar-accent',
									)}
								>
									<span className='text-sm font-medium line-clamp-3 leading-snug'>{story.title}</span>
								</Link>
							))}
						</div>
					</section>
				)}
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className='flex flex-col items-center justify-center py-24 text-center'>
			<BookOpen className='size-10 text-muted-foreground/40 mb-4' />
			<p className='text-muted-foreground text-sm'>No stories yet.</p>
			<p className='text-muted-foreground/60 text-sm mt-1'>
				Stories will appear here as they are created in your chats.
			</p>
		</div>
	);
}
