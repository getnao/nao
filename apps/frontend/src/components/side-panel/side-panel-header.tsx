import { X } from 'lucide-react';

import { useSidePanel } from '@/contexts/side-panel';
import { Button } from '@/components/ui/button';

interface SidePanelHeaderProps {
	title: string;
	label?: string;
}

export function SidePanelHeader({ title, label }: SidePanelHeaderProps) {
	const { close } = useSidePanel();

	return (
		<div className='flex shrink-0 items-center gap-2 border-b px-4 py-2'>
			<Button
				variant='ghost'
				size='icon-sm'
				className='mr-2 hover:rounded-full'
				onClick={close}
				aria-label='Close'
			>
				<X className='size-3.5' strokeWidth={2.25} />
			</Button>
			<div className='min-w-0 flex-1'>
				{label && <div className='text-xs font-medium text-muted-foreground'>{label}</div>}
				<div className='truncate text-sm font-semibold' title={title}>
					{title}
				</div>
			</div>
		</div>
	);
}
