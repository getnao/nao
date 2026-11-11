import {
	BadgeCheck,
	ChevronDown,
	FileText,
	FolderArchive,
	Globe,
	Image as ImageIcon,
	NotebookText,
	PenLine,
	Stamp,
	TriangleAlert,
	X,
} from 'lucide-react';
import { useState } from 'react';
import type {
	StoryThemeGeneration,
	StoryThemeSourceKind,
	StoryThemeSourceRecord,
} from '@nao/shared/story-theme-generation';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ViewedThemeVersion {
	label: string;
	generation: StoryThemeGeneration | null;
}

export const WELL_CLASS =
	'flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm';

export const SOURCE_ICONS: Record<StoryThemeSourceKind, LucideIcon> = {
	website: Globe,
	image: ImageIcon,
	pdf: FileText,
	document: NotebookText,
	zip: FolderArchive,
	logo: Stamp,
	instructions: PenLine,
	'white-label': BadgeCheck,
};

const SOURCE_KIND_LABELS: Record<StoryThemeSourceKind, string> = {
	website: 'Website',
	image: 'Image',
	pdf: 'PDF',
	document: 'Document',
	zip: 'ZIP',
	logo: 'Logo',
	instructions: 'Instructions',
	'white-label': 'White-label',
};

/** The inputs an earlier version was generated from, shown in the wells they were dropped into, read-only. */
export function RecordedSources({ version, onLeave }: { version: ViewedThemeVersion; onLeave: () => void }) {
	const sources = version.generation?.sources ?? [];
	return (
		<div className='flex flex-col gap-2'>
			{sources.map((source, index) => (
				<RecordedSource
					key={`${source.kind}-${index}`}
					source={source}
					instructions={version.generation?.instructions}
				/>
			))}
			{sources.length === 0 && (
				<p className='rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground'>
					{version.label} was set by hand, or saved before sources were recorded.
				</p>
			)}
			<div className='flex items-center justify-between gap-3'>
				<p className='text-xs text-muted-foreground'>
					Files are not kept: their names and sizes are, so a good theme can be traced back to its inputs.
				</p>
				<Button variant='outline' className='rounded-full' onClick={onLeave}>
					Back to the latest
				</Button>
			</div>
		</div>
	);
}

function RecordedSource({ source, instructions }: { source: StoryThemeSourceRecord; instructions?: string }) {
	const Icon = SOURCE_ICONS[source.kind];
	const text = source.kind === 'instructions' ? (instructions ?? source.name) : source.name;
	return (
		<div className={cn(WELL_CLASS, 'items-start border-solid')}>
			<span className='flex size-10 shrink-0 items-center justify-center'>
				<Icon className='size-4 text-muted-foreground' />
			</span>
			<div className='min-w-0 flex-1 py-1'>
				<p
					className={cn(source.kind === 'instructions' ? 'whitespace-pre-wrap break-words' : 'truncate')}
					title={text}
				>
					{text}
				</p>
				<p className='truncate text-xs text-muted-foreground'>
					{[SOURCE_KIND_LABELS[source.kind], source.detail].filter(Boolean).join(' · ')}
				</p>
			</div>
		</div>
	);
}

interface GenerationSummaryProps {
	sentence: string;
	generation: StoryThemeGeneration | null;
	onDismiss?: () => void;
}

/** The bottom line of the card, with a chevron unfolding what the generation kept and why. */
export function GenerationSummary({ sentence, generation, onDismiss }: GenerationSummaryProps) {
	const [expanded, setExpanded] = useState(false);
	const hasDetails = Boolean(generation && (generation.rationale || generation.notes.length > 0));

	return (
		<div className='-mx-4 mt-4 border-t bg-muted/40 px-4 py-3'>
			<div className='flex items-start gap-2'>
				<p className='min-w-0 flex-1 text-sm'>{sentence}</p>
				{hasDetails && (
					<Button
						variant='ghost'
						size='icon'
						className='-mt-1 size-7 shrink-0'
						onClick={() => setExpanded((current) => !current)}
						aria-expanded={expanded}
						aria-label={expanded ? 'Hide what the generation kept' : 'Show what the generation kept'}
					>
						<ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
					</Button>
				)}
				{onDismiss && (
					<Button
						variant='ghost'
						size='icon'
						className='-mr-1 -mt-1 size-7 shrink-0'
						onClick={onDismiss}
						aria-label='Dismiss'
					>
						<X className='size-3.5' />
					</Button>
				)}
			</div>
			{generation?.alert && (
				<p className='mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400'>
					<TriangleAlert className='mt-px size-3.5 shrink-0' />
					{generation.alert}
				</p>
			)}
			{expanded && generation && <GenerationDetails generation={generation} />}
		</div>
	);
}

function GenerationDetails({ generation }: { generation: StoryThemeGeneration }) {
	return (
		<div className='mt-2 flex flex-col gap-2 text-xs text-muted-foreground'>
			{generation.rationale && <p className='text-foreground'>{generation.rationale}</p>}
			{generation.notes.length > 0 && (
				<ul className='list-disc space-y-1 pl-4'>
					{generation.notes.map((note, index) => (
						<li key={index}>{note}</li>
					))}
				</ul>
			)}
			{generation.editedByHand && <p>Settings were then edited by hand before saving.</p>}
		</div>
	);
}
