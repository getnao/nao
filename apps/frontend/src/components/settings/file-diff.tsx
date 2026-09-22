import { Fragment, useMemo, useState } from 'react';
import { UnfoldVertical } from 'lucide-react';

import type { DiffLine } from '@/lib/line-diff';
import { cn } from '@/lib/utils';

const CONTEXT_LINES = 3;
const MIN_COLLAPSE = 2;

type DiffRow = { type: 'line'; line: DiffLine } | { type: 'gap'; lines: DiffLine[] };

export function FileDiffBody({ lines }: { lines: DiffLine[] }) {
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

function buildDiffRows(lines: DiffLine[], context: number): DiffRow[] {
	const visible = new Array<boolean>(lines.length).fill(false);
	lines.forEach((line, index) => {
		if (line.type === 'context') {
			return;
		}
		const start = Math.max(0, index - context);
		const end = Math.min(lines.length - 1, index + context);
		for (let current = start; current <= end; current++) {
			visible[current] = true;
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
