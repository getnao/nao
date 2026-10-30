// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfluenceContextSetup, parseConfluencePages } from './confluence-context-setup';
import type { ConfluenceContextValues } from './confluence-context-setup';

afterEach(cleanup);

describe('ConfluenceContextSetup', () => {
	it('validates Confluence Cloud pages', async () => {
		const onValidate = vi.fn().mockResolvedValue(undefined);
		render(<ConfluenceHarness onValidate={onValidate} />);

		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		fireEvent.change(screen.getByLabelText('Confluence site URL'), {
			target: { value: 'https://acme.atlassian.net/wiki' },
		});
		fireEvent.change(screen.getByLabelText('Account email'), {
			target: { value: 'person@acme.com' },
		});
		fireEvent.change(screen.getByLabelText('API token'), {
			target: { value: 'atlassian-token' },
		});
		fireEvent.change(screen.getByLabelText('Page URLs or IDs'), {
			target: { value: 'https://acme.atlassian.net/wiki/pages/123/Page\n456' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Connect Confluence' }));

		await waitFor(() =>
			expect(onValidate).toHaveBeenCalledWith({
				baseUrl: 'https://acme.atlassian.net/wiki',
				email: 'person@acme.com',
				apiToken: 'atlassian-token',
				pagesText: 'https://acme.atlassian.net/wiki/pages/123/Page\n456',
			}),
		);
		expect(screen.getByText('Confluence connected · 2 pages')).toBeTruthy();
	});

	it('rejects non-cloud Confluence URLs', () => {
		render(<ConfluenceHarness onValidate={vi.fn()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		fireEvent.change(screen.getByLabelText('Confluence site URL'), {
			target: { value: 'http://confluence.internal/wiki' },
		});
		fireEvent.change(screen.getByLabelText('Account email'), {
			target: { value: 'person@acme.com' },
		});
		fireEvent.change(screen.getByLabelText('API token'), {
			target: { value: 'atlassian-token' },
		});
		fireEvent.change(screen.getByLabelText('Page URLs or IDs'), {
			target: { value: '123' },
		});

		expect(screen.getByRole('button', { name: 'Connect Confluence' }).hasAttribute('disabled')).toBe(true);
		expect(screen.getByText(/Enter a Confluence Cloud URL/)).toBeTruthy();
	});

	it('normalizes and deduplicates page entries', () => {
		expect(parseConfluencePages(' 123 \n\n456\r\n123 ')).toEqual(['123', '456']);
	});
});

function ConfluenceHarness({ onValidate }: { onValidate: (values: ConfluenceContextValues) => Promise<void> }) {
	const [values, setValues] = useState<ConfluenceContextValues>({
		baseUrl: '',
		email: '',
		apiToken: '',
		pagesText: '',
	});
	const [validatedFingerprint, setValidatedFingerprint] = useState<string | null>(null);

	return (
		<ConfluenceContextSetup
			values={values}
			validatedFingerprint={validatedFingerprint}
			validatedPages={[
				{ url: 'https://acme.atlassian.net/wiki/pages/123/Page', title: 'Page' },
				{ url: '456', title: 'Another page' },
			]}
			isValidating={false}
			isStarting={false}
			error={null}
			onValuesChange={setValues}
			onValidatedFingerprintChange={setValidatedFingerprint}
			onValidate={onValidate}
		/>
	);
}
