import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { getSubmitErrorMessage, PasswordField } from '@/components/ui/form-fields';

export interface TelegramFormProps {
	hasProjectConfig: boolean;
	onSubmit: (values: { botToken: string }) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
}

export function TelegramForm({ hasProjectConfig, onSubmit, onCancel, isPending }: TelegramFormProps) {
	const [submitError, setSubmitError] = useState<string>();
	const form = useForm({
		defaultValues: { botToken: '' },
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
				<span className='text-sm font-medium text-foreground'>Telegram</span>

				<div className='grid gap-3'>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						<a
							href='https://docs.getnao.io/nao-agent/chat/telegram'
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center gap-1 underline hover:text-foreground'
						>
							See how to set up the Telegram integration
							<ExternalLink className='size-3' />
						</a>
					</p>
					<PasswordField
						form={form}
						name='botToken'
						label='Bot Token'
						placeholder='Enter your Telegram bot token'
						required
					/>
				</div>

				{submitError && <ErrorMessage message={submitError} />}

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' type='button' onClick={handleCancel}>
						Cancel
					</Button>
					<form.Subscribe selector={(state) => [state.canSubmit, state.values.botToken] as const}>
						{([canSubmit, botToken]) => (
							<Button
								size='sm'
								type='submit'
								variant='primary-gradient'
								disabled={!canSubmit || !botToken.trim() || isPending}
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
