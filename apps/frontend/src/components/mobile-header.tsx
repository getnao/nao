import { PanelLeft } from 'lucide-react';
import { EditableChatTitle } from '@/components/editable-chat-title';
import { StoryOpenButton } from '@/components/story-open-button';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/contexts/sidebar';

export function MobileHeader({ chatId, title }: { chatId?: string; title?: string }) {
	const { isMobile, openMobile } = useSidebar();

	if (!isMobile) {
		return null;
	}

	return (
		<div className='group/header flex items-center gap-2 px-3 py-2 shrink-0'>
			<Button variant='ghost' size='icon-md' onClick={openMobile}>
				<PanelLeft className='size-4' strokeWidth={1.5} />
			</Button>
			{chatId && title && (
				<>
					<EditableChatTitle
						chatId={chatId}
						title={title}
						className='text-sm text-muted-foreground min-w-0 flex-1'
					/>
				</>
			)}
			<div className='ml-auto shrink-0'>
				<StoryOpenButton variant='ghost' />
			</div>
		</div>
	);
}
