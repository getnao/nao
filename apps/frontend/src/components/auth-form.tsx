import { useQuery } from '@tanstack/react-query';
import { trpc } from '../main';
import { MicrosoftSignInButton, useIsMicrosoftSetup } from '@/components/auth-microsoft-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import GithubIcon from '@/components/icons/github-icon.svg';
import GoogleIcon from '@/components/icons/google-icon.svg';
import NaoLogo from '@/components/icons/nao-full-logo.svg';
import { brandingAssetUrl, useBranding } from '@/hooks/use-branding';
import { handleGithubSignIn, handleGoogleSignIn } from '@/lib/auth-client';

interface AuthFormProps {
	form: any;
	title: string;
	submitText: string;
	children: React.ReactNode;
	serverError?: string;
	displaySocialProviders?: boolean;
	socialCallbackUrl?: string;
	displayEmailPasswordForm?: boolean;
	emailPasswordDisabledMessage?: string;
	footer?: React.ReactNode;
}

export function AuthForm({
	form,
	title,
	submitText,
	children,
	serverError,
	displaySocialProviders,
	socialCallbackUrl,
	displayEmailPasswordForm = true,
	emailPasswordDisabledMessage,
	footer,
}: AuthFormProps) {
	const isGoogleSetup = useQuery(trpc.authConfig.google.isSetup.queryOptions());
	const isGithubSetup = useQuery(trpc.authConfig.github.isSetup.queryOptions());
	const isMicrosoftSetup = useIsMicrosoftSetup();
	const branding = useBranding();

	const hasAnyProvider = isGoogleSetup.data || isGithubSetup.data || isMicrosoftSetup;

	return (
		<div className='mx-auto w-full max-w-md p-8 my-auto'>
			<div className='flex flex-row items-end start mb-8'>
				{branding.enabled && branding.hasLogo ? (
					<img
						src={brandingAssetUrl('logo', branding.updatedAt)}
						alt={branding.appName ?? 'Logo'}
						className='h-10 w-auto max-w-[180px] object-contain'
					/>
				) : (
					<NaoLogo className='w-20 h-auto' />
				)}
				<span className='text-muted-foreground text-sm mx-4 border-l-1 border-border h-4'></span>
				<h1 className='text-md font-semibold uppercase leading-none'>{title}</h1>
			</div>

			{displaySocialProviders && hasAnyProvider && (
				<div className='mb-6'>
					<div className='flex flex-col gap-3 mb-6'>
						{isGoogleSetup.data && (
							<Button
								type='button'
								variant='outline'
								className='w-full h-11'
								onClick={() => handleGoogleSignIn(socialCallbackUrl)}
							>
								<GoogleIcon className='w-5 h-5' />
								Continue with Google
							</Button>
						)}
						{isGithubSetup.data && (
							<Button
								type='button'
								variant='outline'
								className='w-full h-11'
								onClick={() => handleGithubSignIn(socialCallbackUrl)}
							>
								<GithubIcon className='w-5 h-5' />
								Continue with GitHub
							</Button>
						)}
						{isMicrosoftSetup && <MicrosoftSignInButton callbackUrl={socialCallbackUrl} />}
					</div>

					{displayEmailPasswordForm && (
						<div className='relative'>
							<div className='absolute inset-0 flex items-center'>
								<div className='w-full border-t' />
							</div>
							<div className='relative flex justify-center text-xs uppercase'>
								<span className='px-2 bg-background text-muted-foreground'>Or</span>
							</div>
						</div>
					)}
				</div>
			)}

			{serverError && <p className='text-red-500 text-center text-sm mb-4'>{serverError}</p>}

			{displayEmailPasswordForm ? (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className='space-y-4'
				>
					{children}

					<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
						{(canSubmit: boolean) => (
							<Button type='submit' className='w-full h-11' disabled={!canSubmit}>
								{submitText}
							</Button>
						)}
					</form.Subscribe>
				</form>
			) : (
				emailPasswordDisabledMessage && (
					<p className='text-center text-sm text-muted-foreground'>{emailPasswordDisabledMessage}</p>
				)
			)}

			{footer && <div className='mt-6 text-center text-sm text-muted-foreground'>{footer}</div>}
		</div>
	);
}

interface FormTextFieldProps {
	form: any;
	name: string;
	type?: string;
	placeholder?: string;
}

export function FormTextField({ form, name, type = 'text', placeholder }: FormTextFieldProps) {
	return (
		<form.Field
			name={name}
			validators={{
				onMount: ({ value }: { value: string }) => (!value ? 'Required' : undefined),
				onChange: ({ value }: { value: string }) => (!value ? 'Required' : undefined),
			}}
		>
			{(field: { state: { value: string }; handleChange: (v: string) => void; handleBlur: () => void }) => (
				<Input
					name={name}
					type={type}
					placeholder={placeholder}
					value={field.state.value}
					onChange={(e) => field.handleChange(e.target.value)}
					onBlur={field.handleBlur}
					className='h-12 text-base'
				/>
			)}
		</form.Field>
	);
}
