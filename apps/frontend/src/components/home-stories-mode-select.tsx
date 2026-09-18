import { ChevronDown, Clock, Sparkles } from 'lucide-react';
import type { ComponentType } from 'react';

import type { HomeStoriesMode } from '@/lib/home-stories-mode';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HOME_STORIES_MODE_DESCRIPTIONS, HOME_STORIES_MODE_LABELS, HOME_STORIES_MODES } from '@/lib/home-stories-mode';

const MODE_ICONS: Record<HomeStoriesMode, ComponentType<{ className?: string }>> = {
	latest: Clock,
	smart: Sparkles,
};

export function HomeStoriesModeSelect({
	value,
	onChange,
}: {
	value: HomeStoriesMode;
	onChange: (mode: HomeStoriesMode) => void;
}) {
	const Icon = MODE_ICONS[value];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost'
					size='sm'
					className='h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground'
					aria-label='Choose which stories to show'
				>
					<Icon className='size-3.5' />
					{HOME_STORIES_MODE_LABELS[value]}
					<ChevronDown className='size-3.5 opacity-60' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-64'>
				<DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as HomeStoriesMode)}>
					{HOME_STORIES_MODES.map((mode) => {
						const ModeIcon = MODE_ICONS[mode];
						return (
							<DropdownMenuRadioItem key={mode} value={mode} className='items-start py-1.5'>
								<ModeIcon className='mt-0.5 size-3.5' />
								<div className='flex flex-col gap-1'>
									<div className='text-sm font-medium leading-none'>
										{HOME_STORIES_MODE_LABELS[mode]}
									</div>
									<div className='text-xs text-muted-foreground'>
										{HOME_STORIES_MODE_DESCRIPTIONS[mode]}
									</div>
								</div>
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
