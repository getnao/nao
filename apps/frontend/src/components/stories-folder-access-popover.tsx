import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { trpc } from '@/main';

type FolderAccess = inferRouterOutputs<TrpcRouter>['storyFolder']['access'];
type FolderAccessPerson = Extract<FolderAccess, { kind: 'groups' }>['people'][number];

export function FolderAccessPopover({ folderId, children }: { folderId: string; children: React.ReactNode }) {
	return (
		<Popover>
			<SimpleTooltip content='See who has access'>
				<PopoverTrigger asChild>
					<button
						type='button'
						className='flex items-center rounded-full transition-colors cursor-pointer hover:bg-accent data-[state=open]:bg-accent'
					>
						{children}
					</button>
				</PopoverTrigger>
			</SimpleTooltip>
			<PopoverContent align='start' className='w-80 p-0'>
				<div className='border-b px-3 py-2.5 text-sm font-medium'>Who has access</div>
				<FolderAccessList folderId={folderId} />
			</PopoverContent>
		</Popover>
	);
}

export function FolderAccessDialog({
	folder,
	onOpenChange,
}: {
	folder: { id: string; name: string };
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-sm gap-2'>
				<DialogHeader>
					<DialogTitle>Who has access to {folder.name}</DialogTitle>
				</DialogHeader>
				<FolderAccessList folderId={folder.id} />
			</DialogContent>
		</Dialog>
	);
}

function FolderAccessList({ folderId }: { folderId: string }) {
	const { data: access } = useQuery(trpc.storyFolder.access.queryOptions({ id: folderId }));

	if (!access) {
		return <Spinner className='mx-auto my-3' />;
	}
	if (access.kind === 'private') {
		return <p className='px-3 py-2.5 text-sm text-muted-foreground'>Only you</p>;
	}
	if (access.kind === 'project') {
		return (
			<p className='px-3 py-2.5 text-sm text-muted-foreground'>
				Everyone in the project · {access.memberCount} {access.memberCount === 1 ? 'person' : 'people'}
			</p>
		);
	}
	return (
		<ul className='max-h-80 overflow-y-auto p-1.5'>
			{access.people.map((person) => (
				<li key={person.id} className='flex items-center gap-2 rounded-md px-1.5 py-1'>
					<Avatar username={person.name} size='sm' />
					<div className='min-w-0 flex-1'>
						<div className='text-sm truncate'>{person.name}</div>
						<div className='text-xs text-muted-foreground truncate'>{person.email}</div>
					</div>
					<span className='max-w-[45%] shrink-0 text-right text-xs text-muted-foreground break-words'>
						{describeReason(person)}
					</span>
				</li>
			))}
		</ul>
	);
}

function describeReason(person: FolderAccessPerson): string {
	return [...person.groupNames, person.isAdmin && 'Admin'].filter(Boolean).join(' · ');
}
