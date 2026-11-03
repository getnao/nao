import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { getSubmitErrorMessage, TextareaField, TextField } from '@/components/ui/form-fields';

export interface GoogleChatFormValues {
	serviceAccountKey: string;
	googleCloudProjectNumber: string;
}

export interface GoogleChatFormProps {
	hasProjectConfig: boolean;
	initialProjectNumber: string;
	onSubmit: (values: GoogleChatFormValues) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
}

export function GoogleChatForm({
	hasProjectConfig,
	initialProjectNumber,
	onSubmit,
	onCancel,
	isPending,
}: GoogleChatFormProps) {
	const [submitError, setSubmitError] = useState<string>();
	const form = useForm({
		defaultValues: { serviceAccountKey: '', googleCloudProjectNumber: initialProjectNumber },
		onSubmit: async ({ value }) => {
			setSubmitError(undefined);
			try {
				await onSubmit(value);
				form.reset();
			} catch (error) {
				setSubmitError(getSubmitErrorMessage(error, 'Failed to save integration.'));
			}
		},
	});

	const handleCancel = () => {
		setSubmitError(undefined);
		onCancel();
	};

	return (
		<div className='flex flex-col gap-4 p-4 rounded-xl border border-border bg-background'>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
				className='flex flex-col gap-4'
			>
				<span className='text-sm font-medium text-foreground'>Google Chat</span>

				<div className='grid gap-3'>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						Create a service account in your Google Cloud project, enable the Google Chat API and set the
						app connection to the HTTP endpoint URL shown once the integration is saved.{' '}
						<a
							href='https://developers.google.com/workspace/chat/configure-chat-api'
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center gap-1 underline hover:text-foreground'
						>
							Configure the Google Chat API
							<ExternalLink className='size-3' />
						</a>
					</p>
					<TextareaField
						form={form}
						name='serviceAccountKey'
						label='Service account JSON key'
						placeholder='{ "type": "service_account", "client_email": "...", "private_key": "..." }'
						rows={6}
						required
					/>
					<TextField
						form={form}
						name='googleCloudProjectNumber'
						label='Google Cloud project number'
						hint='(optional)'
						placeholder='123456789012'
					/>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						Required when the Chat app authentication audience is set to the project number, or when the app
						is built as a Google Workspace add-on.
					</p>
				</div>

				{submitError && <ErrorMessage message={submitError} />}

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' type='button' onClick={handleCancel}>
						Cancel
					</Button>
					<form.Subscribe selector={(state) => [state.canSubmit, state.values] as const}>
						{([canSubmit, values]) => (
							<Button
								size='sm'
								type='submit'
								variant='primary-gradient'
								disabled={!canSubmit || !values.serviceAccountKey.trim() || isPending}
							>
								{hasProjectConfig ? 'Update' : 'Save'}
							</Button>
						)}
					</form.Subscribe>
				</div>
			</form>
		</div>
	);
}
