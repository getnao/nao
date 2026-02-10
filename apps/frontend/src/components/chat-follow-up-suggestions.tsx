import { CornerDownRight } from 'lucide-react';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';

export const FollowUpSuggestions = ({ suggestions, isLoading }: { suggestions: string[]; isLoading: boolean }) => {
	const setPromptCallback = useSetChatInputCallback();

	if (isLoading) {
		return (
			<div className='flex flex-col gap-1'>
				{Array.from({ length: 3 }).map((_, idx) => (
					<div className='flex justify-start items-center gap-2 px-3 py-2 text-left rounded-lg h-9' key={idx}>
						<CornerDownRight size={16} className='text-muted-foreground opacity-50 shrink-0' />
						<Skeleton key={idx} className='w-full h-4 rounded-lg' />
					</div>
				))}
			</div>
		);
	}

	if (suggestions.length === 0) {
		return null;
	}

	return (
		<div className='flex flex-col gap-1'>
			{suggestions.map((suggestion, index) => (
				<Button
					key={index}
					variant='ghost'
					onClick={() => setPromptCallback.fire(suggestion)}
					className='justify-start gap-2 px-3 py-2 text-left rounded-lg'
				>
					<CornerDownRight className='text-muted-foreground opacity-50' />
					<span className='line-clamp-2'>{suggestion}</span>
				</Button>
			))}
		</div>
	);
};
