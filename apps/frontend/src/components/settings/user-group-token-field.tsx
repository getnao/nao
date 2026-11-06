import { ChevronDown, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface UserGroupToken {
	key: string;
	name: string;
	title?: string;
	onRemove?: () => void;
}

/** Slack-channels-style field: wrapping group tokens followed by a trigger opening the group menu. */
export function UserGroupTokenField({
	tokens,
	triggerLabel,
	placeholder,
	disabled = false,
	children,
}: {
	tokens: UserGroupToken[];
	triggerLabel: string;
	placeholder: string;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<div
				onClick={(event) => event.stopPropagation()}
				className={cn(
					'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 shadow-xs transition-[color,box-shadow]',
					'has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
					'has-[[data-state=open]]:border-ring',
					disabled && 'pointer-events-none opacity-50',
				)}
			>
				{tokens.map((token) => (
					<GroupToken key={token.key} token={token} disabled={disabled} />
				))}
				<DropdownMenuTrigger asChild>
					<button
						type='button'
						aria-label={triggerLabel}
						disabled={disabled}
						className='flex h-6 min-w-20 flex-1 cursor-pointer items-center justify-between gap-1 rounded-sm px-1 text-xs text-muted-foreground outline-none'
					>
						<span className='truncate'>{placeholder}</span>
						<ChevronDown className='size-4 shrink-0 opacity-60' />
					</button>
				</DropdownMenuTrigger>
			</div>
			{children}
		</DropdownMenu>
	);
}

function GroupToken({ token, disabled }: { token: UserGroupToken; disabled: boolean }) {
	return (
		<span
			title={token.title}
			className={cn(
				'inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border bg-muted/60 pl-1.5 text-xs text-foreground',
				token.onRemove ? 'pr-0.5' : 'pr-1.5',
			)}
		>
			<span className='truncate'>{token.name}</span>
			{token.onRemove && (
				<button
					type='button'
					onClick={token.onRemove}
					disabled={disabled}
					aria-label={`Remove group ${token.name}`}
					className='inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-70 transition-opacity hover:bg-background/60 hover:opacity-100'
				>
					<X className='size-3' />
				</button>
			)}
		</span>
	);
}
