import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedPrompt } from '@nao/backend/saved-prompts';
import {
	PromptSuggestions,
	SUGGESTION_ANIMATION_DELAY,
	SUGGESTION_ANIMATION_DURATION,
} from '@/components/prompt-suggestions';
import { useSavedPromptsQuery } from '@/hooks/use-saved-prompts';
import { pickUniqueFrom } from '@/lib/random';

const SHOW_DURATION = 8_000;

export function SavedPromptSuggestions({ projectId }: { projectId?: string }) {
	const { data: savedPrompts } = useSavedPromptsQuery(projectId);
	const { displayedPrompts, animationKey, hidePrompts, pause, resume } = usePromptRotation(savedPrompts, 3);
	const suggestions = useMemo(
		() => displayedPrompts.map((prompt) => ({ label: prompt.title, prompt: prompt.prompt })),
		[displayedPrompts],
	);

	return (
		<PromptSuggestions
			key={animationKey}
			title='Suggested ideas based on your data set'
			suggestions={suggestions}
			isFadingOut={hidePrompts}
			className='max-w-3xl mx-auto'
			onMouseEnter={pause}
			onMouseLeave={resume}
		/>
	);
}

function usePromptRotation(savedPrompts: SavedPrompt[] | undefined, n: number) {
	const [displayedPrompts, setDisplayedPrompts] = useState<SavedPrompt[]>([]);
	const [animationKey, setAnimationKey] = useState(0);
	const [paused, setPaused] = useState(false);
	const [hidePrompts, setHidePrompts] = useState(false);

	useEffect(() => {
		if (!savedPrompts || savedPrompts.length <= n) {
			setHidePrompts(false);
			return setDisplayedPrompts(savedPrompts ?? []);
		}

		setDisplayedPrompts((prev) => (prev.length === 0 ? pickUniqueFrom(savedPrompts, n) : prev));

		if (paused) {
			return;
		}

		let hideTimeout: NodeJS.Timeout | undefined;

		const scheduleHide = () => {
			clearTimeout(hideTimeout);
			hideTimeout = setTimeout(
				() => {
					setHidePrompts(true);
				},
				SHOW_DURATION - SUGGESTION_ANIMATION_DELAY * n,
			);
		};

		scheduleHide();

		const interval = setInterval(() => {
			setDisplayedPrompts(pickUniqueFrom(savedPrompts, n));
			setAnimationKey((prev) => prev + 1);
			setHidePrompts(false);
			scheduleHide();
		}, SHOW_DURATION + SUGGESTION_ANIMATION_DURATION);

		return () => {
			clearInterval(interval);
			clearTimeout(hideTimeout);
		};
	}, [savedPrompts, paused, n]);

	const pause = useCallback(() => {
		setPaused(true);
		setHidePrompts(false);
	}, []);

	const resume = useCallback(() => {
		setPaused(false);
		setHidePrompts(false);
	}, []);

	return { displayedPrompts, animationKey, hidePrompts, pause, resume };
}
