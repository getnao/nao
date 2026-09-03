import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { getSubmitErrorMessage, PasswordField } from '@/components/ui/form-fields';
import { Input } from '@/components/ui/input';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';

export interface MattermostFormValues {
	baseUrl: string;
	botToken: string;
	interactiveButtonsEnabled: boolean;
	callbackUrl: string;
}

export interface MattermostFormProps {
	hasProjectConfig: boolean;
	initialBaseUrl: string;
	initialInteractiveButtonsEnabled: boolean;
	initialCallbackUrl: string;
	onSubmit: (values: MattermostFormValues) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
}

export function MattermostForm({
	hasProjectConfig,
	initialBaseUrl,
	initialInteractiveButtonsEnabled,
	initialCallbackUrl,
	onSubmit,
	onCancel,
	isPending,
}: MattermostFormProps) {
	const [submitError, setSubmitError] = useState<string>();
	const form = useForm({
		defaultValues: {
			baseUrl: initialBaseUrl,
			botToken: '',
			interactiveButtonsEnabled: initialInteractiveButtonsEnabled,
			callbackUrl: initialCallbackUrl,
		},
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
				onSubmit={(event) => {
					event.preventDefault();
					form.handleSubmit();
				}}
				className='flex flex-col gap-4'
			>
				<span className='text-sm font-medium text-foreground'>Mattermost</span>

				<div className='grid gap-3'>
					<p className='text-[11px] text-muted-foreground leading-relaxed'>
						<a
							href='https://docs.mattermost.com/integrations-guide/bot-accounts.html'
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center gap-1 underline hover:text-foreground'
						>
							See how to create a Mattermost bot account
							<ExternalLink className='size-3' />
						</a>
						<span> People are linked automatically using their Mattermost email.</span>
					</p>
					<form.Field
						name='baseUrl'
						validators={{
							onChange: validateRequiredMattermostUrl,
							onSubmit: validateRequiredMattermostUrl,
						}}
					>
						{(field) => (
							<div className='grid gap-2'>
								<label htmlFor='baseUrl' className='text-sm font-medium text-foreground'>
									Server URL
								</label>
								<Input
									id='baseUrl'
									name='baseUrl'
									type='url'
									placeholder='https://mattermost.example.com'
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									required
								/>
								{field.state.meta.errors.length > 0 && (
									<p className='text-xs text-destructive'>{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>
					<PasswordField
						form={form}
						name='botToken'
						label='Bot Token'
						placeholder='Enter your Mattermost bot token'
						required
					/>
					<form.Field name='interactiveButtonsEnabled'>
						{(field) => (
							<SettingsControlRow
								id='interactiveButtonsEnabled'
								label='Enable interactive buttons'
								description='Adds a Stop button while nao is answering. This requires your Mattermost server to reach nao.'
								control={
									<Switch
										id='interactiveButtonsEnabled'
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								}
							/>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values.interactiveButtonsEnabled}>
						{(interactiveButtonsEnabled) =>
							interactiveButtonsEnabled && (
								<form.Field
									name='callbackUrl'
									validators={{
										onChange: validateOptionalMattermostUrl,
										onSubmit: validateOptionalMattermostUrl,
									}}
								>
									{(field) => (
										<div className='grid gap-2'>
											<label
												htmlFor='callbackUrl'
												className='text-sm font-medium text-foreground'
											>
												Callback URL
											</label>
											<Input
												id='callbackUrl'
												name='callbackUrl'
												type='url'
												placeholder='https://nao.example.com'
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
											<p className='text-xs text-muted-foreground'>
												The address your Mattermost server uses to reach nao can differ from the
												address people use in their browser. Leave this blank unless buttons are
												not working.
											</p>
											{field.state.meta.errors.length > 0 && (
												<p className='text-xs text-destructive'>{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>
							)
						}
					</form.Subscribe>
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
								disabled={!canSubmit || !hasRequiredMattermostValues(values) || isPending}
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

function hasRequiredMattermostValues(values: MattermostFormValues): boolean {
	return Boolean(values.baseUrl.trim() && values.botToken.trim());
}

function validateRequiredMattermostUrl({ value }: { value: string }): string | undefined {
	return validateMattermostUrl(value);
}

function validateOptionalMattermostUrl({ value }: { value: string }): string | undefined {
	return validateMattermostUrl(value, false);
}

function validateMattermostUrl(value: string, required = true): string | undefined {
	if (!value && required) {
		return 'Server URL is required';
	}
	if (!value) {
		return undefined;
	}
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return 'Enter a valid HTTP or HTTPS URL';
		}
	} catch {
		return 'Enter a valid HTTP or HTTPS URL';
	}
	return undefined;
}
