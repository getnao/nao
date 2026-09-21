import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { trpc } from '../main';
import { InputGroup } from './ui/input-group';
import { NakedInput } from '@/components/ui/input';
import { MicrosoftSignInButton, useIsMicrosoftSetup } from '@/components/auth-microsoft-button';
import { OidcSignInButton } from '@/components/auth-oidc-button';
import { Button, ChatButton, AuthSocialButton } from '@/components/ui/button';
import { LastUsedPill } from '@/components/ui/last-used-pill';
import { buildBrandVars } from '@/components/brand-color';
import GithubIcon from '@/components/icons/github-icon.svg';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import GoogleIcon from '@/components/icons/google-icon.svg';
import NaoLogo from '@/components/icons/nao-full-logo.svg';
import { BrandGradientBackdrop } from '@/components/brand-gradient-backdrop';
import { useIsDarkMode } from '@/contexts/theme.provider';
import { brandingAssetUrl, DEFAULT_BRAND_COLOR, useBranding } from '@/hooks/use-branding';
import { handleGithubSignIn, handleGitlabSignIn, handleGoogleSignIn } from '@/lib/auth-client';
import { loadLastSignInMethod, rememberSignInMethod } from '@/lib/last-sign-in-method';
import { cn } from '@/lib/utils';

/**
 * Shrinks the email/password fields when sign-in providers are on screen, so the
 * provider buttons read as the primary way in.
 */
const CompactFieldsContext = createContext({ compact: false, emailLastUsed: false });

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
	const isGitlabSetup = useQuery(trpc.authConfig.gitlab.isSetup.queryOptions());
	const { isSetup: isMicrosoftSetup, isPending: isMicrosoftSetupPending } = useIsMicrosoftSetup();
	const oidcConfig = useQuery(trpc.authConfig.oidc.getConfig.queryOptions());
	const branding = useBranding();
	const isDark = useIsDarkMode();
	const customColor = branding.enabled ? branding.brandColor : null;
	const brandVars = customColor
		? (buildBrandVars(customColor, isDark ? 'dark' : 'light') as React.CSSProperties)
		: undefined;

	const [lastSignInMethod] = useState(loadLastSignInMethod);
	const [isEmailFormExpanded, setIsEmailFormExpanded] = useState(lastSignInMethod === 'email');

	const socialProviders = [
		isGoogleSetup.data && (
			<AuthSocialButton
				key='google'
				icon={GoogleIcon}
				label='Continue with Google'
				onClick={() => {
					rememberSignInMethod('google');
					handleGoogleSignIn(socialCallbackUrl);
				}}
				lastUsed={lastSignInMethod === 'google'}
			/>
		),
		isGithubSetup.data && (
			<AuthSocialButton
				key='github'
				icon={GithubIcon}
				label='Continue with GitHub'
				onClick={() => {
					rememberSignInMethod('github');
					handleGithubSignIn(socialCallbackUrl);
				}}
				lastUsed={lastSignInMethod === 'github'}
			/>
		),
		isGitlabSetup.data && (
			<AuthSocialButton
				key='gitlab'
				icon={GitlabIcon}
				label='Continue with GitLab'
				onClick={() => {
					rememberSignInMethod('gitlab');
					handleGitlabSignIn(socialCallbackUrl);
				}}
				lastUsed={lastSignInMethod === 'gitlab'}
			/>
		),
		isMicrosoftSetup && (
			<MicrosoftSignInButton
				key='microsoft'
				callbackUrl={socialCallbackUrl}
				lastUsed={lastSignInMethod === 'microsoft'}
			/>
		),
		oidcConfig.data && (
			<OidcSignInButton
				key='oidc'
				providerId={oidcConfig.data.providerId}
				providerName={oidcConfig.data.providerName}
				callbackUrl={socialCallbackUrl}
				lastUsed={lastSignInMethod === 'oidc'}
			/>
		),
	].filter(Boolean);

	const areSocialProvidersPending = Boolean(
		displaySocialProviders &&
		(isGoogleSetup.isPending ||
			isGithubSetup.isPending ||
			isGitlabSetup.isPending ||
			isMicrosoftSetupPending ||
			oidcConfig.isPending),
	);
	const hasAnyProvider = socialProviders.length > 0;
	const showsProviders = Boolean(displaySocialProviders && !areSocialProvidersPending && hasAnyProvider);
	const showEmailForm =
		!areSocialProvidersPending && displayEmailPasswordForm && (!showsProviders || isEmailFormExpanded);

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
							<NaoLogo
								className={cn(
									'w-20 h-auto text-foreground',
									customColor && '[&_stop]:[stop-color:var(--brand-logo)]',
								)}
								style={
									customColor ? ({ '--brand-logo': customColor } as React.CSSProperties) : undefined
								}
							/>
						)}
						<h1 className='font-borna text-2xl font-medium text-center'>{title}</h1>
					</div>

					{showsProviders && (
						<div className='mb-6'>
							<div className='grid grid-cols-1 gap-3 mb-6'>{socialProviders}</div>

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

							{displayEmailPasswordForm && !isEmailFormExpanded && (
								<button
									type='button'
									onClick={() => setIsEmailFormExpanded(true)}
									className='mt-6 flex w-full cursor-pointer items-center justify-center gap-2 text-sm font-medium text-foreground'
								>
									<span className='underline underline-offset-2'>Use email and password</span>
								</button>
							)}
						</div>
					)}

					{serverError && <p className='text-red-500 text-center text-sm mb-4'>{serverError}</p>}

					{showEmailForm ? (
						<CompactFieldsContext.Provider
							value={{
								compact: showsProviders,
								emailLastUsed: Boolean(displaySocialProviders && lastSignInMethod === 'email'),
							}}
						>
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
											className={cn(
												'w-full rounded-full',
												showsProviders ? 'h-10 text-sm' : 'h-11',
												!canSubmit && 'bg-muted-foreground/20 text-secondary-foreground',
											)}
											style={canSubmit ? brandVars : undefined}
											disabled={!canSubmit}
										>
											{submitText}
										</Button>
									)}
								</form.Subscribe>
							</form>
						</CompactFieldsContext.Provider>
					) : (
						!displayEmailPasswordForm &&
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
	const branding = useBranding();
	const isDark = useIsDarkMode();
	const customColor = branding.enabled ? branding.brandColor : null;
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = panelRef.current;
		if (!el) {
			return;
		}
		if (!customColor) {
			for (const key of Object.keys(buildBrandVars('#000000'))) {
				el.style.removeProperty(key);
			}
			return;
		}
		const vars = buildBrandVars(customColor, isDark ? 'dark' : 'light');
		for (const [key, val] of Object.entries(vars)) {
			el.style.setProperty(key, val);
		}
	}, [customColor, isDark]);

	return (
		<div
			ref={panelRef}
			className='relative flex flex-col items-center justify-center hidden overflow-hidden lg:flex lg:w-1/2 m-4 rounded-lg'
		>
			<BrandGradientBackdrop
				color={customColor ?? DEFAULT_BRAND_COLOR}
				className='absolute inset-0 h-full w-full'
			/>
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
	const { compact, emailLastUsed } = useContext(CompactFieldsContext);
	const isPassword = type === 'password';
	const inputType = isPassword && showPassword ? 'text' : type;
	const eyeIconSize = compact ? 16 : 18;
	const showLastUsed = emailLastUsed && name === 'email';

	return (
		<form.Field
			name={name}
			validators={{
				onMount: ({ value }: { value: string }) => (!value ? 'Required' : undefined),
				onChange: ({ value }: { value: string }) => (!value ? 'Required' : undefined),
			}}
		>
			{(field: { state: { value: string }; handleChange: (v: string) => void; handleBlur: () => void }) => (
				<div className={cn('grid', compact ? 'gap-1.5' : 'gap-2', className)}>
					<label
						htmlFor={name}
						className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}
					>
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
							className={cn(
								'bg-panel w-full rounded-lg',
								compact ? 'h-10 text-sm px-3' : 'h-12 text-base p-4',
								isPassword && (compact ? 'pr-10' : 'pr-12'),
							)}
						/>
						{showLastUsed && <LastUsedPill className='absolute -top-2 right-3' />}
						{isPassword && (
							<button
								type='button'
								onClick={() => setShowPassword(!showPassword)}
								className={cn(
									'absolute top-1/2 -translate-y-1/2 text-foreground transition-colors',
									compact ? 'right-3' : 'right-4',
								)}
								tabIndex={-1}
								aria-label={showPassword ? 'Hide password' : 'Show password'}
							>
								{showPassword ? (
									<EyeOff size={eyeIconSize} />
								) : (
									<Eye
										size={eyeIconSize}
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
