import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { UserMemoryRecord } from '@nao/backend/memory';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsMemoryItem, SettingsMemorySkeleton } from '@/components/settings/memory-item';
import { useMemoriesQuery, useMemoryMutations, useMemorySettingsQuery } from '@/queries/use-memories';
import { trpc } from '@/main';

export function SettingsMemories({ isAdmin }: { isAdmin: boolean }) {
	const projectMemorySettings = useQuery(trpc.project.getMemorySettings.queryOptions());
	const memorySettings = useMemorySettingsQuery();

	const { updateMemorySettingsMutation, updateMutation, deleteMutation } = useMemoryMutations();

	const projectMemoryEnabled = projectMemorySettings.data?.memoryEnabled ?? true;
	const userMemoryEnabled = memorySettings.data?.memoryEnabled ?? true;
	const isProjectDisabled = !projectMemoryEnabled;
	const isUserDisabled = !userMemoryEnabled;
	const canShowMemories = !isProjectDisabled && !isUserDisabled;

	const { data: memories, isLoading: isMemoriesLoading } = useMemoriesQuery(canShowMemories);

	const [editMemory, setEditMemory] = useState<UserMemoryRecord | null>(null);
	const [editContent, setEditContent] = useState('');
	const [deleteMemory, setDeleteMemory] = useState<UserMemoryRecord | null>(null);

	const isUserToggleDisabled = isProjectDisabled || updateMemorySettingsMutation.isPending;

	const memoryStatusMessage = useMemo(() => {
		if (isProjectDisabled) {
			return {
				toggle: isAdmin
					? 'Turned off for the whole project.'
					: 'An admin has turned memory off for this project.',
				empty: isAdmin
					? 'Turn on project memory in Agent → Capabilities to see and use your saved memories.'
					: 'Ask an admin to turn on project memory to see and use your saved memories.',
			};
		}
		if (isUserDisabled) {
			return {
				toggle: '',
				empty: 'Turn on memory for yourself to see and use your saved memories.',
			};
		}
		return null;
	}, [isAdmin, isProjectDisabled, isUserDisabled]);

	const handleUserToggle = (enabled: boolean) => {
		updateMemorySettingsMutation.mutate({ memoryEnabled: enabled });
	};

	const handleEditMemory = (memory: UserMemoryRecord) => {
		setEditMemory(memory);
		setEditContent(memory.content);
	};

	const handleDeleteMemory = (memory: UserMemoryRecord) => {
		setDeleteMemory(memory);
	};

	const handleSaveEdit = async () => {
		if (!editMemory) {
			return;
		}
		await updateMutation.mutateAsync({
			memoryId: editMemory.id,
			content: editContent,
		});
		setEditMemory(null);
	};

	const handleConfirmDelete = () => {
		if (!deleteMemory) {
			return;
		}
		deleteMutation.mutate({ memoryId: deleteMemory.id });
	};

	return (
		<SettingsCard
			title='Your memory'
			description='What nao remembers about you. Only you can see and manage these.'
			divide
		>
			<SettingsControlRow
				id='user-memory'
				label='Enable memory for me'
				description={
					isProjectDisabled ? memoryStatusMessage?.toggle : 'Allow nao to save and use memories about you.'
				}
				control={
					<Switch
						id='user-memory'
						checked={userMemoryEnabled}
						onCheckedChange={handleUserToggle}
						disabled={isUserToggleDisabled}
					/>
				}
			/>
			{memoryStatusMessage ? (
				<div className='space-y-1'>
					<Empty>{memoryStatusMessage.empty}</Empty>
				</div>
			) : isMemoriesLoading ? (
				<div className='flex flex-col divide-y'>
					<SettingsMemorySkeleton className='pt-0' />
					<SettingsMemorySkeleton />
					<SettingsMemorySkeleton className='pb-0' />
				</div>
			) : !memories?.length ? (
				<Empty>No memories saved yet.</Empty>
			) : (
				<div className='flex flex-col divide-y'>
					{memories.map((memory) => (
						<SettingsMemoryItem
							key={memory.id}
							memory={memory}
							className='last:pb-0 first:pt-0'
							onEdit={handleEditMemory}
							onDelete={handleDeleteMemory}
						/>
					))}
				</div>
			)}

			<Dialog open={!!editMemory} onOpenChange={() => setEditMemory(null)}>
				<DialogContent className='p-6' showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Edit memory</DialogTitle>
					</DialogHeader>
					<div className='space-y-4'>
						<Textarea
							value={editContent}
							onChange={(event) => setEditContent(event.target.value)}
							rows={4}
						/>
						{updateMutation.error?.message && <ErrorMessage message={updateMutation.error.message} />}
					</div>
					<DialogFooter>
						<Button variant='ghost' onClick={() => setEditMemory(null)} disabled={updateMutation.isPending}>
							Cancel
						</Button>
						<Button
							onClick={handleSaveEdit}
							disabled={updateMutation.isPending || editContent.trim().length === 0}
						>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={!!deleteMemory} onOpenChange={() => setDeleteMemory(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete memory?</AlertDialogTitle>
						<AlertDialogDescription>
							This memory will be removed and forgotten by the agent.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteMutation.error?.message && <ErrorMessage message={deleteMutation.error.message} />}
					<AlertDialogFooter>
						<AlertDialogCancel variant='outline' size='sm' disabled={deleteMutation.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							size='sm'
							onClick={handleConfirmDelete}
							disabled={deleteMutation.isPending}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsCard>
	);
}
