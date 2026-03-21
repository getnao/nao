import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { trpc, trpcClient } from '@/main';

type ProjectType = 'local' | 'git';

export function AddProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const [type, setType] = useState<ProjectType>('local');
	const [name, setName] = useState('');
	const [path, setPath] = useState('');
	const [gitUrl, setGitUrl] = useState('');
	const [gitBranch, setGitBranch] = useState('');
	const [gitToken, setGitToken] = useState('');
	const queryClient = useQueryClient();

	const createProject = useMutation({
		mutationFn: async () => {
			if (type === 'local') {
				return trpcClient.project.create.mutate({ type: 'local', name, path });
			}
			return trpcClient.project.create.mutate({
				type: 'git',
				name,
				gitUrl,
				gitBranch: gitBranch || undefined,
				gitToken: gitToken || undefined,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
			queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() });
			resetAndClose();
		},
	});

	const resetAndClose = () => {
		setType('local');
		setName('');
		setPath('');
		setGitUrl('');
		setGitBranch('');
		setGitToken('');
		onOpenChange(false);
	};

	const canSubmit = name.trim() && (type === 'local' ? path.trim() : gitUrl.trim()) && !createProject.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Add Project</DialogTitle>
					<DialogDescription>Connect a local folder or a git repository.</DialogDescription>
				</DialogHeader>

				<div className='flex gap-2'>
					<TypeButton
						active={type === 'local'}
						onClick={() => setType('local')}
						icon={<FolderOpen className='size-4' />}
						label='Local Path'
					/>
					<TypeButton
						active={type === 'git'}
						onClick={() => setType('git')}
						icon={<GitBranch className='size-4' />}
						label='Git Repository'
					/>
				</div>

				<div className='flex flex-col gap-3'>
					<Field label='Name' value={name} onChange={setName} placeholder='My Project' />

					{type === 'local' ? (
						<Field label='Path' value={path} onChange={setPath} placeholder='/path/to/project' />
					) : (
						<>
							<Field
								label='Repository URL'
								value={gitUrl}
								onChange={setGitUrl}
								placeholder='https://github.com/org/repo.git'
							/>
							<Field
								label='Branch'
								value={gitBranch}
								onChange={setGitBranch}
								placeholder='main (optional)'
							/>
							<Field
								label='Access Token'
								value={gitToken}
								onChange={setGitToken}
								placeholder='ghp_... (optional, for private repos)'
								type='password'
							/>
						</>
					)}
				</div>

				{createProject.error && <p className='text-sm text-destructive'>{createProject.error.message}</p>}

				<DialogFooter>
					<Button variant='outline' onClick={resetAndClose}>
						Cancel
					</Button>
					<Button onClick={() => createProject.mutate()} disabled={!canSubmit}>
						{createProject.isPending ? 'Adding...' : 'Add Project'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function TypeButton({
	active,
	onClick,
	icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<button
			onClick={onClick}
			className={cn(
				'flex-1 flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors cursor-pointer',
				active
					? 'border-primary bg-primary/5 text-foreground'
					: 'border-border text-muted-foreground hover:border-foreground/20',
			)}
		>
			{icon}
			{label}
		</button>
	);
}

function Field({
	label,
	value,
	onChange,
	placeholder,
	type = 'text',
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: string;
}) {
	return (
		<label className='flex flex-col gap-1.5'>
			<span className='text-sm font-medium text-foreground'>{label}</span>
			<input
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className='flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
			/>
		</label>
	);
}
