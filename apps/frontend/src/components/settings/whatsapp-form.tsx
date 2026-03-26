import { useForm } from '@tanstack/react-form';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordField, TextField } from '@/components/ui/form-fields';

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
	const form = useForm({
		defaultValues: { accessToken: '', appSecret: '', phoneNumberId: '', verifyToken: '' },
		onSubmit: async ({ value }) => {
			await onSubmit(value);
			form.reset();
		},
	});

	return (
		<div className='flex flex-col gap-4 p-4 rounded-lg border border-primary/50 bg-muted/30'>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
				className='flex flex-col gap-4'
			>
				<div className='flex items-center justify-between'>
					<span className='text-sm font-medium text-foreground'>WhatsApp</span>
					<Button variant='ghost' size='icon-sm' type='button' onClick={onCancel}>
						<X className='size-4' />
					</Button>
				</div>

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

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' type='button' onClick={onCancel}>
						Cancel
					</Button>
					<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
						{(canSubmit: boolean) => (
							<Button size='sm' type='submit' disabled={!canSubmit || isPending}>
								{hasProjectConfig ? 'Update' : 'Save'}
							</Button>
						)}
					</form.Subscribe>
				</div>
			</form>
		</div>
	);
}
