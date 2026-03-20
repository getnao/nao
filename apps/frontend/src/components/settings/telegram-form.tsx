import { useForm } from '@tanstack/react-form';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { PasswordField } from '@/components/ui/form-fields';

export interface TelegramFormProps {
	hasProjectConfig: boolean;
	onSubmit: (values: { botToken: string }) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
	webhookUrl: string;
}

export function TelegramForm({ hasProjectConfig, onSubmit, onCancel, isPending, webhookUrl }: TelegramFormProps) {
	const form = useForm({
		defaultValues: { botToken: '' },
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
					<span className='text-sm font-medium text-foreground'>Telegram</span>
					<Button variant='ghost' size='icon-sm' type='button' onClick={onCancel}>
						<X className='size-4' />
					</Button>
				</div>

				<div className='grid gap-3'>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						Create a bot via @BotFather on Telegram and paste the token below. The webhook will be
						registered automatically when you save.
					</p>
					{webhookUrl && <CopyableUrl label='Webhook URL' url={webhookUrl} />}
					<PasswordField
						form={form}
						name='botToken'
						label='Bot Token'
						placeholder='Enter your Telegram bot token'
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
