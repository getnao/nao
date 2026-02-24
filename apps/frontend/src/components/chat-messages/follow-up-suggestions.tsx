import { CornerDownRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import type { UIToolPart } from '@nao/backend/chat';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { cn } from '@/lib/utils';

export const FollowUpSuggestions = ({ toolPart }: { toolPart: UIToolPart<'suggest_follow_ups'> }) => {
	const setPromptCallback = useSetChatInputCallback();

	if (!toolPart.input) {
		return null;
	}

	if (toolPart.state === 'input-streaming') {
		return (
			<div key={'skeleton'} className='flex flex-col gap-1 animate-fade-in-up'>
				{Array.from({ length: 3 }).map((_, idx) => (
					<div className='flex justify-start items-center gap-2 px-3 py-2 text-left rounded-lg h-9' key={idx}>
						<CornerDownRight size={16} className='text-muted-foreground opacity-50 shrink-0' />
						<Skeleton key={idx} className='w-full h-4 rounded-lg' />
					</div>
				))}
			</div>
		);
	}

	if (toolPart.input.suggestions.length === 0) {
		return null;
	}

	return (
		<div key={'suggestions'} className={cn('flex flex-col gap-1', 'animate-fade-in-up delay-100')}>
			{toolPart.input.suggestions.map((suggestion, index) => (
				<Button
					key={index}
					variant='ghost'
					onClick={() => setPromptCallback.fire(suggestion)}
					className='justify-start gap-2 px-3 py-2 text-left rounded-lg'
				>
					<CornerDownRight className='text-muted-foreground opacity-50' />
					<span className='truncate'>{suggestion}</span>
				</Button>
			))}
		</div>
	);
};
