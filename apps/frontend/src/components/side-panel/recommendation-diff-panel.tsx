import { ChevronRight, FilePen, FilePlus, UnfoldVertical } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';

import type { DiffLine, LineDiff } from '@/lib/line-diff';
import { SidePanelHeader } from '@/components/side-panel/side-panel-header';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { computeLineDiff } from '@/lib/line-diff';
import { cn } from '@/lib/utils';

interface ProposedEdit {
	path: string;
	kind: 'edit' | 'create';
	oldContent: string;
	newContent: string;
}

interface RecommendationDiffPanelProps {
	title: string;
	edits: ProposedEdit[];
}

export function RecommendationDiffPanel({ title, edits }: RecommendationDiffPanelProps) {
	const diffs = useMemo(
		() => edits.map((edit) => ({ edit, diff: computeLineDiff(edit.oldContent, edit.newContent) })),
		[edits],
	);

	const allPaths = useMemo(() => edits.map((edit) => edit.path), [edits]);
	const [openPaths, setOpenPaths] = useState<string[]>(() => (edits.length > 0 ? [edits[0].path] : []));

	const handleTriggerClick = (event: MouseEvent, path: string) => {
		if (!event.altKey) {
			return;
		}
		event.preventDefault();
		const isOpen = openPaths.includes(path);
		setOpenPaths(isOpen ? [] : allPaths);
	};

	return (
		<div className='flex h-full min-h-0 flex-col bg-background'>
			<SidePanelHeader label='Proposed changes' title={title} />

			<div className='min-h-0 flex-1 overflow-auto p-4'>
				<Accordion
					type='multiple'
					value={openPaths}
					onValueChange={setOpenPaths}
					className='flex flex-col gap-2'
				>
					{diffs.map(({ edit, diff }) => (
						<FileDiff key={edit.path} edit={edit} diff={diff} onTriggerClick={handleTriggerClick} />
					))}
				</Accordion>
			</div>
		</div>
	);
}

function FileDiff({
	edit,
	diff,
	onTriggerClick,
}: {
	edit: ProposedEdit;
	diff: LineDiff;
	onTriggerClick: (event: MouseEvent, path: string) => void;
}) {
	return (
		<AccordionItem value={edit.path} className='overflow-hidden rounded-lg border last:border-b'>
			<AccordionTrigger
				onClick={(event) => onTriggerClick(event, edit.path)}
				className='group items-center gap-2 px-3 py-2 hover:no-underline data-[state=open]:border-b data-[state=open]:rounded-b-none'
			>
				<ChevronRight className='size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90' />
				{edit.kind === 'create' ? (
					<FilePlus className='size-3.5 shrink-0 text-emerald-500' />
				) : (
					<FilePen className='size-3.5 shrink-0 text-amber-500' />
				)}
				<span className='min-w-0 flex-1 truncate font-mono text-xs' title={edit.path}>
					{edit.path}
				</span>
				<span className='shrink-0 font-mono text-[11px] text-emerald-600 dark:text-emerald-400'>
					+{diff.additions}
				</span>
				<span className='shrink-0 font-mono text-[11px] text-red-600 dark:text-red-400'>-{diff.deletions}</span>
			</AccordionTrigger>
			<AccordionContent className='p-0'>
				<DiffBody lines={diff.lines} />
			</AccordionContent>
		</AccordionItem>
	);
}

/** Unchanged lines kept around each change so the surrounding context stays visible. */
const CONTEXT_LINES = 3;
/** Shorter unchanged runs are shown inline rather than collapsed behind an expander. */
const MIN_COLLAPSE = 2;

type DiffRow = { type: 'line'; line: DiffLine } | { type: 'gap'; lines: DiffLine[] };

function DiffBody({ lines }: { lines: DiffLine[] }) {
	const rows = useMemo(() => buildDiffRows(lines, CONTEXT_LINES), [lines]);
	const [expandedGaps, setExpandedGaps] = useState<Set<number>>(() => new Set());

	const expandGap = (index: number) => setExpandedGaps((current) => new Set(current).add(index));

	return (
		<div className='overflow-x-auto font-mono text-xs leading-relaxed'>
			{rows.map((row, index) => {
				if (row.type === 'line') {
					return <DiffLineRow key={index} line={row.line} />;
				}
				if (expandedGaps.has(index)) {
					return (
						<Fragment key={index}>
							{row.lines.map((line, lineIndex) => (
								<DiffLineRow key={lineIndex} line={line} />
							))}
						</Fragment>
					);
				}
				return (
					<button
						key={index}
						type='button'
						onClick={() => expandGap(index)}
						className='flex w-full select-none items-center gap-2 border-y bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/70'
					>
						<UnfoldVertical className='size-3.5 shrink-0' />
						<span>
							Show {row.lines.length} unchanged {row.lines.length === 1 ? 'line' : 'lines'}
						</span>
					</button>
				);
			})}
		</div>
	);
}

function DiffLineRow({ line }: { line: DiffLine }) {
	return (
		<div
			className={cn(
				'flex',
				line.type === 'add' && 'bg-emerald-500/10',
				line.type === 'remove' && 'bg-red-500/10',
			)}
		>
			<span className='w-9 shrink-0 select-none px-1 text-right text-muted-foreground/50'>
				{line.oldNumber ?? ''}
			</span>
			<span className='w-9 shrink-0 select-none px-1 text-right text-muted-foreground/50'>
				{line.newNumber ?? ''}
			</span>
			<span
				className={cn(
					'w-4 shrink-0 select-none text-center',
					line.type === 'add' && 'text-emerald-600 dark:text-emerald-400',
					line.type === 'remove' && 'text-red-600 dark:text-red-400',
				)}
			>
				{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ''}
			</span>
			<span className='flex-1 whitespace-pre-wrap break-words pr-3'>{line.text || ' '}</span>
		</div>
	);
}

/** Collapse long runs of unchanged lines, keeping `context` lines around every change. */
function buildDiffRows(lines: DiffLine[], context: number): DiffRow[] {
	const visible = new Array<boolean>(lines.length).fill(false);
	lines.forEach((line, index) => {
		if (line.type === 'context') {
			return;
		}
		const start = Math.max(0, index - context);
		const end = Math.min(lines.length - 1, index + context);
		for (let k = start; k <= end; k++) {
			visible[k] = true;
		}
	});

	const rows: DiffRow[] = [];
	let hidden: DiffLine[] = [];
	const flushHidden = () => {
		if (hidden.length === 0) {
			return;
		}
		if (hidden.length < MIN_COLLAPSE) {
			hidden.forEach((line) => rows.push({ type: 'line', line }));
		} else {
			rows.push({ type: 'gap', lines: hidden });
		}
		hidden = [];
	};

	lines.forEach((line, index) => {
		if (visible[index]) {
			flushHidden();
			rows.push({ type: 'line', line });
		} else {
			hidden.push(line);
		}
	});
	flushHidden();
	return rows;
}
