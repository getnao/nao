/* @license Enterprise */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { MEMBER_BUDGET_STEP_USD } from '@nao/shared/member-budget';
import { MAX_BUDGET_LIMIT_USD } from '@nao/shared/types';
import type { InheritedMemberBudgetSource } from '@nao/shared/member-budget';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineBadge } from '@/components/ui/inline-badge';
import { Input } from '@/components/ui/input';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { clampLimit, formatUsd, LIMIT_PRESETS_USD } from '@/lib/member-budget';
import { cn } from '@/lib/utils';

const INHERITED_SOURCE_LABELS: Record<InheritedMemberBudgetSource, { badge: string; reset: string }> = {
	group: { badge: 'Group', reset: 'Use group budget' },
	default: { badge: 'Default', reset: 'Use default' },
};

interface BudgetCellProps {
	limitUsd: number;
	inherited?: { source: InheritedMemberBudgetSource; limitUsd: number };
	isInherited?: boolean;
	onChange: (limitUsd: number | null) => void;
	className?: string;
}

export function BudgetCell({ limitUsd, inherited, isInherited = false, onChange, className }: BudgetCellProps) {
	const [isEditing, setIsEditing] = useState(false);

	return (
		<div className={cn('flex items-center gap-1 border border-border rounded-md p-1', className)}>
			{isEditing ? (
				<LimitInput
					value={limitUsd}
					autoFocus
					onChange={onChange}
					onCommit={() => setIsEditing(false)}
					className='h-6 flex-1'
				/>
			) : (
				<SimpleTooltip content='Click to edit'>
					<Button
						variant='ghost'
						size='sm'
						onClick={() => setIsEditing(true)}
						className='flex-1 justify-start h-6 px-1.5 gap-1.5 rounded-sm font-normal tabular-nums select-none'
					>
						{limitUsd > 0 ? formatUsd(limitUsd) : <span className='text-muted-foreground'>No limit</span>}
						{isInherited && inherited && (
							<InlineBadge>{INHERITED_SOURCE_LABELS[inherited.source].badge}</InlineBadge>
						)}
					</Button>
				</SimpleTooltip>
			)}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant='ghost-muted' size='icon-xs' aria-label='Pick a budget' className='rounded-sm'>
						<ChevronDown />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start' className='max-h-72 min-w-44'>
					{inherited && !isInherited && (
						<>
							<DropdownMenuItem onSelect={() => onChange(null)} className='justify-between'>
								{INHERITED_SOURCE_LABELS[inherited.source].reset}
								<span className='text-muted-foreground text-xs tabular-nums'>
									{formatUsd(inherited.limitUsd)}
								</span>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					{LIMIT_PRESETS_USD.map((preset) => (
						<DropdownMenuItem
							key={preset}
							onSelect={() => onChange(preset)}
							className={cn('tabular-nums', !isInherited && preset === limitUsd && 'font-medium')}
						>
							{preset === 0 ? 'No limit' : formatUsd(preset)}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function LimitInput({
	value,
	onChange,
	onCommit,
	autoFocus = false,
	className,
}: {
	value: number;
	onChange: (value: number) => void;
	onCommit?: () => void;
	autoFocus?: boolean;
	className?: string;
}) {
	return (
		<div className='flex flex-1 items-center gap-1'>
			<span className='text-muted-foreground text-sm'>$</span>
			<Input
				type='number'
				aria-label='Budget in USD'
				min={0}
				max={MAX_BUDGET_LIMIT_USD}
				step={MEMBER_BUDGET_STEP_USD}
				autoFocus={autoFocus}
				value={value}
				onFocus={(event) => event.target.select()}
				onChange={(event) => onChange(clampLimit(Number(event.target.value)))}
				onBlur={onCommit}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === 'Escape') {
						event.currentTarget.blur();
					}
				}}
				className={cn(
					'w-20 h-7 text-right px-2 text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
					className,
				)}
			/>
		</div>
	);
}
