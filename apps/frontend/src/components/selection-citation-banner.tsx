import { X } from 'lucide-react';
import { Button } from './ui/button';
import { SelectionCitationExcerpt } from '@/components/selection-citation-excerpt';
import { useChatPendingCitation } from '@/hooks/use-chat-pending-citation';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { useChatId } from '@/hooks/use-chat-id';

export const SelectionCitationBanner = () => {
	const chatId = useChatId();
	const citation = useChatPendingCitation(chatId);

	if (!citation) {
		return null;
	}

	return (
		<div className='relative mb-2 px-4 py-3 border border-border bg-background rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-200'>
			<Button
				variant='ghost'
				size='icon-xs'
				className='absolute top-1.5 right-1.5 text-muted-foreground'
				onClick={() => chatPendingCitationStore.clear(chatId)}
			>
				<X className='size-3' />
			</Button>
			<SelectionCitationExcerpt start={citation.start} end={citation.end} text={citation.text} />
		</div>
	);
};
