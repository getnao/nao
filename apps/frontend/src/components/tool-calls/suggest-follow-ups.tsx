import { CornerDownRight } from 'lucide-react';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import type { suggestFollowUps } from '@nao/shared/tools';
import { useSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { isToolSettled } from '@/lib/ai';

export const SuggestFollowUpsToolCall = () => {
	const { toolPart } = useToolCallContext();
	const setPromptCallback = useSetChatInputCallback();
	const input = toolPart.input as suggestFollowUps.Input | undefined;
	const isSettled = isToolSettled(toolPart);

	if (!isSettled) {
		return (
			<div className='flex flex-col gap-1 -mx-3'>
				{Array.from({ length: 3 }).map((_, index) => (
					<Skeleton key={index} className='w-full h-10 rounded-lg' />
				))}
			</div>
		);
	}

	if (!input?.suggestions || input.suggestions.length === 0) {
		return null;
	}

	return (
		<div className='flex flex-col gap-1 -mx-3'>
			{input.suggestions.map((suggestion, index) => (
				<Button
					key={index}
					variant='ghost'
					onClick={() => setPromptCallback.fire(suggestion)}
					className='justify-start gap-2 px-3 py-2 text-left rounded-lg'
				>
					<CornerDownRight size={14} className='text-muted-foreground opacity-50' />
					<span className='line-clamp-2'>{suggestion}</span>
				</Button>
			))}
		</div>
	);
};
