// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptNumericKind, startColumnDrag, useColumnDropTarget } from './use-column-drag';
import type { ColumnValueKind } from '@/lib/chart-selection-summary';

describe('column drag and drop', () => {
	afterEach(() => {
		cleanup();
	});

	it('drops a numeric column on a numeric target', () => {
		const onDrop = vi.fn();
		renderDragAndDrop('revenue', 'number', onDrop);

		const dataTransfer = dragColumn();
		const isAccepted = !fireEvent.dragOver(screen.getByText('target'), { dataTransfer });
		fireEvent.drop(screen.getByText('target'), { dataTransfer });

		expect(isAccepted).toBe(true);
		expect(onDrop).toHaveBeenCalledWith('revenue');
	});

	it('refuses a text column on a numeric target', () => {
		const onDrop = vi.fn();
		renderDragAndDrop('country', 'text', onDrop);

		const dataTransfer = dragColumn();
		const isAccepted = !fireEvent.dragOver(screen.getByText('target'), { dataTransfer });
		fireEvent.drop(screen.getByText('target'), { dataTransfer });

		expect(isAccepted).toBe(false);
		expect(onDrop).not.toHaveBeenCalled();
	});
});

function renderDragAndDrop(column: string, kind: ColumnValueKind, onDrop: (column: string) => void) {
	render(
		<>
			<div draggable onDragStart={(event) => startColumnDrag(event, column, kind)}>
				source
			</div>
			<NumericTarget onDrop={onDrop} />
		</>,
	);
}

function NumericTarget({ onDrop }: { onDrop: (column: string) => void }) {
	const { dropTargetProps } = useColumnDropTarget({ onDrop, acceptsKind: acceptNumericKind });
	return <div {...dropTargetProps}>target</div>;
}

function dragColumn() {
	const dataTransfer = new FakeDataTransfer();
	fireEvent.dragStart(screen.getByText('source'), { dataTransfer });
	return dataTransfer;
}

class FakeDataTransfer {
	private readonly entries = new Map<string, string>();
	dropEffect = 'none';
	effectAllowed = 'all';

	get types() {
		return [...this.entries.keys()];
	}

	setData(type: string, value: string) {
		this.entries.set(type, value);
	}

	getData(type: string) {
		return this.entries.get(type) ?? '';
	}
}
