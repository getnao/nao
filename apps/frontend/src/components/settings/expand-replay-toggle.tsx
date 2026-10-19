import { Maximize2, Minimize2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

type ExpandReplayToggleProps = {
	isExpanded: boolean;
	onToggle: () => void;
};

export function ExpandReplayToggle({ isExpanded, onToggle }: ExpandReplayToggleProps) {
	const Icon = isExpanded ? Minimize2 : Maximize2;

	return (
		<Button
			variant='ghost-muted'
			size='sm'
			onClick={onToggle}
			aria-pressed={isExpanded}
			aria-controls='usage-charts'
			className='px-2'
		>
			<Icon />
			{isExpanded ? 'Show charts' : 'Expand replay'}
		</Button>
	);
}
