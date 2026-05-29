import { ChevronRight } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useDroppable } from '@dnd-kit/core';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BreadcrumbNode = { id: string | null; name: string };

export function FolderBreadcrumb({ path, rootIcon }: { path: BreadcrumbNode[]; rootIcon: LucideIcon }) {
	const root = path[0];
	const rest = path.slice(1);
	const rootIsLast = rest.length === 0;

	return (
		<nav aria-label='Folder navigation' className='flex items-center gap-0.5 min-w-0'>
			<span className='shrink-0 flex items-center gap-0.5'>
				<DroppableCrumb node={root} isLast={rootIsLast} rootIcon={rootIcon} />
				{!rootIsLast && <ChevronRight className='size-4 text-muted-foreground/50 shrink-0' />}
			</span>

			{rest.length > 0 && (
				<span className='flex items-center gap-0.5 min-w-0 overflow-hidden'>
					{rest.map((node, index) => {
						const isLast = index === rest.length - 1;
						return (
							<span key={node.id} className='flex items-center gap-0.5 min-w-0'>
								{index > 0 && <ChevronRight className='size-4 text-muted-foreground/50 shrink-0' />}
								<span className={cn(!isLast && 'truncate')}>
									<DroppableCrumb node={node} isLast={isLast} rootIcon={rootIcon} />
								</span>
							</span>
						);
					})}
				</span>
			)}
		</nav>
	);
}

function DroppableCrumb({
	node,
	isLast,
	rootIcon: RootIcon,
}: {
	node: BreadcrumbNode;
	isLast: boolean;
	rootIcon: LucideIcon;
}) {
	const droppableId = node.id === null ? 'drop-folder-root' : `drop-folder-${node.id}`;
	const { setNodeRef, isOver } = useDroppable({ id: droppableId });

	const inner = (
		<span
			ref={setNodeRef}
			className={cn(
				'flex items-center rounded transition-colors',
				isOver && 'bg-primary/10 text-primary',
				isLast ? 'text-foreground' : 'text-muted-foreground hover:text-foreground cursor-pointer',
				node.id === null ? 'px-1 py-1' : '',
			)}
		>
			{node.id === null ? <RootIcon className='size-6' /> : node.name}
		</span>
	);

	if (isLast) {
		return inner;
	}

	return (
		<Link to='/stories' search={{ folderId: node.id }}>
			{inner}
		</Link>
	);
}
