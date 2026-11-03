import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { useProjectSwitch } from '@/hooks/use-project-switch';
import { trpc } from '@/main';

export function useOpenStoryChat(storyId: string | null) {
	const navigate = useNavigate();
	const { data: currentProject } = useQuery(trpc.project.getCurrent.queryOptions());
	const switchProject = useProjectSwitch(currentProject?.id);
	const { data: story } = useQuery({
		...trpc.story.resolve.queryOptions({ storyId: storyId ?? '' }),
		enabled: Boolean(storyId),
	});

	const switchToStoryProject = async () => {
		if (story?.projectId) {
			await switchProject(story.projectId);
		}
	};

	const openChat = async (chatId: string) => {
		await switchToStoryProject();
		const openStorySlug = story && chatId === story.chatId ? story.slug : undefined;
		navigate({ to: '/$chatId', params: { chatId }, state: openStorySlug ? { openStorySlug } : undefined });
	};

	return { story, switchToStoryProject, openChat, isReady: Boolean(story && currentProject) };
}
