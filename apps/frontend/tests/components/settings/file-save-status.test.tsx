// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileSaveStatus } from '@/components/settings/file-save-status';

describe('FileSaveStatus', () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it('says the edits are not saved and saves them from its button', () => {
		const onSave = vi.fn();
		render(<FileSaveStatus isDirty isSaving={false} savedAt={null} onSave={onSave} />);

		expect(screen.getByRole('status').textContent).toContain('Unsaved changes');
		fireEvent.click(screen.getByRole('button', { name: /Save/ }));

		expect(onSave).toHaveBeenCalledOnce();
	});

	it.each([
		{ isDirty: true, isSaving: true, expected: 'Saving…' },
		{ isDirty: false, isSaving: false, expected: '' },
	])('shows "$expected" while saving: $isSaving', ({ isDirty, isSaving, expected }) => {
		const { container } = render(
			<FileSaveStatus isDirty={isDirty} isSaving={isSaving} savedAt={null} onSave={vi.fn()} />,
		);

		expect(container.textContent).toBe(expected);
	});

	it('confirms a save for a moment', () => {
		vi.useFakeTimers();
		render(<FileSaveStatus isDirty={false} isSaving={false} savedAt={1} onSave={vi.fn()} />);

		expect(screen.getByRole('status').textContent).toBe('Saved');
		act(() => {
			vi.advanceTimersByTime(2_000);
		});

		expect(screen.queryByRole('status')).toBeNull();
	});
});
