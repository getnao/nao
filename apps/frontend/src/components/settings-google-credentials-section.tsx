import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { CheckCircle, Plus, XCircle } from 'lucide-react';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { TextField, PasswordField } from '@/components/ui/form-fields';

interface GoogleConfigSectionProps {
	isAdmin: boolean;
}

export function GoogleConfigSection({ isAdmin }: GoogleConfigSectionProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

	const queryClient = useQueryClient();
	const googleSettings = useQuery(trpc.google.getSettings.queryOptions());

	const updateGoogleSettings = useMutation(
		trpc.google.updateSettings.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.google.getSettings.queryOptions());
				setIsEditing(false);
				setTestResult(null);
				form.reset();
			},
		}),
	);

	const form = useForm({
		defaultValues: {
			clientId: '',
			clientSecret: '',
			authDomains: '',
		},
		onSubmit: async ({ value }) => {
			await updateGoogleSettings.mutateAsync(value);
		},
	});

	const handleCancel = () => {
		setIsEditing(false);
		setTestResult(null);
		form.reset();
	};

	const maskCredential = (value: string) => {
		if (!value) {
			return '';
		}
		if (value.length <= 8) {
			return '••••••••';
		}
		return `${value.slice(0, 4)}••••${value.slice(-4)}`;
	};

	return (
		<div className='grid gap-4'>
			{isAdmin && !isEditing && (
				<button type='button' className='w-full text-left cursor-pointer' onClick={() => setIsEditing(true)}>
					<div className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors'>
						<div className='flex-1 grid gap-1'>
							<div className='flex items-center gap-2'>
								<span className='text-sm font-medium text-foreground'>Google OAuth</span>
								<span className='text-xs text-muted-foreground'>(Override Env)</span>
							</div>
							<div className='grid gap-0.5'>
								<span className='text-xs font-mono text-muted-foreground'>
									Client ID: {maskCredential(googleSettings.data?.clientId || '')}
								</span>
								{googleSettings.data?.authDomains && (
									<span className='text-xs text-muted-foreground'>
										Domains: {googleSettings.data.authDomains}
									</span>
								)}
							</div>
						</div>
						<span className='px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground'>
							ENV
						</span>
					</div>
				</button>
			)}

			{isAdmin && isEditing && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className='flex flex-col gap-3 p-4 rounded-lg border border-dashed border-border'
				>
					<div className='grid gap-4'>
						<TextField
							form={form}
							name='clientId'
							label='Google Client ID'
							placeholder='Your Google Client ID'
						/>
						<PasswordField
							form={form}
							name='clientSecret'
							label='Google Client Secret'
							placeholder='Your Google Client Secret'
						/>
						<TextField
							form={form}
							name='authDomains'
							label='Google Auth Domains'
							placeholder='Comma-separated domains (e.g., example.com, test.com)'
						/>
					</div>

					{testResult && (
						<div
							className={`flex items-center gap-2 p-3 rounded-md ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
						>
							{testResult.success ? <CheckCircle className='size-4' /> : <XCircle className='size-4' />}
							<span className='text-sm'>
								{testResult.success ? testResult.message : testResult.error}
							</span>
						</div>
					)}

					<div className='flex justify-end gap-2'>
						<Button variant='ghost' size='sm' onClick={handleCancel} type='button'>
							Cancel
						</Button>
						<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
							{(canSubmit: boolean) => (
								<Button size='sm' type='submit' disabled={!canSubmit || updateGoogleSettings.isPending}>
									<Plus className='size-4 mr-1' />
									Update
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>
			)}

			{!isAdmin && (
				<p className='text-sm text-muted-foreground'>Contact your admin to update Google OAuth settings.</p>
			)}
		</div>
	);
}
