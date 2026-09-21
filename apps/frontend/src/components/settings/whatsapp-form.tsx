import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { getSubmitErrorMessage, PasswordField, TextField } from '@/components/ui/form-fields';

export interface WhatsappFormProps {
	hasProjectConfig: boolean;
	onSubmit: (values: {
		accessToken: string;
		appSecret: string;
		phoneNumberId: string;
		verifyToken: string;
	}) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
}

export function WhatsappForm({ hasProjectConfig, onSubmit, onCancel, isPending }: WhatsappFormProps) {
	const [submitError, setSubmitError] = useState<string>();
	const form = useForm({
		defaultValues: { accessToken: '', appSecret: '', phoneNumberId: '', verifyToken: '' },
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
				<span className='text-sm font-medium text-foreground'>WhatsApp</span>

				<div className='grid gap-3'>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						<a
							href='https://docs.getnao.io/nao-agent/chat/whatsapp'
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center gap-1 underline hover:text-foreground'
						>
							See how to set up the WhatsApp integration
							<ExternalLink className='size-3' />
						</a>
					</p>
					<PasswordField
						form={form}
						name='accessToken'
						label='Access Token'
						placeholder='Enter your WhatsApp access token'
						required
					/>
					<PasswordField
						form={form}
						name='appSecret'
						label='App Secret'
						placeholder='Enter your Meta app secret'
						required
					/>
					<TextField
						form={form}
						name='phoneNumberId'
						label='Phone Number ID'
						placeholder='Enter your WhatsApp phone number ID'
						required
					/>
					<TextField
						form={form}
						name='verifyToken'
						label='Verify Token'
						placeholder='A secret string you choose for webhook verification'
						required
					/>
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
								disabled={!canSubmit || !hasRequiredWhatsappValues(values) || isPending}
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

function hasRequiredWhatsappValues(values: {
	accessToken: string;
	appSecret: string;
	phoneNumberId: string;
	verifyToken: string;
}): boolean {
	return Boolean(
		values.accessToken.trim() &&
		values.appSecret.trim() &&
		values.phoneNumberId.trim() &&
		values.verifyToken.trim(),
	);
}
