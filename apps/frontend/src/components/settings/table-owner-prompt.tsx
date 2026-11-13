import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Users, X } from 'lucide-react';
import { isSameContextFileOwner } from '@nao/shared/context-file-header';
import type { ContextFileOwner, ContextTableFolder } from '@nao/shared/context-file-header';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { trpc } from '@/main';

interface TableOwnerPromptProps {
	filePath: string;
	tableFolder: ContextTableFolder;
	owner: string | null;
	owners: ContextFileOwner[] | null;
	onDismiss: () => void;
}

/**
 * Once the owner of a file documenting a table changes, offers to give the other files of the table the same owner,
 * since one person usually owns the whole table.
 */
export function TableOwnerPrompt({ filePath, tableFolder, owner, owners, onDismiss }: TableOwnerPromptProps) {
	const queryClient = useQueryClient();
	const tableFileOwnersOptions = trpc.contextExplorer.listTableFileOwners.queryOptions({ path: filePath });
	const tableFiles = useQuery(tableFileOwnersOptions);
	const applyOwner = useMutation(
		trpc.contextExplorer.applyOwnerToTableFiles.mutationOptions({
			onSuccess: ({ updatedPaths }) => {
				for (const path of updatedPaths) {
					void queryClient.invalidateQueries({
						queryKey: trpc.contextExplorer.readFile.queryOptions({ path }).queryKey,
					});
				}
				void queryClient.invalidateQueries({ queryKey: tableFileOwnersOptions.queryKey });
				void queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() });
				void queryClient.invalidateQueries({
					queryKey: trpc.contextExplorer.getFileHeaderProblems.queryKey(),
				});
			},
		}),
	);
	const filesToUpdate = (tableFiles.data ?? []).filter(
		(file) => file.isEditable && !isSameContextFileOwner(file.owner, owner),
	);
	const table = <code className='font-mono'>{tableFolder.table}</code>;

	if (applyOwner.isSuccess) {
		const count = applyOwner.data.updatedPaths.length;
		return (
			<PromptBar icon={<Check className='size-3.5 shrink-0' />} onDismiss={onDismiss}>
				<span>
					Updated the owner of {formatDocCount(count)} of table {table}. Review them in Changes.
				</span>
			</PromptBar>
		);
	}
	if (filesToUpdate.length === 0) {
		return null;
	}

	const ownerName = describeOwner(owner, owners);
	const applyToTable = () => applyOwner.mutate({ path: filePath, owner });
	return (
		<PromptBar icon={<Users className='size-3.5 shrink-0' />} onDismiss={onDismiss}>
			<span className='min-w-0 flex-1'>
				{formatDocCount(filesToUpdate.length)} of table {table} {filesToUpdate.length === 1 ? 'has' : 'have'}{' '}
				{owner ? 'another owner' : 'an owner'}.{' '}
				{owner
					? `Make ${ownerName} the owner of every doc of the table?`
					: 'Remove the owner of every doc of the table?'}
				{applyOwner.isError && (
					<span role='alert' className='block text-destructive'>
						{applyOwner.error.message || 'The owner could not be applied.'}
					</span>
				)}
			</span>
			<Button
				type='button'
				size='sm'
				variant='outline'
				className='h-6 shrink-0 px-2 text-xs'
				disabled={applyOwner.isPending}
				onClick={applyToTable}
			>
				{owner ? 'Apply to every doc' : 'Remove from every doc'}
			</Button>
		</PromptBar>
	);
}

function PromptBar({ icon, onDismiss, children }: { icon: ReactNode; onDismiss: () => void; children: ReactNode }) {
	return (
		<div
			aria-label='Table owner'
			role='region'
			className='mt-2 flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground'
		>
			{icon}
			{children}
			<Button
				type='button'
				size='icon-xs'
				variant='ghost'
				aria-label='Dismiss'
				className='shrink-0'
				onClick={onDismiss}
			>
				<X />
			</Button>
		</div>
	);
}

function describeOwner(owner: string | null, owners: ContextFileOwner[] | null): string {
	const user = owners?.find((candidate) => isSameContextFileOwner(candidate.email, owner));
	return user?.name || owner || '';
}

function formatDocCount(count: number): string {
	return count === 1 ? '1 other doc' : `${count} other docs`;
}
