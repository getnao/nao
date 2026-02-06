import { Pencil, Trash2 } from 'lucide-react';
import type { SavedPrompt } from '@nao/backend/saved-prompts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SavedPromptProps {
	prompt: SavedPrompt;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	className?: string;
}

export function SavedPromptItem({ prompt, onEdit, onDelete, className }: SavedPromptProps) {
	const handleDelete = (e: React.MouseEvent) => {
		e.stopPropagation();
		onDelete(prompt.id);
	};

	const handleEdit = (e: React.MouseEvent) => {
		e.stopPropagation();
		onEdit(prompt.id);
	};

	return (
		<div
			className={cn('flex items-start gap-4 py-2 group cursor-pointer', className)}
			onClick={() => onEdit(prompt.id)}
		>
			<div className='flex-1 min-w-0'>
				<div className='flex items-center gap-2'>
					<span className='text-sm font-medium text-foreground'>{prompt.title || 'Untitled Prompt'}</span>
				</div>
				<div className='text-sm text-muted-foreground line-clamp-2'>{prompt.prompt}</div>
			</div>

			<div className='flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
				<Button variant='ghost-muted' size='icon-sm' onClick={handleEdit}>
					<Pencil />
				</Button>
				<Button variant='ghost-muted' size='icon-sm' onClick={handleDelete}>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

export function SavedPromptSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn('flex items-start gap-4 py-2', className)}>
			<div className='flex-1 min-w-0 space-y-2'>
				<Skeleton className='h-3 w-32' />
				<Skeleton className='h-3 w-full max-w-xs' />
			</div>
		</div>
	);
}
