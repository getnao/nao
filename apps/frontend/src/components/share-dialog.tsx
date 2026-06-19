import { Check, Globe, Link as LinkIcon, Loader2, SearchIcon, Unlink, Users } from 'lucide-react';

import type { Visibility } from '@nao/shared/types';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function ShareLoadingDialog({
	open,
	onOpenChange,
	title,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>Loading sharing settings...</DialogDescription>
				</DialogHeader>
				<div className='flex items-center justify-center py-6'>
					<Loader2 className='size-4 animate-spin text-muted-foreground' />
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function ShareErrorDialog({
	open,
	onOpenChange,
	title,
	onRetry,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	onRetry: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription className='text-destructive'>
						Failed to load sharing settings. Please try again.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Close
					</Button>
					<Button onClick={onRetry}>Retry</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function VisibilityPicker({
	visibility,
	onChange,
}: {
	visibility: Visibility;
	onChange: (v: Visibility) => void;
}) {
	return (
		<div className='flex gap-3'>
			<VisibilityOption
				active={visibility === 'project'}
				icon={<Globe className='size-5' />}
				label='Entire project'
				description='All project members'
				onClick={() => onChange('project')}
			/>
			<VisibilityOption
				active={visibility === 'specific'}
				icon={<Users className='size-5' />}
				label='Specific people'
				description='Choose who can view'
				onClick={() => onChange('specific')}
			/>
		</div>
	);
}

export function VisibilitySummary({
	visibility,
	selectedUserIds,
	itemLabel,
}: {
	visibility: Visibility;
	selectedUserIds: Set<string>;
	itemLabel: string;
}) {
	return (
		<div className='flex items-center gap-3 rounded-lg border p-3'>
			{visibility === 'project' ? (
				<>
					<div className='flex size-8 items-center justify-center rounded-full'>
						<Globe className='size-4' />
					</div>
					<div className='flex-1 min-w-0'>
						<p className='text-md font-medium'>Shared with entire project</p>
						<p className='text-xs text-muted-foreground'>All project members can view this {itemLabel}</p>
					</div>
				</>
			) : (
				<>
					<div className='flex size-8 items-center justify-center rounded-full'>
						<Users className='size-4' />
					</div>
					<div className='flex-1 min-w-0'>
						<p className='text-md font-medium'>
							Shared with {selectedUserIds.size} {selectedUserIds.size === 1 ? 'person' : 'people'}
						</p>
						<p className='text-xs text-muted-foreground'>Only selected members can view this {itemLabel}</p>
					</div>
				</>
			)}
		</div>
	);
}

export function ManageShareFooter({
	isBusy,
	hasChanges,
	isDeletePending,
	isUpdatePending,
	isCopied,
	canSave,
	onUnshare,
	onSaveAccess,
	onCopyLink,
}: {
	isBusy: boolean;
	hasChanges: boolean;
	isDeletePending: boolean;
	isUpdatePending: boolean;
	isCopied: boolean;
	canSave: boolean;
	onUnshare: () => void;
	onSaveAccess: () => void;
	onCopyLink: () => void;
}) {
	return (
		<DialogFooter className='flex-row sm:justify-between'>
			<Button
				variant='outline'
				onClick={onUnshare}
				disabled={isBusy}
				className='gap-1.5 text-destructive hover:text-destructive rounded-full'
			>
				{isDeletePending ? <Loader2 className='size-3.5 animate-spin' /> : <Unlink className='size-3.5' />}
				<span>Unshare</span>
			</Button>
			<div className='flex items-center gap-2'>
				{hasChanges && (
					<Button onClick={onSaveAccess} disabled={isBusy || !canSave} className='gap-1.5'>
						{isUpdatePending ? (
							<Loader2 className='size-3.5 animate-spin' />
						) : (
							<Check className='size-3.5' />
						)}
						<span>Save</span>
					</Button>
				)}
				<Button variant='outline' onClick={onCopyLink} className='gap-1.5 rounded-full'>
					{isCopied ? <Check className='size-3.5' /> : <LinkIcon className='size-3.5' />}
					<span>{isCopied ? 'Copied!' : 'Copy link'}</span>
				</Button>
			</div>
		</DialogFooter>
	);
}

export function VisibilityOption({
	active,
	icon,
	label,
	description,
	onClick,
}: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	description: string;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'flex-1 flex flex-col items-center gap-1.5 rounded-lg border pt-3 pb-3 shadow-xs transition-colors cursor-pointer',
				active ? 'border-primary' : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
			)}
		>
			<div className='text-foreground'>{icon}</div>
			<span className='text-md font-medium text-foreground'>{label}</span>
			<span className='text-xs text-muted-foreground'>{description}</span>
		</button>
	);
}

export function MemberPicker({
	members,
	selectedUserIds,
	isLoading,
	search,
	onSearchChange,
	onToggleUser,
}: {
	members: { id: string; name: string; email: string }[];
	selectedUserIds: Set<string>;
	isLoading: boolean;
	search: string;
	onSearchChange: (value: string) => void;
	onToggleUser: (userId: string) => void;
}) {
	return (
		<div className='flex flex-col gap-2 relative'>
			<SearchIcon className='absolute translate-x-2 translate-y-2 size-4' />
			<Input
				type='search'
				placeholder='Search members...'
				value={search}
				onChange={(e) => onSearchChange(e.target.value)}
				className='h-8 text-sm bg-panel pl-8'
			/>
			<div className='max-h-48 overflow-y-auto'>
				{isLoading ? (
					<div className='flex items-center justify-center py-6'>
						<Loader2 className='size-4 animate-spin text-muted-foreground' />
					</div>
				) : members.length === 0 ? (
					<div className='py-6 text-center text-sm text-muted-foreground'>
						{search ? 'No members found' : 'No other members in this project'}
					</div>
				) : (
					members.map((member) => (
						<MemberRow
							key={member.id}
							name={member.name}
							email={member.email}
							selected={selectedUserIds.has(member.id)}
							onClick={() => onToggleUser(member.id)}
						/>
					))
				)}
			</div>
			{selectedUserIds.size > 0 && (
				<p className='text-xs text-muted-foreground'>
					{selectedUserIds.size} {selectedUserIds.size === 1 ? 'person' : 'people'} selected
				</p>
			)}
		</div>
	);
}

export function MemberRow({
	name,
	email,
	selected,
	onClick,
}: {
	name: string;
	email: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			aria-pressed={selected}
			className={cn(
				'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors cursor-pointer',
				'hover:bg-muted/50',
			)}
		>
			<Avatar username={name} size='sm' />
			<div className='min-w-0 flex-1'>
				<div className='text-sm font-medium truncate'>{name}</div>
				<div className='text-xs text-muted-foreground truncate'>{email}</div>
			</div>
			<div
				className={cn(
					'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
					selected ? 'border-primary bg-primary text-white' : 'border-muted-foreground/30',
				)}
			>
				{selected && <Check className='size-3' />}
			</div>
		</button>
	);
}

export function hasAccessChanges(
	visibility: Visibility,
	allowedUserIds: string[],
	selectedUserIds: Set<string>,
): boolean {
	if (visibility !== 'specific') {
		return false;
	}
	const original = new Set(allowedUserIds);
	if (original.size !== selectedUserIds.size) {
		return true;
	}
	for (const id of selectedUserIds) {
		if (!original.has(id)) {
			return true;
		}
	}
	return false;
}
