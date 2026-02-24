import { useForm } from '@tanstack/react-form';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, PasswordField, TextField } from '@/components/ui/form-fields';

export interface GoogleFormProps {
	hasExistingCredentials: boolean;
	initialAuthDomains: string;
	onSubmit: (values: { clientId: string; clientSecret: string; authDomains: string }) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
	error: { message: string } | null;
}

export function GoogleForm({
	hasExistingCredentials,
	initialAuthDomains,
	onSubmit,
	onCancel,
	isPending,
	error,
}: GoogleFormProps) {
	const form = useForm({
		defaultValues: {
			clientId: '',
			clientSecret: '',
			authDomains: initialAuthDomains,
		},
		onSubmit: async ({ value }) => {
			await onSubmit(value);
		},
	});

	const clientIdHint = hasExistingCredentials ? '(leave empty to keep current)' : undefined;
	const clientSecretHint = hasExistingCredentials ? '(leave empty to keep current)' : undefined;

	return (
		<div className='flex flex-col gap-3 p-4 rounded-lg border border-primary/50 bg-muted/30'>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
				className='flex flex-col gap-3'
			>
				<div className='flex items-center justify-between'>
					<span className='text-sm font-medium text-foreground'>Google OAuth</span>
					<Button variant='ghost' size='icon-sm' type='button' onClick={onCancel}>
						<X className='size-4' />
					</Button>
				</div>
				<TextField
					form={form}
					name='clientId'
					label='Client ID'
					placeholder={
						hasExistingCredentials ? 'Enter new Client ID to update' : 'Enter your Google Client ID'
					}
					hint={clientIdHint}
					required={!hasExistingCredentials}
				/>
				<PasswordField
					form={form}
					name='clientSecret'
					label='Client Secret'
					placeholder={
						hasExistingCredentials ? 'Enter new Client Secret to update' : 'Enter your Google Client Secret'
					}
					hint={clientSecretHint}
					required={!hasExistingCredentials}
				/>
				<TextField
					form={form}
					name='authDomains'
					label='Auth Domains'
					hint='(optional, comma-separated)'
					placeholder='example.com, company.org'
				/>
				{error && <FormError error={error.message} />}
				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' type='button' onClick={onCancel}>
						Cancel
					</Button>
					<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
						{(canSubmit: boolean) => (
							<Button size='sm' type='submit' disabled={!canSubmit || isPending}>
								{isPending ? 'Saving…' : 'Save'}
							</Button>
						)}
					</form.Subscribe>
				</div>
			</form>
		</div>
	);
}
