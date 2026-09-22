// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectIdentifier } from './project-identifier';

const writeText = vi.fn();
const projectId = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
	writeText.mockReset();
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
});

afterEach(cleanup);

describe('ProjectIdentifier', () => {
	it('renders and copies the project ID', async () => {
		const { container } = render(<ProjectIdentifier projectId={projectId} />);

		expect(container.querySelector('code')?.textContent).toBe(projectId);

		fireEvent.click(screen.getByRole('button', { name: `Copy project ID ${projectId}` }));

		await waitFor(() => expect(writeText).toHaveBeenCalledWith(projectId));
		expect(container.querySelector('.lucide-check')).toBeTruthy();
	});
});
