import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import type { RunBranches } from '@/components/settings/test-run-labels';
import type { TestRunResult } from '@/components/settings/test-run-types';
import type { ChangedLines, ChangedRange } from '@/lib/split-diff';
import type { SqlToken } from '@/lib/sql-highlighter';
import { AttemptSideHeader } from '@/components/settings/test-run-labels';
import { diffSplitLines } from '@/lib/split-diff';
import { formatSQL, formatSQLInAnyDialect } from '@/lib/sql-formatter';
import { tokenizeSql } from '@/lib/sql-highlighter';
import { cn } from '@/lib/utils';

/** The DuckDB dialect of the query the verification writes over the agent's query results. */
const VERIFICATION_DIALECT = 'duckdb';

type LineChange = 'removed' | 'added';

export function AttemptSql({ result }: { result: TestRunResult }) {
	const referenceSql = result.details?.referenceSql;
	if (!agentQueryOf(result) && !referenceSql) {
		return <p className='text-muted-foreground'>No SQL recorded for this answer.</p>;
	}
	return (
		<div className='grid gap-3 lg:grid-cols-2'>
			<SqlColumn title="Agent's query">
				<AgentQuery result={result} />
			</SqlColumn>
			<SqlColumn title='Reference SQL'>
				{referenceSql ? (
					<SqlCode code={formatSQLInAnyDialect(referenceSql)} />
				) : (
					<p className='text-muted-foreground'>This test has no reference SQL.</p>
				)}
			</SqlColumn>
		</div>
	);
}

/**
 * The queries of the two sides of a compared attempt, laid out the same way, with the words that differ marked like a
 * split diff. Differences of spacing or letter case alone are not marked, except inside quoted values.
 */
export function ComparedAttemptSql({
	production,
	draft,
	branches,
}: {
	production: TestRunResult | null;
	draft: TestRunResult | null;
	branches: RunBranches;
}) {
	const productionQuery = production && agentQueryOf(production);
	const draftQuery = draft && agentQueryOf(draft);
	const changedLines = productionQuery && draftQuery ? diffSplitLines(productionQuery, draftQuery) : null;
	const isSameQuery = changedLines !== null && changedLines.before.size === 0 && changedLines.after.size === 0;
	const referenceSql = (draft ?? production)?.details?.referenceSql;
	return (
		<div className='flex flex-col gap-3'>
			{isSameQuery && <p className='text-muted-foreground'>Both branches ran the same query.</p>}
			<div className='grid gap-3 lg:grid-cols-2'>
				<SqlColumn title={<AttemptSideHeader result={production} branch={branches.main} />}>
					{production && (
						<AgentQuery result={production} changedLines={changedLines?.before} lineChange='removed' />
					)}
				</SqlColumn>
				<SqlColumn title={<AttemptSideHeader result={draft} branch={branches.changes} />}>
					{draft && <AgentQuery result={draft} changedLines={changedLines?.after} lineChange='added' />}
				</SqlColumn>
			</div>
			{referenceSql && <FoldedSql label='Reference SQL' sql={formatSQLInAnyDialect(referenceSql)} />}
		</div>
	);
}

function SqlColumn({ title, children }: { title: ReactNode; children: ReactNode }) {
	return (
		<div className='flex min-w-0 flex-col gap-1.5'>
			<div className='font-medium text-foreground'>{title}</div>
			{children}
		</div>
	);
}

/** The queries the agent ran on the warehouse to answer, rather than the selection the verification made over them. */
function AgentQuery({
	result,
	changedLines,
	lineChange,
}: {
	result: TestRunResult;
	changedLines?: ChangedLines;
	lineChange?: LineChange;
}) {
	const query = agentQueryOf(result);
	if (!query) {
		return <p className='text-muted-foreground'>The agent ran no query.</p>;
	}
	return <SqlCode code={query} changedLines={changedLines} lineChange={lineChange} />;
}

function FoldedSql({ label, sql }: { label: string; sql: string }) {
	return (
		<details className='group rounded-md border border-dashed'>
			<summary className='flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-foreground'>
				<ChevronRight className='size-3 shrink-0 transition-transform group-open:rotate-90' />
				<span className='shrink-0'>{label}</span>
				<span className='min-w-0 truncate font-mono text-[11px] group-open:hidden'>{toOneLine(sql)}</span>
			</summary>
			<div className='px-2 pb-2'>
				<SqlCode code={sql} />
			</div>
		</details>
	);
}

/**
 * Formatted SQL, colored like the SQL editor, one row per line so that a changed line can be tinted and its changed
 * words highlighted.
 */
function SqlCode({
	code,
	changedLines,
	lineChange,
}: {
	code: string;
	changedLines?: ChangedLines;
	lineChange?: LineChange;
}) {
	const tokens = useQuery({ queryKey: ['sql-tokens', code], queryFn: () => tokenizeSql(code), staleTime: Infinity });
	const lines = tokens.data ?? toPlainLines(code);
	return (
		<pre className='overflow-x-auto rounded-md border bg-background py-1.5 font-mono text-[11px] leading-5'>
			{lines.map((line, index) => {
				const changedRanges = changedLines?.get(index);
				const change = changedRanges?.length ? lineChange : undefined;
				return (
					<div
						key={index}
						className={cn(
							'flex min-h-5 w-max min-w-full pr-3',
							change === 'removed' && 'bg-red-500/[0.06]',
							change === 'added' && 'bg-green-500/[0.06]',
						)}
					>
						<span
							aria-hidden
							className={cn(
								'w-5 shrink-0 text-center select-none',
								change === 'removed' && 'text-red-700 dark:text-red-400',
								change === 'added' && 'text-green-700 dark:text-green-400',
							)}
						>
							{change === 'removed' ? '−' : change === 'added' ? '+' : ''}
						</span>
						<span className='whitespace-pre'>
							{splitTokensByRanges(line, changedRanges ?? []).map((piece, pieceIndex) => (
								<span
									key={pieceIndex}
									style={piece.token.style as CSSProperties}
									className={cn(
										'text-[var(--shiki-light)] dark:text-[var(--shiki-dark)]',
										piece.isChanged && change === 'removed' && 'rounded-sm bg-red-500/30',
										piece.isChanged && change === 'added' && 'rounded-sm bg-green-500/30',
									)}
								>
									{piece.token.content}
								</span>
							))}
						</span>
					</div>
				);
			})}
		</pre>
	);
}

/**
 * The agent's queries the verification read its answer from, formatted one after the other, or the verification's own
 * selection for attempts recorded before those queries were stored.
 */
function agentQueryOf(result: TestRunResult): string | null {
	const details = result.details;
	if (!details) {
		return null;
	}
	if (details.sourceQueries.length > 0) {
		return details.sourceQueries.map((query) => formatSQLInAnyDialect(query.sql)).join('\n\n');
	}
	return details.verificationSql ? formatSQL(details.verificationSql, VERIFICATION_DIALECT) : null;
}

function splitTokensByRanges(line: SqlToken[], ranges: ChangedRange[]): { token: SqlToken; isChanged: boolean }[] {
	const pieces: { token: SqlToken; isChanged: boolean }[] = [];
	let offset = 0;
	for (const token of line) {
		const tokenEnd = offset + token.content.length;
		const cuts = [
			offset,
			...ranges.flatMap((range) => [range.start, range.end]).filter((cut) => cut > offset && cut < tokenEnd),
			tokenEnd,
		].sort((left, right) => left - right);
		for (let index = 0; index < cuts.length - 1; index++) {
			const [start, end] = [cuts[index], cuts[index + 1]];
			if (start === end) {
				continue;
			}
			pieces.push({
				token: { ...token, content: token.content.slice(start - offset, end - offset) },
				isChanged: ranges.some((range) => start >= range.start && end <= range.end),
			});
		}
		offset = tokenEnd;
	}
	return pieces;
}

function toPlainLines(code: string): SqlToken[][] {
	return code.split('\n').map((line) => [{ content: line, style: {} }]);
}

function toOneLine(sql: string): string {
	return sql.replace(/\s+/g, ' ').trim();
}
