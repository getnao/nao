import { useMemo } from 'react';
import { DataTableCard } from '@/components/data-table-card';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { cn } from '@/lib/utils';

interface HastNode {
	type?: string;
	tagName?: string;
	value?: string;
	children?: HastNode[];
}

export function MarkdownTable({ node, className }: { node?: HastNode; className?: string }) {
	const chatId = useOptionalAgentContext()?.chatId;
	const { columns, rows } = useMemo(() => extractTable(node), [node]);
	const data = useMemo(
		() => rows.map((cells) => Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? '']))),
		[columns, rows],
	);

	return <DataTableCard columns={columns} data={data} chatId={chatId} className={cn('-mx-3 my-4', className)} />;
}

function extractTable(node?: HastNode): { columns: string[]; rows: string[][] } {
	if (!node) {
		return { columns: [], rows: [] };
	}

	const allRows = collectRows(node);
	if (allRows.length === 0) {
		return { columns: [], rows: [] };
	}

	const [headerRow, ...bodyRows] = allRows;
	const columns = cellsOf(headerRow).map((cell) => textOf(cell).trim());
	const rows = bodyRows.map((row) => cellsOf(row).map((cell) => textOf(cell).trim()));

	return { columns, rows };
}

const collectRows = (node?: HastNode): HastNode[] => {
	const rows: HastNode[] = [];
	const walk = (current?: HastNode) => {
		for (const child of current?.children ?? []) {
			if (child.tagName === 'tr') {
				rows.push(child);
			} else {
				walk(child);
			}
		}
	};
	walk(node);
	return rows;
};

const cellsOf = (row?: HastNode): HastNode[] =>
	(row?.children ?? []).filter((child) => child.tagName === 'th' || child.tagName === 'td');

const textOf = (node?: HastNode): string => {
	if (!node) {
		return '';
	}
	if (node.type === 'text') {
		return node.value ?? '';
	}
	return (node.children ?? []).map(textOf).join('');
};
