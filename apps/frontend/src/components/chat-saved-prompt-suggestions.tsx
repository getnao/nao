import { CornerDownRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import type { SavedPrompt } from '@nao/backend/saved-prompts';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { useSavedPromptsQuery } from '@/hooks/use-saved-prompts';
import { pickUniqueFrom } from '@/lib/random';
import { cn } from '@/lib/utils';

const SHOW_DURATION = 8_000;
const ANIMATION_DURATION = 600;
const ANIMATION_DELAY = 50;

export function SavedPromptSuggestions() {
	const setPromptCallback = useSetChatInputCallback();
	const { data: savedPrompts } = useSavedPromptsQuery();
	const { displayedPrompts, animationKey, hidePrompts, pause, resume } = usePromptRotation(savedPrompts, 3);

	if (displayedPrompts.length === 0) {
		return null;
	}

	return (
		<div
			className='flex flex-col max-w-3xl mx-auto w-full px-1'
			key={animationKey}
			onMouseEnter={pause}
			onMouseLeave={resume}
		>
			<span className='text-foreground font-medium px-3 mb-2'>Suggested ideas based on your data set</span>
			{displayedPrompts.map((prompt, index) => (
				<Button
					key={index}
					variant='ghost'
					onClick={() => setPromptCallback.fire(prompt.prompt)}
					style={{
						animationDelay: `${index * ANIMATION_DELAY}ms`,
						animationDuration: `${ANIMATION_DURATION}ms`,
					}}
					className={cn(
						'group h-auto justify-start px-3 py-1 text-left rounded-lg hover:bg-transparent dark:hover:bg-transparent',
						hidePrompts ? 'animate-fade-out' : 'animate-fade-in',
					)}
				>
					<CornerDownRight size={14} className='text-foreground' />
					<span className='line-clamp-2 font-normal text-muted-foreground group-hover:text-foreground'>
						{prompt.title}
					</span>
				</Button>
			))}
		</div>
	);
}

function usePromptRotation(savedPrompts: SavedPrompt[] | undefined, n: number) {
	const [displayedPrompts, setDisplayedPrompts] = useState<SavedPrompt[]>([]);
	const [animationKey, setAnimationKey] = useState(0);
	const [paused, setPaused] = useState(false);
	const [hidePrompts, setHidePrompts] = useState(false);

	useEffect(() => {
		if (!savedPrompts || savedPrompts.length < n) {
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
				SHOW_DURATION - ANIMATION_DELAY * n,
			);
		};

		scheduleHide();

		const interval = setInterval(() => {
			setDisplayedPrompts(pickUniqueFrom(savedPrompts, n));
			setAnimationKey((prev) => prev + 1);
			setHidePrompts(false);
			scheduleHide();
		}, SHOW_DURATION + ANIMATION_DURATION);

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
