import { useForm } from '@tanstack/react-form';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, PasswordField, TextField } from '@/components/ui/form-fields';

export interface SmtpFormProps {
	hasExistingConfig: boolean;
	initialValues?: {
		host: string;
		port: string;
		ssl: string;
		mailFrom: string;
	};
	onSubmit: (values: {
		host: string;
		port: string;
		ssl: string;
		mailFrom: string;
		password: string;
	}) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
	error: { message: string } | null;
}

export function SmtpForm({ hasExistingConfig, initialValues, onSubmit, onCancel, isPending, error }: SmtpFormProps) {
	const form = useForm({
		defaultValues: {
			host: initialValues?.host ?? '',
			port: initialValues?.port ?? '587',
			ssl: initialValues?.ssl === 'true',
			mailFrom: initialValues?.mailFrom ?? '',
			password: '',
		},
		onSubmit: async ({ value }) => {
			await onSubmit({
				...value,
				ssl: value.ssl ? 'true' : 'false',
			});
		},
	});

	const passwordHint = hasExistingConfig ? '(leave empty to keep current)' : undefined;

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
					<span className='text-sm font-medium text-foreground'>SMTP Configuration</span>
					<Button variant='ghost' size='icon-sm' type='button' onClick={onCancel}>
						<X className='size-4' />
					</Button>
				</div>
				<TextField
					form={form}
					name='host'
					label='SMTP Host'
					placeholder='smtp.gmail.com'
					required={!hasExistingConfig}
				/>
				<TextField
					form={form}
					name='port'
					label='Port'
					placeholder='587'
					hint='Common ports: 587 (STARTTLS), 465 (SSL)'
				/>
				<form.Field name='ssl'>
					{(field) => (
						<label className='flex items-center gap-2 text-sm cursor-pointer'>
							<input
								type='checkbox'
								checked={field.state.value}
								onChange={(e) => field.handleChange(e.target.checked)}
								className='rounded'
							/>
							<span>Use SSL/TLS</span>
							<span className='text-xs text-muted-foreground'>(enable for port 465)</span>
						</label>
					)}
				</form.Field>
				<TextField
					form={form}
					name='mailFrom'
					label='From Email'
					placeholder='noreply@example.com'
					required={!hasExistingConfig}
				/>
				<PasswordField
					form={form}
					name='password'
					label='Password'
					placeholder={hasExistingConfig ? 'Enter new password to update' : 'Enter SMTP password'}
					hint={passwordHint}
					required={!hasExistingConfig}
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
