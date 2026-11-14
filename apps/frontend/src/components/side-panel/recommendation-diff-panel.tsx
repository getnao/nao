import { Link } from '@tanstack/react-router';
import { ChevronRight, FilePen, FilePlus, Library } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';

import type { LineDiff } from '@/lib/line-diff';
import { FileDiffBody } from '@/components/settings/file-diff';
import { SidePanelHeader } from '@/components/side-panel/side-panel-header';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useCanUseAdvancedContextExplorer } from '@/hooks/use-can-use-advanced-context-explorer';
import { isOpenableInContextHub, toContextHubPath } from '@/lib/context-hub-recommendations';
import { computeLineDiff } from '@/lib/line-diff';

interface ProposedEdit {
	path: string;
	kind: 'edit' | 'create';
	oldContent: string;
	newContent: string;
	targetRepo?: unknown;
}

interface RecommendationDiffPanelProps {
	recommendationId: string;
	title: string;
	edits: ProposedEdit[];
}

export function RecommendationDiffPanel({ recommendationId, title, edits }: RecommendationDiffPanelProps) {
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
						<FileDiff
							key={edit.path}
							recommendationId={recommendationId}
							edit={edit}
							diff={diff}
							onTriggerClick={handleTriggerClick}
						/>
					))}
				</Accordion>
			</div>
		</div>
	);
}

function FileDiff({
	recommendationId,
	edit,
	diff,
	onTriggerClick,
}: {
	recommendationId: string;
	edit: ProposedEdit;
	diff: LineDiff;
	onTriggerClick: (event: MouseEvent, path: string) => void;
}) {
	const isOpenable = isOpenableInContextHub(edit, useCanUseAdvancedContextExplorer());

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
				{isOpenable && <OpenInContextHubLink recommendationId={recommendationId} path={edit.path} />}
				<FileDiffBody lines={diff.lines} />
			</AccordionContent>
		</AccordionItem>
	);
}

function OpenInContextHubLink({ recommendationId, path }: { recommendationId: string; path: string }) {
	return (
		<div className='flex justify-end border-b bg-muted/30 px-3 py-1.5'>
			<Link
				to='/context-hub'
				search={{ path: toContextHubPath(path), recommendation: recommendationId }}
				className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground'
			>
				<Library className='size-3.5' />
				Open in Context Hub
			</Link>
		</div>
	);
}
