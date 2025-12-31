import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { handleGitHubSignIn, handleGoogleSignIn } from '@/lib/auth-client';

interface FormField {
	id: string;
	name: string;
	type: string;
	label: string;
	placeholder?: string;
}

interface SignFormProps {
	title: string;
	fields: Array<FormField>;
	formData: Record<string, string>;
	onSubmit: (e: React.FormEvent) => Promise<void>;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	submitButtonText: string;
	footerText: string;
	footerLinkText: string;
	footerLinkTo: string;
	error?: string;
}

export function SignForm({
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
}: SignFormProps) {
	return (
		<div className='container mx-auto w-full max-w-2xl p-12'>
			<h1 className='text-4xl font-bold mb-8 text-center'>{title}</h1>
			{error && <p className='text-red-500 text-center mb-4 text-2xl'>{error}</p>}
			<form onSubmit={onSubmit} className='space-y-6'>
				{fields.map((field) => (
					<div key={field.id} className='space-y-3'>
						<label htmlFor={field.id} className='text-base font-medium'>
							{field.label}
						</label>
						<Input
							id={field.id}
							name={field.name}
							type={field.type}
							placeholder={field.placeholder}
							value={formData[field.name]}
							onChange={onChange}
							required
							className='h-12 text-base'
						/>
					</div>
				))}

				<Button type='submit' className='w-full h-12 text-base'>
					{submitButtonText}
				</Button>
			</form>

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
					<Button type='button' variant='outline' onClick={handleGitHubSignIn}>
						<img src='/github-icon.svg' alt='GitHub' className='w-5 h-5' />
					</Button>
				</div>
			</div>

			<p className='text-center text-sm text-muted-foreground'>
				{footerText}{' '}
				<Link to={footerLinkTo} className='text-primary hover:underline font-medium'>
					{footerLinkText}
				</Link>
			</p>
		</div>
	);
}
