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
		<div className='group/header flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border/60 bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/80'>
			<Button variant='outline' size='sm' onClick={openMobile} className='gap-2 rounded-full px-3 shadow-none'>
				<PanelLeft className='size-4 shrink-0' strokeWidth={1.5} />
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
