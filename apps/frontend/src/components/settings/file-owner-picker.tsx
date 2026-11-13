import { useState } from 'react';
import { Check, TriangleAlert, UserRoundX } from 'lucide-react';
import type { ContextFileOwner } from '@nao/shared/context-file-header';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface FileOwnerPickerProps {
	owner: string | null;
	/** Null while the users of the project load, so an owner is not reported unknown too early. */
	owners: ContextFileOwner[] | null;
	isOwnersError: boolean;
	onRetryOwners: () => void;
	isEditable: boolean;
	onChange: (owner: string | null) => void;
}

/** The owner of a context file, shown as the user's avatar, picked among the users of the project. */
export function FileOwnerPicker({
	owner,
	owners,
	isOwnersError,
	onRetryOwners,
	isEditable,
	onChange,
}: FileOwnerPickerProps) {
	const [isOpen, setIsOpen] = useState(false);
	const ownerUser = findOwner(owners, owner);

	const selectOwner = (email: string | null) => {
		onChange(email);
		setIsOpen(false);
	};

	const display = <OwnerDisplay owner={owner} ownerUser={ownerUser} isUnknown={!!owner && !!owners && !ownerUser} />;
	if (!isEditable) {
		return <div className='flex h-7 items-center px-1.5'>{display}</div>;
	}

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				<button
					type='button'
					aria-label={owner ? `Change owner, currently ${ownerUser?.name || owner}` : 'Change owner'}
					className='flex h-7 max-w-full min-w-0 cursor-pointer items-center rounded-md px-1.5 outline-none hover:bg-accent focus-visible:bg-accent'
				>
					{display}
				</button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-72 p-0'>
				{isOwnersError ? (
					<OwnersError onRetry={onRetryOwners} />
				) : (
					<Command>
						<CommandInput placeholder='Search users…' />
						<CommandList>
							<CommandEmpty>{owners ? 'No user found.' : 'Loading users…'}</CommandEmpty>
							<CommandGroup>
								{(owners ?? []).map((user) => (
									<CommandItem
										key={user.id}
										value={`${user.name} ${user.email}`}
										onSelect={() => selectOwner(user.email)}
									>
										<Avatar username={user.name || user.email} className='size-5 text-[10px]' />
										<span className='flex min-w-0 flex-1 flex-col'>
											<span className='truncate'>{user.name}</span>
											<span className='truncate text-xs text-muted-foreground'>{user.email}</span>
										</span>
										<Check className={cn('size-4', user !== ownerUser && 'invisible')} />
									</CommandItem>
								))}
							</CommandGroup>
							{owner && (
								<CommandGroup>
									<CommandItem value='remove owner' onSelect={() => selectOwner(null)}>
										<UserRoundX className='size-4 text-muted-foreground' />
										Remove owner
									</CommandItem>
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				)}
			</PopoverContent>
		</Popover>
	);
}

function OwnersError({ onRetry }: { onRetry: () => void }) {
	return (
		<div role='alert' className='flex flex-col items-start gap-2 p-3 text-sm'>
			<span className='text-muted-foreground'>The users of this project could not be loaded.</span>
			<Button type='button' size='sm' variant='outline' onClick={onRetry}>
				Retry
			</Button>
		</div>
	);
}

function OwnerDisplay({
	owner,
	ownerUser,
	isUnknown,
}: {
	owner: string | null;
	ownerUser: ContextFileOwner | undefined;
	isUnknown: boolean;
}) {
	if (!owner) {
		return <span className='text-sm text-muted-foreground'>Empty</span>;
	}
	if (isUnknown) {
		return (
			<SimpleTooltip content='This owner is not a user of this project. Pick an existing user.'>
				<span className='flex min-w-0 items-center gap-1.5 text-sm text-amber-600 dark:text-amber-500'>
					<TriangleAlert className='size-4 shrink-0' />
					<span className='truncate'>{owner}</span>
				</span>
			</SimpleTooltip>
		);
	}
	const name = ownerUser?.name || owner;
	return (
		<span className='flex min-w-0 items-center gap-1.5 text-sm' title={ownerUser?.email ?? owner}>
			<Avatar username={name} className='size-5 shrink-0 text-[10px]' />
			<span className='truncate'>{name}</span>
		</span>
	);
}

function findOwner(owners: ContextFileOwner[] | null, owner: string | null): ContextFileOwner | undefined {
	const email = owner?.toLowerCase();
	return email ? owners?.find((user) => user.email.toLowerCase() === email) : undefined;
}
