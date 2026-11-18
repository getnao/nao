import { describeStoryThemeSources } from '@nao/shared/story-theme-generation';
import type { StoryThemeGeneration } from '@nao/shared/story-theme-generation';

import { RotateCwFadingClock } from '@/components/icons/rotate-cw-fading-clock';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ThemeVersionEntry {
	label: string;
	date: Date | null;
	generation: StoryThemeGeneration | null;
}

interface StoryThemeVersionMenuProps {
	entries: ThemeVersionEntry[];
	currentIndex: number;
	onSelect: (index: number) => void;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

export function StoryThemeVersionMenu({ entries, currentIndex, onSelect }: StoryThemeVersionMenuProps) {
	const newestFirst = entries.map((entry, index) => ({ entry, index })).reverse();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost-muted'
					size='sm'
					className='h-6 shrink-0 gap-1 rounded-full px-2 text-xs font-normal tabular-nums text-foreground'
					aria-label='Select theme version'
				>
					<RotateCwFadingClock className='size-3.5' strokeWidth={2.25} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='max-h-80 w-72 overflow-y-auto'>
				<DropdownMenuRadioGroup value={String(currentIndex)} onValueChange={(value) => onSelect(Number(value))}>
					{newestFirst.map(({ entry, index }) => (
						<DropdownMenuRadioItem
							key={index}
							value={String(index)}
							indicator='check'
							className='items-start pr-7 pl-2 [&>span:first-child]:right-2 [&>span:first-child]:left-auto'
						>
							<div className='flex min-w-0 flex-col gap-0.5'>
								<span className='text-xs'>
									{entry.label}
									{entry.date && (
										<span className='text-muted-foreground'>
											{' '}
											· {entry.date.toLocaleString(undefined, DATE_FORMAT)}
										</span>
									)}
								</span>
								<span className='truncate text-xs text-muted-foreground'>{describeEntry(entry)}</span>
							</div>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function describeEntry({ generation }: ThemeVersionEntry): string {
	if (!generation) {
		return 'Set by hand';
	}
	const sources = describeStoryThemeSources(generation.sources);
	return generation.editedByHand ? `From ${sources}, then edited` : `From ${sources}`;
}
