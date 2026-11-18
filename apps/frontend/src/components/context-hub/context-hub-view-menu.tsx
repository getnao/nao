import { Ellipsis } from 'lucide-react';

import type { ContextHubView } from '@/hooks/use-context-hub-view';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const VIEW_OPTIONS: ReadonlyArray<{ value: ContextHubView; label: string; description: string }> = [
	{ value: 'docs', label: 'Doc view', description: 'Tables, docs and skills' },
	{ value: 'files', label: 'File tree', description: 'Every file, branches and tests' },
];

/** The "…" menu of the Context Hub, which switches between the doc view and the file tree without leaving the page. */
export function ContextHubViewMenu({
	view,
	isDirty,
	size = 'icon-xs',
	onSwitchView,
}: {
	view: ContextHubView;
	size?: 'icon-xs' | 'icon-sm';
	/** Switching views would drop the unsaved edits of the open file. */
	isDirty: boolean;
	onSwitchView: (view: ContextHubView) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='ghost' size={size} aria-label='Context Hub options'>
					<Ellipsis />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-60'>
				<DropdownMenuLabel>View</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={view}
					onValueChange={(value) => {
						if (value !== view) {
							onSwitchView(value as ContextHubView);
						}
					}}
				>
					{VIEW_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value} disabled={isDirty}>
							<div className='flex flex-col'>
								{option.label}
								<span className='text-xs text-muted-foreground'>{option.description}</span>
							</div>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{isDirty && (
					<p className='px-2 py-1 text-xs text-muted-foreground'>
						Save or discard your edits to switch views.
					</p>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
