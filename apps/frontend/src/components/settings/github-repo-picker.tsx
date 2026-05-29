import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Github, Globe, Loader2, Lock, Search } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { setActiveProjectId } from '@/lib/active-project';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { trpc } from '@/main';

interface GitHubRepoPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function GitHubRepoPicker({ open, onOpenChange }: GitHubRepoPickerProps) {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<string | null>(null);
	const [repoToReplace, setRepoToReplace] = useState<{ repoFullName: string; projectName: string } | null>(null);
	const debouncedSearch = useDebouncedValue(search, 300);

	const repos = useQuery({
		...trpc.github.listRepos.queryOptions({ page, search: debouncedSearch || undefined }),
		enabled: open,
		placeholderData: (prev) => prev,
	});
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
				setSearch('');
				setPage(1);
			},
		}),
	);

	const handleSearchChange = (value: string) => {
		createProject.reset();
		setSearch(value);
		setPage(1);
	};

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

					<div className='relative'>
						<Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
						<Input
							placeholder='Search repositories...'
							value={search}
							onChange={(e) => handleSearchChange(e.target.value)}
							className='pl-9'
						/>
					</div>

					<div className='flex flex-col gap-1 max-h-[340px] overflow-y-auto -mx-1 px-1'>
						{repos.isLoading && !repos.data ? (
							<div className='flex items-center justify-center py-8 text-muted-foreground'>
								<Loader2 className='size-5 animate-spin' />
							</div>
						) : repos.data?.repos.length === 0 ? (
							<div className='py-8 text-center text-sm text-muted-foreground'>
								{debouncedSearch ? 'No repositories found.' : 'No repositories available.'}
							</div>
						) : (
							repos.data?.repos.map((repo) => {
								const existingProject = getExistingProjectForRepo(repo.full_name, projects.data);
								return (
									<button
										key={repo.id}
										type='button'
										onClick={() => handleSelectRepo(repo.full_name)}
										className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
											selected === repo.full_name
												? 'border-primary bg-primary/5'
												: 'border-transparent hover:bg-muted/50'
										}`}
									>
										<div className='mt-0.5'>
											{repo.private ? (
												<Lock className='size-4 text-muted-foreground' />
											) : (
												<Globe className='size-4 text-muted-foreground' />
											)}
										</div>
										<div className='min-w-0 flex-1'>
											<div className='text-sm font-medium truncate'>{repo.full_name}</div>
											{repo.description && (
												<div className='text-xs text-muted-foreground truncate mt-0.5'>
													{repo.description}
												</div>
											)}
											<div className='text-xs text-muted-foreground mt-1'>
												Updated {formatRelativeDate(repo.updated_at)}
											</div>
											{existingProject && (
												<div className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
													Will replace existing project "{existingProject.name}".
												</div>
											)}
										</div>
									</button>
								);
							})
						)}
					</div>

					{repos.data && (repos.data.hasMore || page > 1) && (
						<div className='flex items-center justify-between border-t pt-3'>
							<Button
								variant='outline'
								size='sm'
								disabled={page <= 1}
								onClick={() => setPage((p) => p - 1)}
							>
								Previous
							</Button>
							<span className='text-xs text-muted-foreground'>Page {page}</span>
							<Button
								variant='outline'
								size='sm'
								disabled={!repos.data.hasMore}
								onClick={() => setPage((p) => p + 1)}
							>
								Next
							</Button>
						</div>
					)}

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

function formatRelativeDate(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) {
		return 'today';
	}
	if (diffDays === 1) {
		return 'yesterday';
	}
	if (diffDays < 30) {
		return `${diffDays} days ago`;
	}
	if (diffDays < 365) {
		const months = Math.floor(diffDays / 30);
		return `${months} month${months > 1 ? 's' : ''} ago`;
	}
	return date.toLocaleDateString();
}
