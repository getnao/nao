import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { handleGoogleSignIn } from '@/lib/auth-client';

interface SignFormProps<T extends string> {
	title: string;
	description: string;
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
	description,
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
			<Card className='w-full rounded-4xl px-6 py-10 pt-14'>
				<CardContent className=''>
					<div className='flex flex-col items-center justify-center space-y-8'>
						<div className='flex flex-col items-center space-y-2 text-center'>
							<img src='/nao-template-IOS.svg' alt='nao logo' className='w-25 h-25 rounded' />
							<div className='text-3xl font-bold mt-4'>{title}</div>
							<p className='text-muted-foreground'>{description}</p>
						</div>

						<div className='w-full space-y-4'>
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
									variant='primary'
									disabled={Object.values(formData).some((value) => !value)}
								>
									{submitButtonText}
								</Button>
							</form>
						</div>
					</div>

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
								<Button
									type='button'
									variant='outline'
									onClick={handleGoogleSignIn}
									className='w-[50%]'
								>
									<img src='/google-icon.svg' alt='Google' className='w-5 h-5' /> Google
								</Button>
							</div>
						</div>
					)}
					<p className='text-center text-sm text-muted-foreground'>
						{footerText}{' '}
						<Link to={footerLinkTo} className='text-primary hover:underline font-medium'>
							{footerLinkText}
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
