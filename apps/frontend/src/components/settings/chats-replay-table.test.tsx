// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatsReplayTable } from './chats-replay-table';

import type { ColumnDef } from '@tanstack/react-table';
import type { ProjectChatListItem } from '@nao/shared/types';

const chat: ProjectChatListItem = {
	id: 'chat-1',
	updatedAt: Date.now(),
	userId: 'user-1',
	userName: 'User',
	userRole: 'user',
	title: 'Quarterly report',
	source: 'web',
	numberOfMessages: 2,
	totalTokens: 10,
	cacheReadTokens: 0,
	totalCost: 0,
	feedbackText: '',
	downvotes: 0,
	upvotes: 0,
	toolErrorCount: 0,
	toolAvailableCount: 0,
};

const columns: ColumnDef<ProjectChatListItem>[] = [{ accessorKey: 'title', header: 'Title' }];

describe('ChatsReplayTable', () => {
	afterEach(cleanup);

	it('opens a focused row with Enter or Space', () => {
		const onRowClick = vi.fn();
		render(<TestTable onRowClick={onRowClick} />);
		const row = screen.getByLabelText('Open chat: Quarterly report');

		fireEvent.keyDown(row, { key: 'Enter' });
		fireEvent.keyDown(row, { key: ' ' });

		expect(onRowClick).toHaveBeenCalledTimes(2);
		expect(onRowClick).toHaveBeenCalledWith(chat);
		expect(row.getAttribute('tabindex')).toBe('0');
	});

	it('displays the default page size', () => {
		render(<TestTable onRowClick={vi.fn()} />);

		expect(screen.getByRole('combobox').textContent).toContain('20');
	});
});

function TestTable({ onRowClick }: { onRowClick: (chat: ProjectChatListItem) => void }) {
	const table = useReactTable({
		data: [chat],
		columns,
		getCoreRowModel: getCoreRowModel(),
		initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
	});

	return <ChatsReplayTable table={table} onRowClick={onRowClick} />;
}
