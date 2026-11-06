// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompletionInput } from './completion-input';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import type { CompletionOption, CompletionOptions } from './completion-input';

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

const NAMES = ['orders', 'order_value', 'revenue'];

afterEach(() => {
	cleanup();
});

describe('CompletionInput', () => {
	it('suggests completions for the text at the cursor once typing starts', () => {
		render(<Harness />);

		type('or');

		expect(optionLabels()).toEqual(['orders', 'order_value']);
		expect(input().getAttribute('aria-expanded')).toBe('true');
	});

	it('accepts the active completion with the keyboard', () => {
		render(<Harness />);

		type('or');
		fireEvent.keyDown(input(), { key: 'ArrowDown' });
		fireEvent.keyDown(input(), { key: 'Enter' });

		expect(input().value).toBe('order_value');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('accepts a completion on click', () => {
		render(<Harness />);

		type('rev');
		fireEvent.click(screen.getByRole('option', { name: 'revenue' }));

		expect(input().value).toBe('revenue');
	});

	it('leaves Enter alone when nothing matches', () => {
		render(<Harness />);

		type('xyz');
		const enter = fireEvent.keyDown(input(), { key: 'Enter' });

		expect(enter).toBe(true);
		expect(input().value).toBe('xyz');
	});

	it('keeps its options under the pointer inside a modal dialog', () => {
		render(
			<Dialog open>
				<DialogContent aria-describedby={undefined}>
					<DialogTitle>Edit chart</DialogTitle>
					<Harness />
				</DialogContent>
			</Dialog>,
		);

		type('or');

		const options = screen.getByRole('listbox').closest<HTMLElement>('[data-slot=popover-content]');
		expect(document.body.style.pointerEvents).toBe('none');
		expect(options?.style.pointerEvents).toBe('auto');
	});

	it('closes on Escape', () => {
		render(<Harness />);

		type('or');
		fireEvent.keyDown(input(), { key: 'Escape' });

		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('accepts several checked completions at once and keeps the draft', () => {
		const accepted: string[][] = [];
		render(<MultipleHarness onAccept={(items) => accepted.push(items.map((item) => item.insertText))} />);

		type('or');
		fireEvent.click(screen.getByRole('option', { name: 'orders' }));
		fireEvent.change(input(), { target: { value: 'rev', selectionStart: 3 } });
		fireEvent.click(screen.getByRole('option', { name: 'revenue' }));
		fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));

		expect(accepted).toEqual([['orders', 'revenue']]);
		expect(input().value).toBe('rev');
		expect(screen.queryByRole('listbox')).toBeNull();
	});
});

function Harness() {
	const [value, setValue] = useState('');
	return <CompletionInput aria-label='Metric' value={value} onValueChange={setValue} getCompletions={completeName} />;
}

function MultipleHarness({ onAccept }: { onAccept: (items: CompletionOption[]) => void }) {
	const [value, setValue] = useState('');
	return (
		<CompletionInput
			multiple
			aria-label='Metric'
			value={value}
			onValueChange={setValue}
			getCompletions={completeName}
			onAccept={onAccept}
		/>
	);
}

function completeName(value: string, cursor: number): CompletionOptions {
	const typed = value.slice(0, cursor);
	return {
		from: 0,
		to: value.length,
		items: NAMES.filter((name) => typed && name.startsWith(typed)).map((name) => ({
			label: name,
			insertText: name,
		})),
	};
}

function type(text: string) {
	fireEvent.focus(input());
	fireEvent.change(input(), { target: { value: text, selectionStart: text.length } });
}

function input(): HTMLInputElement {
	return screen.getByRole('combobox', { name: 'Metric' });
}

function optionLabels(): string[] {
	return screen.getAllByRole('option').map((option) => option.textContent ?? '');
}
