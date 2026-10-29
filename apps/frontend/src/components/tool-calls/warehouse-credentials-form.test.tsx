// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WarehouseCredentialsForm } from './warehouse-credentials-form';
import { getWarehouseCredentialsDefaults } from './warehouse-credentials';
import type { WarehouseCredentialsFormValues } from './warehouse-credentials';

afterEach(cleanup);

describe('WarehouseCredentialsForm', () => {
	it('validates credentials before allowing provisioning to continue', async () => {
		const onValidate = vi.fn().mockResolvedValue(undefined);
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		render(
			<WarehouseCredentialsForm
				provider='motherduck'
				onValidate={onValidate}
				onSubmit={onSubmit}
				onCancel={vi.fn()}
				isValidating={false}
				isPending={false}
				error={null}
			/>,
		);

		fireEvent.change(screen.getByLabelText(/Access Token/), { target: { value: 'token' } });
		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

		await waitFor(() => expect(onValidate).toHaveBeenCalledOnce());
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByText('Credentials OK!')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
	});

	it('restores entered and validated credentials after being closed', async () => {
		render(<PersistedForm />);

		fireEvent.change(screen.getByLabelText(/Access Token/), { target: { value: 'saved-token' } });
		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		await screen.findByText('Credentials OK!');

		fireEvent.click(screen.getByRole('button', { name: 'Close form' }));
		fireEvent.click(screen.getByRole('button', { name: 'Open form' }));

		expect((screen.getByLabelText(/Access Token/) as HTMLInputElement).value).toBe('saved-token');
		expect(screen.getByText('Check Access Token.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
	});

	it('shows credentials in a locked state', () => {
		render(
			<WarehouseCredentialsForm
				provider='motherduck'
				onValidate={vi.fn()}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
				isValidating={false}
				isPending={false}
				error={null}
				initialValues={{ ...getWarehouseCredentialsDefaults('motherduck'), accessToken: 'saved-token' }}
				locked={true}
			/>,
		);

		expect((screen.getByLabelText(/Access Token/).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
		expect(screen.getByText('Credentials are locked once the connection setup has started.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
	});
});

function PersistedForm() {
	const [open, setOpen] = useState(true);
	const [values, setValues] = useState<WarehouseCredentialsFormValues>();
	const [validatedFingerprint, setValidatedFingerprint] = useState<string | null>(null);

	return (
		<>
			<button type='button' onClick={() => setOpen((current) => !current)}>
				{open ? 'Close form' : 'Open form'}
			</button>
			{open && (
				<WarehouseCredentialsForm
					provider='motherduck'
					onValidate={vi.fn().mockResolvedValue(undefined)}
					onSubmit={vi.fn().mockResolvedValue(undefined)}
					onCancel={vi.fn()}
					isValidating={false}
					isPending={false}
					error={{ message: 'Check Access Token.' }}
					initialValues={values}
					onValuesChange={setValues}
					initialValidatedFingerprint={validatedFingerprint}
					onValidatedFingerprintChange={setValidatedFingerprint}
				/>
			)}
		</>
	);
}
