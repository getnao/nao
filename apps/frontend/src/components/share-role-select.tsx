import { ChevronDown } from 'lucide-react';
import type { ShareRole } from '@nao/shared/types';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export const SHARE_ROLE_LABELS: Record<ShareRole, string> = {
	viewer: 'Can view',
	editor: 'Can edit',
};

const SHARE_ROLE_DESCRIPTIONS: Record<ShareRole, string> = {
	viewer: 'See it and ask questions about it',
	editor: 'Change it from their own chats',
};

export function ShareRoleSelect({
	role,
	onChange,
	onRemove,
	disabled,
	label,
	ariaLabel,
	className,
}: {
	role: ShareRole | null;
	onChange: (role: ShareRole) => void;
	onRemove?: () => void;
	disabled?: boolean;
	label?: string;
	ariaLabel?: string;
	className?: string;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={disabled}>
				<Button
					variant='ghost-muted'
					size='sm'
					aria-label={ariaLabel}
					className={cn('h-7 shrink-0 gap-1 rounded-full px-2 text-xs font-normal', className)}
				>
					{label ?? (role ? SHARE_ROLE_LABELS[role] : 'Set role')}
					<ChevronDown className='size-3' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-60'>
				<DropdownMenuRadioGroup value={role ?? ''} onValueChange={(value) => onChange(value as ShareRole)}>
					{(Object.keys(SHARE_ROLE_LABELS) as ShareRole[]).map((option) => (
						<DropdownMenuRadioItem key={option} value={option} className='py-1.5'>
							<div className='flex flex-col gap-0.5'>
								<span className='text-xs font-medium'>{SHARE_ROLE_LABELS[option]}</span>
								<span className='text-[11px] leading-tight whitespace-nowrap text-muted-foreground'>
									{SHARE_ROLE_DESCRIPTIONS[option]}
								</span>
							</div>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{onRemove && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem variant='destructive' className='text-xs' onSelect={onRemove}>
							Remove access
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
