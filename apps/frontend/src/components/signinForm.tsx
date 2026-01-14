import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '../main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { handleGoogleSignIn } from '@/lib/auth-client';

interface SignFormProps<T extends string> {
	title: string;
	fields: Array<FormField<T>>;
	formData: Record<T, string>;
	onSubmit: (e: React.FormEvent) => Promise<void>;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	submitButtonText: string;
	footerText: string;
	footerLinkText: string;
	footerLinkTo: string;
	error?: string;
}

interface FormField<T extends string = string> {
	name: T;
	type?: string;
	placeholder?: string;
}

export type Fields<T extends string = string> = FormField<T>[];

export function SignInForm<T extends string>({
	title,
	fields,
	formData,
	onSubmit,
	onChange,
	submitButtonText,
	footerText,
	footerLinkText,
	footerLinkTo,
	error,
}: SignFormProps<T>) {
	const isGoogleSetup = useQuery(trpc.hasGoogleSetup.queryOptions());

	return (
		<div className='container mx-auto w-full max-w-2xl p-12 my-auto'>
			<div className='text-3xl font-bold mb-8 text-center'>{title}</div>

			<form onSubmit={onSubmit} className='space-y-6'>
				{fields.map((field) => (
					<Input
						key={field.name}
						name={field.name}
						type={field.type}
						placeholder={field.placeholder}
						value={formData[field.name]}
						onChange={onChange}
						required
						className='h-12 text-base'
					/>
				))}

				{error && <p className='text-red-500 text-center text-base'>{error}</p>}

				<Button
					type='submit'
					className='w-full h-12 text-base'
					disabled={Object.values(formData).some((value) => !value)}
				>
					{submitButtonText}
				</Button>
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
							<img src='/google-icon.svg' alt='Google' className='w-5 h-5' />
						</Button>
					</div>
				</div>
			)}

			<p className='text-center text-sm text-muted-foreground mt-8'>
				{footerText}{' '}
				<Link to={footerLinkTo} className='text-primary hover:underline font-medium'>
					{footerLinkText}
				</Link>
			</p>
		</div>
	);
}
