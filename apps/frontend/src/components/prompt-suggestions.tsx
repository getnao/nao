import { CornerDownRight } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { cn } from '@/lib/utils';

export const SUGGESTION_ANIMATION_DURATION = 600;
export const SUGGESTION_ANIMATION_DELAY = 50;

export interface PromptSuggestion {
	label: string;
	prompt: string;
}

/** Ideas of what to ask, listed beside a chat input: picking one writes its prompt in the input. */
export function PromptSuggestions({
	title,
	suggestions,
	isFadingOut = false,
	className,
	...props
}: {
	title: string;
	suggestions: PromptSuggestion[];
	isFadingOut?: boolean;
} & Omit<ComponentProps<'div'>, 'title' | 'children'>) {
	const setChatInput = useSetChatInputCallback();

	if (suggestions.length === 0) {
		return null;
	}

	return (
		<div className={cn('flex flex-col w-full px-1', className)} {...props}>
			<span className='text-foreground font-medium px-3 mb-2'>{title}</span>
			{suggestions.map((suggestion, index) => (
				<Button
					key={index}
					variant='ghost'
					onClick={() => setChatInput.fire(suggestion.prompt)}
					style={{
						animationDelay: `${index * SUGGESTION_ANIMATION_DELAY}ms`,
						animationDuration: `${SUGGESTION_ANIMATION_DURATION}ms`,
					}}
					className={cn(
						'group h-auto justify-start px-3 py-1 text-left rounded-lg whitespace-normal hover:bg-transparent dark:hover:bg-transparent',
						isFadingOut ? 'animate-fade-out' : 'animate-fade-in',
					)}
				>
					<CornerDownRight size={14} className='text-foreground' />
					<span className='line-clamp-2 font-normal text-muted-foreground group-hover:text-foreground'>
						{suggestion.label}
					</span>
				</Button>
			))}
		</div>
	);
}
