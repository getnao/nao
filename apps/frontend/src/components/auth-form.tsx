import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { trpc } from '../main';
import { InputGroup } from './ui/input-group';
import { NakedInput } from '@/components/ui/input';
import { MicrosoftSignInButton, useIsMicrosoftSetup } from '@/components/auth-microsoft-button';
import { OidcSignInButton } from '@/components/auth-oidc-button';
import { Button, ChatButton, AuthSocialButton } from '@/components/ui/button';
import GithubIcon from '@/components/icons/github-icon.svg';
import GoogleIcon from '@/components/icons/google-icon.svg';
import NaoLogo from '@/components/icons/nao-full-logo.svg';
import { brandingAssetUrl, useBranding } from '@/hooks/use-branding';
import { handleGithubSignIn, handleGoogleSignIn } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

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
	const oidcConfig = useQuery(trpc.authConfig.oidc.getConfig.queryOptions());
	const branding = useBranding();

	const socialProviders: Array<(className?: string) => React.ReactNode> = [
		isGoogleSetup.data &&
			((className?: string) => (
				<AuthSocialButton
					key='google'
					icon={GoogleIcon}
					label='Continue with Google'
					onClick={() => handleGoogleSignIn(socialCallbackUrl)}
					className={className}
				/>
			)),
		isGithubSetup.data &&
			((className?: string) => (
				<AuthSocialButton
					key='github'
					icon={GithubIcon}
					label='Continue with GitHub'
					onClick={() => handleGithubSignIn(socialCallbackUrl)}
					className={className}
				/>
			)),
		isMicrosoftSetup &&
			((className?: string) => (
				<MicrosoftSignInButton key='microsoft' callbackUrl={socialCallbackUrl} className={className} />
			)),
		oidcConfig.data &&
			((className?: string) => (
				<OidcSignInButton
					key='oidc'
					providerId={oidcConfig.data!.providerId}
					providerName={oidcConfig.data!.providerName}
					callbackUrl={socialCallbackUrl}
					className={className}
				/>
			)),
	].filter(Boolean) as Array<(className?: string) => React.ReactNode>;

	const hasAnyProvider = socialProviders.length > 0;

	return (
		<div className='flex min-h-screen w-full'>
			<div className='flex w-full items-center justify-center lg:w-1/2'>
				<div className='mx-auto w-full max-w-md p-8 my-auto gap-4'>
					<div className='flex flex-col items-center start mb-10 pb-2 gap-8'>
						{branding.enabled && branding.hasLogo ? (
							<img
								src={brandingAssetUrl('logo', branding.updatedAt)}
								alt={branding.appName ?? 'Logo'}
								className='h-10 w-auto max-w-[180px] object-contain'
							/>
						) : (
							<NaoLogo className='w-20 h-auto text-foreground' />
						)}
						<h1 className='font-borna text-2xl font-medium text-center'>{title}</h1>
					</div>

					{displaySocialProviders && hasAnyProvider && (
						<div className='mb-6'>
							<div
								className={cn(
									'grid justify-center gap-3 mb-6',
									socialProviders.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
								)}
							>
								{socialProviders.map((renderProvider, index) => {
									const isLonelyLast =
										socialProviders.length > 1 &&
										socialProviders.length % 2 === 1 &&
										index === socialProviders.length - 1;
									return renderProvider(
										isLonelyLast
											? 'col-span-2 w-[calc(50%-0.375rem)] justify-self-center'
											: undefined,
									);
								})}
							</div>

							{displayEmailPasswordForm && (
								<div className='relative'>
									<div className='absolute inset-0 flex items-center'>
										<div className='w-full border-t' />
									</div>
									<div className='relative flex justify-center text-xs uppercase'>
										<span className='px-2 bg-background text-foreground font-medium'>Or</span>
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
						>
							{children}

							<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
								{(canSubmit: boolean) => (
									<Button
										type='submit'
										variant={canSubmit ? 'primary-gradient' : 'default'}
										className={`w-full h-11 rounded-full ${canSubmit ? '' : 'bg-muted-foreground/20 text-secondary-foreground'}`}
										disabled={!canSubmit}
									>
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

					{footer && <div className='mt-6 text-center text-xs text-foreground font-medium'>{footer}</div>}
				</div>
			</div>
			<AuthSidePanel />
		</div>
	);
}

function AuthSidePanel() {
	const [value, setValue] = useState('');

	return (
		<div
			className='flex flex-col items-center justify-center hidden overflow-hidden lg:flex lg:w-1/2 m-4 rounded-lg'
			style={{ backgroundImage: "url('/fontNao.png')", backgroundSize: 'cover', backgroundPosition: 'center' }}
		>
			<div className='relative w-full mx-auto max-w-md'>
				<InputGroup
					htmlFor='chat-input'
					className={cn(
						'flex items-center gap-1.5 md:gap-4 ml-auto relative rounded-lg px-4 py-6 shadow-xs',
						'dark:bg-muted ring-[6px] ring-secondary/50 dark:ring-secondary/50',
						'before:pointer-events-none before:absolute before:-inset-[7px] before:rounded-[15px] before:p-[0.5px]',
						'before:[background:linear-gradient(135deg,rgba(255,255,255,0.95),rgba(255,255,255,0)_40%,rgba(255,255,255,0)_60%,rgba(255,255,255,0.55))]',
						'dark:before:[background:linear-gradient(135deg,color-mix(in_srgb,var(--primary-foreground)_90%,transparent),transparent_40%,transparent_60%,color-mix(in_srgb,var(--primary-foreground)_50%,transparent))]',
						'before:[-webkit-mask-image:linear-gradient(#fff_0_0),linear-gradient(#fff_0_0)] before:[mask-image:linear-gradient(#fff_0_0),linear-gradient(#fff_0_0)]',
						'before:[-webkit-mask-clip:content-box,border-box] before:[mask-clip:content-box,border-box]',
						'before:[-webkit-mask-composite:xor] before:[mask-composite:exclude]',
					)}
				>
					<NakedInput
						id='chat-input'
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder='Ask anything about your data...'
						className='flex-1 text-sm font-normal caret-primary placeholder:font-medium placeholder:text-muted-foreground'
					/>
					<ChatButton showStop={false} type='button' />
				</InputGroup>
			</div>
		</div>
	);
}

interface FormTextFieldProps {
	form: any;
	name: string;
	type?: string;
	title: string;
	placeholder?: string;
	className?: string;
}

export function FormTextField({ form, name, type = 'text', title, placeholder, className }: FormTextFieldProps) {
	const [showPassword, setShowPassword] = useState(false);
	const isPassword = type === 'password';
	const inputType = isPassword && showPassword ? 'text' : type;

	return (
		<form.Field
			name={name}
			validators={{
				onMount: ({ value }: { value: string }) => (!value ? 'Required' : undefined),
				onChange: ({ value }: { value: string }) => (!value ? 'Required' : undefined),
			}}
		>
			{(field: { state: { value: string }; handleChange: (v: string) => void; handleBlur: () => void }) => (
				<div className={cn('grid gap-2', className)}>
					<label htmlFor={name} className='text-sm font-medium text-foreground'>
						{title ?? name.charAt(0).toUpperCase() + name.slice(1)}
					</label>
					<div className='relative'>
						<NakedInput
							name={name}
							type={inputType}
							placeholder={placeholder}
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							className={cn('h-12 text-base bg-panel w-full rounded-lg p-4', isPassword && 'pr-12')}
						/>
						{isPassword && (
							<button
								type='button'
								onClick={() => setShowPassword(!showPassword)}
								className='absolute right-4 top-1/2 -translate-y-1/2 text-foreground transition-colors'
								tabIndex={-1}
								aria-label={showPassword ? 'Hide password' : 'Show password'}
							>
								{showPassword ? (
									<EyeOff size={18} />
								) : (
									<Eye
										size={18}
										className='[&_circle]:fill-foreground [&_circle]:stroke-foreground'
									/>
								)}
							</button>
						)}
					</div>
				</div>
			)}
		</form.Field>
	);
}
