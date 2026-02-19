import { ArrowRightToLine } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ResizableHandle } from '@/components/ui/resizable';
import { useSidePanelResize } from '@/hooks/use-side-panel-resize';

type SidePanelProps = {
	containerRef: React.RefObject<HTMLDivElement | null>;
	sidePanelRef: React.RefObject<HTMLDivElement | null>;
	resizeHandleRef: React.RefObject<HTMLDivElement | null>;
	children: React.ReactNode;
	onClose: () => void;
	isAnimating: boolean;
};

export function SidePanel({
	containerRef,
	sidePanelRef,
	resizeHandleRef,
	children,
	onClose,
	isAnimating,
}: SidePanelProps) {
	useSidePanelResize(sidePanelRef, containerRef, resizeHandleRef, !isAnimating);

	return (
		<div ref={sidePanelRef} className='h-full bg-panel'>
			<div className='h-full min-w-72 relative flex py-4'>
				<div className='h-full relative flex items-center justify-center py-4 w-0 z-20'>
					<Button variant='outline' size='icon-xs' className='ml-auto absolute top-8' onClick={onClose}>
						<ArrowRightToLine className='size-3' />
					</Button>

					<div className='h-full flex justify-center group'>
						<div
							className='flex justify-center items-center h-full w-px min-w-2 cursor-ew-resize rounded-full'
							ref={resizeHandleRef}
						>
							<ResizableHandle aria-orientation='vertical' className='absolute' />
						</div>
					</div>
				</div>

				<div className='h-full overflow-hidden bg-panel shadow-lg rounded-2xl border rounded-r-none w-full'>
					<div className='bg-background overflow-hidden h-full'>{children}</div>
				</div>
			</div>
		</div>
	);
}
