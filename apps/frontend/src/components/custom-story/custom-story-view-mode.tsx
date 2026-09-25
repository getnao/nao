import { Code, Eye } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type CustomStoryViewMode = 'app' | 'files';

export interface CustomStoryViewModeControls {
	viewMode: CustomStoryViewMode;
	onViewModeChange: (mode: CustomStoryViewMode) => void;
}

const VIEW_MODES = [
	{ mode: 'app', label: 'App', icon: Eye },
	{ mode: 'files', label: 'Files', icon: Code },
] as const;

export function isCustomStoryViewMode(mode: string): mode is CustomStoryViewMode {
	return VIEW_MODES.some((entry) => entry.mode === mode);
}

export function CustomStoryViewModeToggle({ viewMode, onViewModeChange }: CustomStoryViewModeControls) {
	return (
		<div className='flex items-center gap-1.5 rounded-full border p-0.5'>
			{VIEW_MODES.map(({ mode, label, icon: Icon }) => (
				<SimpleTooltip key={mode} content={label}>
					<Button
						variant='ghost'
						size='icon-xs'
						className={cn(viewMode === mode && 'bg-accent rounded-full', 'hover:rounded-full')}
						onClick={() => onViewModeChange(mode)}
						aria-label={label}
						aria-pressed={viewMode === mode}
					>
						<Icon className='size-3' strokeWidth={2.25} />
					</Button>
				</SimpleTooltip>
			))}
		</div>
	);
}

interface CustomStoryViewLayersProps {
	viewMode: CustomStoryViewMode;
	app: ReactNode;
	files: ReactNode;
}

export function CustomStoryViewLayers({ viewMode, app, files }: CustomStoryViewLayersProps) {
	return (
		<div className='relative min-h-0 flex-1'>
			<div
				className={cn('absolute inset-0 flex flex-col', viewMode === 'files' && 'invisible')}
				aria-hidden={viewMode === 'files'}
			>
				{app}
			</div>
			{viewMode === 'files' && <div className='absolute inset-0 bg-background'>{files}</div>}
		</div>
	);
}
