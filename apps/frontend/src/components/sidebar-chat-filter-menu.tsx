import { CheckIcon, ChevronRight, CircleIcon, ListFilter } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from './ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from './ui/dropdown-menu';
import type { ChatFilterType, ChatGroupBy } from '@nao/shared/types';
import { cn } from '@/lib/utils';

interface ChatFilterMenuProps {
	groupBy: ChatGroupBy;
	filters: ChatFilterType[];
	onGroupByChange: (value: ChatGroupBy) => void;
	onFilterToggle: (filter: ChatFilterType) => void;
}

const GROUP_BY_OPTIONS: { value: ChatGroupBy; label: string }[] = [
	{ value: 'star', label: 'Star' },
	{ value: 'date', label: 'Date' },
	{ value: 'project', label: 'Projects' },
	{ value: 'ownership', label: 'Ownership' },
	{ value: 'sourcePlatform', label: 'Source platform' },
	{ value: 'none', label: 'None' },
];

const FILTER_OPTIONS: { value: ChatFilterType; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'mine', label: 'Mine' },
	{ value: 'starred', label: 'Starred' },
	{ value: 'shared', label: 'Shared' },
	{ value: 'shared_with_me', label: 'Shared with me' },
];

export function ChatFilterMenu({ groupBy, filters, onGroupByChange, onFilterToggle }: ChatFilterMenuProps) {
	const [open, setOpen] = useState(false);
	const [subOpen, setSubOpen] = useState(false);
	const closeTimeout = useRef<ReturnType<typeof setTimeout>>(null);

	const scheduleClose = () => {
		cancelClose();
		closeTimeout.current = setTimeout(() => setOpen(false), 150);
	};

	const cancelClose = () => {
		if (closeTimeout.current) {
			clearTimeout(closeTimeout.current);
			closeTimeout.current = null;
		}
	};

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setSubOpen(false);
		}
	};

	return (
		<DropdownMenu open={open} onOpenChange={handleOpenChange}>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='shrink-0 text-muted-foreground hover:text-foreground hover:bg-transparent'
				>
					<ListFilter className='size-4' />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				align='end'
				side='top'
				className='w-48 overflow-visible'
				onMouseEnter={cancelClose}
				onMouseLeave={scheduleClose}
			>
				<DropdownMenuLabel>Group by</DropdownMenuLabel>

				{GROUP_BY_OPTIONS.map((opt) => (
					<DropdownMenuItem
						key={opt.value}
						onSelect={(e) => {
							e.preventDefault();
							onGroupByChange(opt.value);
						}}
					>
						{opt.label}
						{groupBy === opt.value && (
							<span className='absolute right-2 flex items-center'>
								<CircleIcon className='size-2 fill-current' />
							</span>
						)}
					</DropdownMenuItem>
				))}

				<DropdownMenuSeparator />

				<div className='relative' onMouseEnter={() => setSubOpen(true)} onMouseLeave={() => setSubOpen(false)}>
					<div
						className={cn(
							'flex w-full items-center gap-2 rounded-sm py-1 pr-2 pl-2 text-sm cursor-pointer select-none',
							subOpen
								? 'bg-accent text-accent-foreground'
								: 'hover:bg-accent hover:text-accent-foreground',
						)}
					>
						Filter
						<ChevronRight className='ml-auto size-4 text-muted-foreground' />
					</div>

					{subOpen && (
						<div className='absolute bottom-0 left-full pl-1.5 z-50'>
							<div className='w-48 bg-popover text-popover-foreground rounded-md border p-1 shadow-lg'>
								{FILTER_OPTIONS.map((opt) => (
									<DropdownMenuItem
										key={opt.value}
										onSelect={(e) => {
											e.preventDefault();
											onFilterToggle(opt.value);
										}}
									>
										{opt.label}
										{filters.includes(opt.value) && (
											<span className='absolute right-2 flex items-center'>
												<CheckIcon className='size-4' />
											</span>
										)}
									</DropdownMenuItem>
								))}
							</div>
						</div>
					)}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
