import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Github, Loader2 } from 'lucide-react';

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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { GithubRepoList } from '@/components/settings/github-repo-list';
import { setActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';

interface GitHubRepoPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function GitHubRepoPicker({ open, onOpenChange }: GitHubRepoPickerProps) {
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<string | null>(null);
	const [repoToReplace, setRepoToReplace] = useState<{ repoFullName: string; projectName: string } | null>(null);

	const projects = useQuery({
		...trpc.organization.getProjects.queryOptions(),
		enabled: open,
	});

	const createProject = useMutation(
		trpc.github.createProjectFromRepo.mutationOptions({
			onSuccess: (data) => {
				setActiveProjectId(data.projectId);
				queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.organization.getProjects.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.github.getProjectGitInfo.queryKey() });
				onOpenChange(false);
				setRepoToReplace(null);
				setSelected(null);
			},
		}),
	);

	const handleSelectRepo = (repoFullName: string) => {
		createProject.reset();
		setSelected(repoFullName === selected ? null : repoFullName);
	};

	const handleImport = () => {
		if (!selected) {
			return;
		}
		const existingProject = getExistingProjectForRepo(selected, projects.data);
		const conflictProjectName = getConflictProjectName(createProject.error?.message);
		const projectNameToReplace = existingProject?.name ?? conflictProjectName;
		if (projectNameToReplace) {
			setRepoToReplace({ repoFullName: selected, projectName: projectNameToReplace });
			return;
		}
		createProject.mutate({ repoFullName: selected });
	};

	const handleConfirmReplace = () => {
		if (!repoToReplace) {
			return;
		}
		createProject.mutate({
			repoFullName: repoToReplace.repoFullName,
			projectName: repoToReplace.projectName,
			replaceExisting: true,
		});
	};

	const selectedExistingProject = selected ? getExistingProjectForRepo(selected, projects.data) : null;
	const selectedConflictProjectName = selected ? getConflictProjectName(createProject.error?.message) : null;
	const selectedReplacementProjectName = selectedExistingProject?.name ?? selectedConflictProjectName;
	const isImportDisabled = !selected || createProject.isPending || (projects.isLoading && !projects.data);

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className='sm:max-w-lg'>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<Github className='size-5' />
							Import from GitHub
						</DialogTitle>
						<DialogDescription>Select a repository to import as a nao project.</DialogDescription>
					</DialogHeader>

					<GithubRepoList
						selected={selected}
						onSelect={handleSelectRepo}
						onSearchChange={() => createProject.reset()}
						renderRepoMeta={(repo) => {
							const existingProject = getExistingProjectForRepo(repo.full_name, projects.data);
							if (!existingProject) {
								return null;
							}
							return (
								<div className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
									Will replace existing project "{existingProject.name}".
								</div>
							);
						}}
					/>

					{createProject.error && <p className='text-sm text-destructive'>{createProject.error.message}</p>}

					<DialogFooter>
						<Button variant='outline' onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button onClick={handleImport} disabled={isImportDisabled}>
							{createProject.isPending && <Loader2 className='size-4 animate-spin' />}
							{selectedReplacementProjectName ? 'Replace project' : 'Import repository'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={!!repoToReplace} onOpenChange={(nextOpen) => !nextOpen && setRepoToReplace(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Replace existing project?</AlertDialogTitle>
						<AlertDialogDescription>
							This will replace the files for "{repoToReplace?.projectName}" with the selected GitHub
							repository. Existing chats, members, and settings stay attached to the project.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={createProject.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							onClick={handleConfirmReplace}
							disabled={createProject.isPending}
						>
							Replace project
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function getExistingProjectForRepo(
	repoFullName: string,
	projects: { name: string }[] | undefined,
): { name: string } | undefined {
	const projectName = repoFullName.split('/').pop();
	return projects?.find((project) => project.name === projectName);
}

function getConflictProjectName(message: string | undefined): string | null {
	return message?.match(/A project named "([^"]+)"/)?.[1] ?? null;
}
