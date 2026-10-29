// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WarehouseCredentialsForm } from './warehouse-credentials-form';
import type { WarehouseCredentialsFormValues } from './warehouse-credentials';

afterEach(cleanup);

describe('WarehouseCredentialsForm', () => {
	it('submits the credentials in a single step', async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		render(
			<WarehouseCredentialsForm
				provider='motherduck'
				onSubmit={onSubmit}
				isValidating={false}
				isPending={false}
				error={null}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/Access Token/), { target: { value: 'token' } });
		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
		expect(onSubmit.mock.calls[0][0]).toMatchObject({ accessToken: 'token' });
		expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
	});

	it('locks the fields while the connection is checked', () => {
		render(
			<WarehouseCredentialsForm
				provider='motherduck'
				onSubmit={vi.fn()}
				isValidating={true}
				isPending={false}
				error={null}
			/>,
		);

		expect((screen.getByLabelText(/Access Token/).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
		expect(screen.getByRole('button', { name: /Checking connection/ })).toBeTruthy();
	});

	it('restores entered credentials after being closed', () => {
		render(<PersistedForm />);

		fireEvent.change(screen.getByLabelText(/Access Token/), { target: { value: 'saved-token' } });
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Open form' }));

		expect((screen.getByLabelText(/Access Token/) as HTMLInputElement).value).toBe('saved-token');
		expect(screen.getByText('Check Access Token.')).toBeTruthy();
	});
});

function PersistedForm() {
	const [open, setOpen] = useState(true);
	const [values, setValues] = useState<WarehouseCredentialsFormValues>();

	if (!open) {
		return (
			<button type='button' onClick={() => setOpen(true)}>
				Open form
			</button>
		);
	}
	return (
		<WarehouseCredentialsForm
			provider='motherduck'
			onSubmit={vi.fn().mockResolvedValue(undefined)}
			onCancel={() => setOpen(false)}
			isValidating={false}
			isPending={false}
			error={{ message: 'Check Access Token.' }}
			initialValues={values}
			onValuesChange={setValues}
		/>
	);
}
