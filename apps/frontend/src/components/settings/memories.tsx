import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
import {
	useMemoriesQuery,
	useMemoryMutations,
	useMemorySettingsQuery,
	useUpdateMemorySettingsMutation,
} from '@/queries/use-memories';
import { trpc } from '@/main';
import { cn } from '@/lib/utils';

export function SettingsMemories() {
	const projectMemorySettings = useQuery(trpc.project.getMemorySettings.queryOptions());
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const memorySettings = useMemorySettingsQuery();

	const updateMemorySettings = useUpdateMemorySettingsMutation();
	const { updateMutation, deleteMutation } = useMemoryMutations();

	const projectMemoryEnabled = projectMemorySettings.data?.memoryEnabled ?? true;
	const isAdmin = project.data?.userRole === 'admin';
	const userMemoryEnabled = memorySettings.data?.memoryEnabled ?? true;
	const isProjectDisabled = !projectMemoryEnabled;
	const isUserDisabled = !userMemoryEnabled;
	const canShowMemories = !isProjectDisabled && !isUserDisabled;

	const memoriesQuery = useMemoriesQuery(canShowMemories);
	const memories = memoriesQuery.data ?? [];

	const [editMemory, setEditMemory] = useState<UserMemoryRecord | null>(null);
	const [editContent, setEditContent] = useState('');
	const [deleteMemory, setDeleteMemory] = useState<UserMemoryRecord | null>(null);

	const isUserToggleDisabled = isProjectDisabled || updateMemorySettings.isPending;

	const memoryStatusMessage = useMemo((): React.ReactNode => {
		if (isProjectDisabled) {
			return (
				<>
					Memory was disabled for this project.
					{isAdmin && (
						<>
							{' '}
							You can change this in the{' '}
							<Link
								to='/settings/project/agent'
								className='underline underline-offset-2 hover:text-foreground'
							>
								project's settings.
							</Link>
						</>
					)}
				</>
			);
		}
		if (isUserDisabled) {
			return 'Memory is disabled.';
		}
		return '';
	}, [isProjectDisabled, isUserDisabled, isAdmin]);

	const handleUserToggle = (enabled: boolean) => {
		updateMemorySettings.mutate({ memoryEnabled: enabled });
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
		<>
			<SettingsCard
				title='Memory'
				titleSize='lg'
				description='Memories enables nao to learn about you and your preferences over time.'
				divide
			>
				<SettingsControlRow
					id='user-memory'
					label='Enable memory'
					description='Allow the agent to remember preferences and facts about you.'
					className={cn(isUserToggleDisabled && 'opacity-50')}
					control={
						<Switch
							id='user-memory'
							checked={userMemoryEnabled}
							onCheckedChange={handleUserToggle}
							disabled={isUserToggleDisabled}
						/>
					}
				/>
			</SettingsCard>

			<SettingsCard
				title='Saved Memories'
				description='Review and manage memory preferences and what the agent has remembered.'
				divide
			>
				{memoryStatusMessage ? (
					<div className='space-y-1'>
						<Empty>{memoryStatusMessage}</Empty>
					</div>
				) : memoriesQuery.isLoading ? (
					<div className='flex flex-col divide-y'>
						<SettingsMemorySkeleton className='pt-0' />
						<SettingsMemorySkeleton />
						<SettingsMemorySkeleton className='pb-0' />
					</div>
				) : memories.length === 0 ? (
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
							<Button
								variant='ghost'
								onClick={() => setEditMemory(null)}
								disabled={updateMutation.isPending}
							>
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
		</>
	);
}
