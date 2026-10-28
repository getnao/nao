import { Code, Eye, SquareMousePointer } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { IconSegmentedToggleOption } from '@/components/ui/icon-segmented-toggle';
import { Button } from '@/components/ui/button';
import { IconSegmentedToggle } from '@/components/ui/icon-segmented-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type CustomStoryViewMode = 'app' | 'files';

export interface CustomStoryViewModeControls {
	viewMode: CustomStoryViewMode;
	onViewModeChange: (mode: CustomStoryViewMode) => void;
	elementSelection?: CustomStoryElementSelection;
}

export interface CustomStoryElementSelection {
	isSelecting: boolean;
	onSelectingChange: (isSelecting: boolean) => void;
}

const VIEW_MODES: readonly IconSegmentedToggleOption<CustomStoryViewMode>[] = [
	{ value: 'app', label: 'App', icon: Eye },
	{ value: 'files', label: 'Files', icon: Code },
];

export function isCustomStoryViewMode(mode: string): mode is CustomStoryViewMode {
	return VIEW_MODES.some((entry) => entry.value === mode);
}

export function CustomStoryViewModeToggle({ viewMode, onViewModeChange }: CustomStoryViewModeControls) {
	return <IconSegmentedToggle options={VIEW_MODES} value={viewMode} onValueChange={onViewModeChange} />;
}

/** Only on the app view, and only when the story's host takes questions about its elements. */
export function CustomStoryElementSelectionToggle({ viewMode, elementSelection }: CustomStoryViewModeControls) {
	if (!elementSelection || viewMode !== 'app') {
		return null;
	}
	return <ElementSelectionToggle {...elementSelection} />;
}

export function ElementSelectionToggle({ isSelecting, onSelectingChange }: CustomStoryElementSelection) {
	const label = isSelecting ? 'Stop selecting elements' : 'Select an element to ask about';
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className={cn('hover:rounded-full', isSelecting && 'rounded-full bg-accent text-primary')}
					onClick={() => onSelectingChange(!isSelecting)}
					aria-label={label}
					aria-pressed={isSelecting}
				>
					<SquareMousePointer className='size-3.5' strokeWidth={2.25} />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

interface CustomStoryViewLayersProps {
	viewMode: CustomStoryViewMode;
	app: ReactNode;
	files: ReactNode;
}

export function CustomStoryViewLayers({ viewMode, app, files }: CustomStoryViewLayersProps) {
	const [hasOpenedFiles, setHasOpenedFiles] = useState(viewMode === 'files');
	if (viewMode === 'files' && !hasOpenedFiles) {
		setHasOpenedFiles(true);
	}
	return (
		<div className='relative min-h-0 flex-1'>
			<div
				className={cn('absolute inset-0 flex flex-col', viewMode === 'files' && 'invisible')}
				aria-hidden={viewMode === 'files'}
			>
				{app}
			</div>
			{hasOpenedFiles && (
				<div
					className={cn('absolute inset-0 bg-background', viewMode !== 'files' && 'invisible')}
					aria-hidden={viewMode !== 'files'}
				>
					{files}
				</div>
			)}
		</div>
	);
}
