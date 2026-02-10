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
	const { data: savedPrompts = [] } = useSavedPromptsQuery();
	const { displayedPrompts, animationKey, hidePrompts, pause, resume } = usePromptRotation(savedPrompts, 3);

	return (
		<div
			className='flex flex-col gap-1 max-w-3xl mx-auto w-full px-6 h-32'
			key={animationKey}
			onMouseEnter={pause}
			onMouseLeave={resume}
		>
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
						'justify-start gap-2 px-3 py-2 text-left rounded-lg',
						hidePrompts ? 'animate-fade-out' : 'animate-fade-in',
					)}
				>
					<CornerDownRight size={14} className='text-muted-foreground opacity-50' />
					<span className='line-clamp-2'>{prompt.title}</span>
				</Button>
			))}
		</div>
	);
}

function usePromptRotation(savedPrompts: SavedPrompt[], n: number) {
	const [displayedPrompts, setDisplayedPrompts] = useState<SavedPrompt[]>([]);
	const [animationKey, setAnimationKey] = useState(0);
	const [paused, setPaused] = useState(false);
	const [hidePrompts, setHidePrompts] = useState(false);

	useEffect(() => {
		if (savedPrompts.length < n) {
			return setDisplayedPrompts(savedPrompts);
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
