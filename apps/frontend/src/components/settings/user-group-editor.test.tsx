// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConditionalRulesHelp } from './user-group-editor';

const writeText = vi.fn();

vi.mock('@/main', () => ({ trpc: {} }));

beforeEach(() => {
	writeText.mockReset();
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
});

afterEach(cleanup);

describe('ConditionalRulesHelp', () => {
	it('shows and copies an exactly escaped group snippet with a File Explorer link', async () => {
		const expected = '{% if group("Finance \\"North\\" \\\\ Ops") %}\nGroup-specific instructions...\n{% endif %}';
		const { container } = render(<ConditionalRulesHelp groupName={'Finance "North" \\ Ops'} />);

		expect(container.querySelector('code')?.textContent).toBe(expected);
		expect(screen.getByText(/project-root RULES\.md/)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Open File Explorer' }).getAttribute('href')).toBe(
			'/settings/context-explorer',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Copy conditional RULES snippet' }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
	});

	it('does not produce an invalid snippet for a blank new-group name', () => {
		const { container, rerender } = render(<ConditionalRulesHelp groupName=' ' />);

		expect(screen.getByText('Enter a group name to generate a snippet.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Copy conditional RULES snippet' })).toBeNull();

		rerender(<ConditionalRulesHelp groupName='Finance' />);
		expect(container.querySelector('code')?.textContent).toBe(
			'{% if group("Finance") %}\nGroup-specific instructions...\n{% endif %}',
		);
	});
});
