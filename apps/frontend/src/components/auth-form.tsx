import { useQuery } from '@tanstack/react-query';
import { trpc } from '../main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { handleGoogleSignIn } from '@/lib/auth-client';
import GoogleIcon from '@/components/icons/google.svg';

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
		<div className='container mx-auto w-full max-w-2xl p-12 my-auto'>
			<div className='text-3xl font-bold mb-8 text-center'>{title}</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
				className='space-y-6'
			>
				{children}

				{serverError && <p className='text-red-500 text-center text-base'>{serverError}</p>}

				<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
					{(canSubmit: boolean) => (
						<Button type='submit' className='w-full h-12 text-base' disabled={!canSubmit}>
							{submitText}
						</Button>
					)}
				</form.Subscribe>
			</form>

			{isGoogleSetup.data && (
				<div className='mt-8'>
					<div className='relative'>
						<div className='absolute inset-0 flex items-center'>
							<div className='w-full border-t border-gray-300' />
						</div>
						<div className='relative flex justify-center text-sm'>
							<span className='px-2 bg-background text-muted-foreground'>Or continue with</span>
						</div>
					</div>

					<div className='flex justify-center items-center gap-4 p-4'>
						<Button type='button' variant='outline' onClick={handleGoogleSignIn}>
							<GoogleIcon className='w-5 h-5' />
						</Button>
					</div>
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
			validators={{ onChange: ({ value }: { value: string }) => (!value ? 'Required' : undefined) }}
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
