import { useQuery } from '@tanstack/react-query';

import type { ResolvedStory } from '@/hooks/use-mentioned-stories';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';

/** The story when the current user can move it to a folder of the current project, as in the stories panel. */
export function useMovableStory(storyId: string | null | undefined): ResolvedStory | undefined {
	const { data: story } = useQuery({
		...trpc.story.resolve.queryOptions({ storyId: storyId ?? '' }),
		enabled: !!storyId,
		retry: false,
	});
	const { data: project } = useQuery(trpc.project.getCurrent.queryOptions());
	const { isAdmin, isViewer } = usePermissions();
	const { running: isAgentEditingStory } = useChatActivity(story?.chatId ?? '');

	const canMove =
		!!story &&
		!story.isArchived &&
		story.projectId === project?.id &&
		(story.isOwner || isAdmin) &&
		!isViewer &&
		!isAgentEditingStory;

	return canMove ? story : undefined;
}
