import { memo, useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import type { CitationPayload, ColumnLineageNode } from '@nao/shared';
import { cn } from '@/lib/utils';
import { formatSQL } from '@/lib/sql-formatter';
import { trpc } from '@/main';
import { useSidePanel } from '@/contexts/side-panel';

const HOVER_DELAY_MS = 500;
const POPOVER_MAX_HEIGHT = 400;
const VIEWPORT_PADDING = 8;

function computeTopOffset(triggerEl: HTMLElement): number {
	const rect = triggerEl.getBoundingClientRect();
	const overflow = rect.top + POPOVER_MAX_HEIGHT - window.innerHeight + VIEWPORT_PADDING;
	return overflow > 0 ? -overflow : 0;
}

export const CitationPopover = memo(
	({ value, queryId, column }: { value: string; queryId: string; column: string }) => {
		const [isOpen, setIsOpen] = useState(false);
		const hasOpened = useRef(false);
		const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const triggerRef = useRef<HTMLSpanElement>(null);
		const { open: openSidePanel } = useSidePanel();

		if (isOpen) {
			hasOpened.current = true;
		}

		const { data } = useQuery({
			...trpc.citation.get.queryOptions({ queryId, column }),
			enabled: hasOpened.current,
		});

		const topOffset = isOpen && triggerRef.current ? computeTopOffset(triggerRef.current) : 0;

		const handleMouseEnter = useCallback(() => {
			timerRef.current = setTimeout(() => setIsOpen(true), HOVER_DELAY_MS);
		}, []);

		const handleMouseLeave = useCallback(() => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			setIsOpen(false);
		}, []);

		return (
			<span
				ref={triggerRef}
				className='relative inline'
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
			>
				<span className='cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2'>
					{value}
				</span>
				{isOpen && data && (
					<PopoverContent
						topOffset={topOffset}
						data={data}
						onExpand={() => openSidePanel(<CitationSidePanel data={data} />)}
					/>
				)}
			</span>
		);
	},
);

const PopoverContent = memo(
	({ data, topOffset, onExpand }: { data: CitationPayload; topOffset: number; onExpand: () => void }) => {
		return (
			<div className='absolute left-full z-50 pl-2' style={{ top: topOffset }}>
				<div
					className={cn(
						'w-[420px] max-h-[400px] overflow-auto',
						'rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg',
						'text-xs',
					)}
				>
					<div className='space-y-3'>
						<div className='flex items-center justify-between'>
							<span className='font-medium text-muted-foreground'>SQL Query</span>
							<button
								type='button'
								onClick={onExpand}
								className='rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
							>
								<ArrowUpRight className='size-3.5' />
							</button>
						</div>
						<details className='rounded bg-muted text-[11px]'>
							<summary className='cursor-pointer select-none px-2 py-1.5 font-medium text-muted-foreground hover:text-foreground'>
								Show query
							</summary>
							<pre className='overflow-auto px-2 pb-2 font-mono whitespace-pre-wrap'>
								{data.sql_query}
							</pre>
						</details>
						<CitationSection title='Database Origin'>
							<p className='font-mono'>{data.database_id}</p>
						</CitationSection>
						{data.tables.length > 0 && (
							<CitationSection title='Main Tables'>
								<ul className='list-disc list-inside space-y-0.5 font-mono'>
									{data.tables.map((table) => (
										<li key={table.name}>{table.name}</li>
									))}
								</ul>
							</CitationSection>
						)}

						<CitationSection title='Column Lineage'>
							<LineageTree node={data.column_lineage} depth={0} />
						</CitationSection>
					</div>
				</div>
			</div>
		);
	},
);

function CitationSidePanel({ data }: { data: CitationPayload }) {
	return (
		<div className='h-full space-y-4 overflow-y-auto p-4'>
			<CitationSection title='SQL Query'>
				<pre className='overflow-x-auto rounded bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap'>
					{formatSQL(data.sql_query)}
				</pre>
			</CitationSection>

			<div>
				<p className='font-medium text-muted-foreground'>Database origin</p>
				<p className='font-mono'>{data.database_id}</p>
			</div>

			{data.tables.length > 0 && (
				<CitationSection title='Tables'>
					<div className='flex flex-wrap gap-1.5'>
						{data.tables.map((table) => (
							<span key={table.name} className='rounded bg-muted px-1.5 py-0.5 font-mono text-xs'>
								{table.name}
							</span>
						))}
					</div>
				</CitationSection>
			)}

			<CitationSection title='Column Lineage'>
				<LineageTree node={data.column_lineage} depth={0} />
			</CitationSection>
		</div>
	);
}

function CitationSection({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div>
			<div className='mb-1 font-medium text-muted-foreground'>{title}</div>
			{children}
		</div>
	);
}

function LineageTree({ node, depth }: { node: ColumnLineageNode; depth: number }) {
	const label = node.source_name ? `${node.source_name}.${node.name}` : node.name;

	return (
		<div style={{ paddingLeft: depth * 12 }}>
			<div className='font-mono'>
				{depth > 0 && <span className='text-muted-foreground mr-1'>←</span>}
				<span className={depth === 0 ? 'font-semibold' : ''}>{label}</span>
				{node.expression && <span className='ml-1 text-muted-foreground'>({node.expression})</span>}
				{node.reference_node_name && (
					<span className='ml-1 text-[10px] text-muted-foreground bg-muted px-1 rounded'>
						{node.reference_node_name}
					</span>
				)}
			</div>
			{node.sources.map((child, i) => (
				<LineageTree key={i} node={child} depth={depth + 1} />
			))}
		</div>
	);
}
