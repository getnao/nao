import { BrainCircuit } from 'lucide-react';
import type { ThinkingLevel } from '@nao/shared/types';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const THINKING_OPTIONS: { value: ThinkingLevel; label: string }[] = [
	{ value: 'fast', label: 'Fast' },
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'deep', label: 'Deep' },
];

interface ChatInputThinkingSelectProps {
	value: ThinkingLevel;
	onChange: (level: ThinkingLevel) => void;
}

export function ChatInputThinkingSelect({ value, onChange }: ChatInputThinkingSelectProps) {
	return (
		<Select value={value} onValueChange={(v) => onChange(v as ThinkingLevel)}>
			<SelectTrigger variant='ghost' className='p-0 gap-1 text-sm' size='sm'>
				<SelectValue>
					<div className='flex items-center gap-1.5'>
						<BrainCircuit className='size-3.5 text-muted-foreground' />
						<span className='text-muted-foreground'>
							{THINKING_OPTIONS.find((o) => o.value === value)?.label}
						</span>
					</div>
				</SelectValue>
			</SelectTrigger>

			<SelectContent align='center' position='popper' side='top' collisionPadding={12}>
				{THINKING_OPTIONS.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
