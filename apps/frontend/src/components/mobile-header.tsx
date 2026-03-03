import { PanelLeft } from 'lucide-react';
import { StoryOpenButton } from '@/components/story-open-button';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/contexts/sidebar';

export function MobileHeader() {
	const { isMobile, openMobile } = useSidebar();

	if (!isMobile) {
		return null;
	}

	return (
		<div className='flex items-center gap-2 px-3 py-2 shrink-0'>
			<Button variant='ghost' size='icon-md' onClick={openMobile}>
				<PanelLeft className='size-4' strokeWidth={1.5} />
			</Button>
			<div className='ml-auto'>
				<StoryOpenButton variant='ghost' />
			</div>
		</div>
	);
}
