import { useQuery } from '@tanstack/react-query';
import { trpc } from '../main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { handleGoogleSignIn } from '@/lib/auth-client';
import GoogleIcon from '@/components/icons/google-icon.svg';
import NaoLogo from '@/components/icons/nao-logo-greyscale.svg';

interface AuthFormProps {
	form: any;
	title: string;
	submitText: string;
	children: React.ReactNode;
	serverError?: string;
}

export function AuthForm({ form, title, submitText, children, serverError }: AuthFormProps) {
	const isGoogleSetup = useQuery(trpc.google.isSetup.queryOptions());

	return (
		<div className='mx-auto w-full max-w-md p-8 my-auto'>
			<div className='flex flex-col items-center mb-8'>
				<NaoLogo className='w-12 h-12 mb-4' />
				<h1 className='text-2xl font-semibold'>{title}</h1>
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
				className='space-y-4'
			>
				{children}

				{serverError && <p className='text-red-500 text-center text-sm'>{serverError}</p>}

				<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
					{(canSubmit: boolean) => (
						<Button type='submit' className='w-full h-11' disabled={!canSubmit}>
							{submitText}
						</Button>
					)}
				</form.Subscribe>
			</form>

			{isGoogleSetup.data && (
				<div className='mt-6'>
					<div className='relative'>
						<div className='absolute inset-0 flex items-center'>
							<div className='w-full border-t' />
						</div>
						<div className='relative flex justify-center text-xs uppercase'>
							<span className='px-2 bg-background text-muted-foreground'>Or</span>
						</div>
					</div>

					<Button type='button' variant='outline' className='w-full h-11 mt-6' onClick={handleGoogleSignIn}>
						<GoogleIcon className='w-5 h-5' />
						Continue with Google
					</Button>
				</div>
			)}
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
