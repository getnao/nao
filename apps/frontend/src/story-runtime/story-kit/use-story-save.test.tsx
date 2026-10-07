// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { replaceStorySaveStatus } from '../story-state';
import { useStorySave } from './use-story-save';

function SaveButton() {
	const { hasChanges, isSaving, error } = useStorySave();
	return (
		<span data-testid='status'>
			{hasChanges ? 'unsaved' : 'saved'}
			{isSaving && ' saving'}
			{error && ` ${error}`}
		</span>
	);
}

afterEach(cleanup);

describe('useStorySave', () => {
	it('follows the save status the host sends', () => {
		render(<SaveButton />);
		expect(screen.getByTestId('status').textContent).toBe('saved');

		act(() => replaceStorySaveStatus({ hasChanges: true, isSaving: true, error: null }));
		expect(screen.getByTestId('status').textContent).toBe('unsaved saving');

		act(() => replaceStorySaveStatus({ hasChanges: true, isSaving: false, error: 'Too large' }));
		expect(screen.getByTestId('status').textContent).toBe('unsaved Too large');
	});
});
