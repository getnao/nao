import { Check, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export type Visibility = 'project' | 'specific';

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
				'flex-1 flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 transition-colors cursor-pointer',
				active
					? 'border-primary bg-primary/5'
					: 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
			)}
		>
			<div className={cn('text-muted-foreground', active && 'text-primary')}>{icon}</div>
			<span className={cn('text-sm font-medium', active && 'text-primary')}>{label}</span>
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
		<div className='flex flex-col gap-2'>
			<Input
				placeholder='Search members...'
				value={search}
				onChange={(e) => onSearchChange(e.target.value)}
				className='h-8 text-sm'
			/>
			<div className='max-h-48 overflow-y-auto rounded-md border'>
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
				'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer',
				'hover:bg-muted/50',
				selected && 'bg-primary/5',
			)}
		>
			<Avatar username={name} size='sm' />
			<div className='min-w-0 flex-1'>
				<div className='text-sm font-medium truncate'>{name}</div>
				<div className='text-xs text-muted-foreground truncate'>{email}</div>
			</div>
			<div
				className={cn(
					'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
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
