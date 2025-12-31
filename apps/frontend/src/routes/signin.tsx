import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import { SignForm } from '@/components/ui/signForm';

export const Route = createFileRoute('/signin')({
	component: SignInForm,
});

function SignInForm() {
	const navigate = useNavigate();
	const [formData, setFormData] = useState({
		email: '',
		password: '',
	});
	const [error, setError] = useState('');

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		await signIn.email(
			{
				email: formData.email,
				password: formData.password,
			},
			{
				onSuccess: () => {
					navigate({ to: '/' });
				},
				onError: (error) => {
					setError(error.error.message);
				},
			},
		);
	};

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setFormData({
			...formData,
			[e.target.name]: e.target.value,
		});
	};

	const fields = [
		{
			id: 'email',
			name: 'email',
			type: 'email',
			label: 'Email',
			placeholder: 'Enter your email',
		},
		{
			id: 'password',
			name: 'password',
			type: 'password',
			label: 'Password',
			placeholder: 'Enter your password',
		},
	];

	return (
		<SignForm
			title='Sign In'
			fields={fields}
			formData={formData}
			onSubmit={handleSubmit}
			onChange={handleChange}
			submitButtonText='Sign In'
			footerText="Don't have an account?"
			footerLinkText='Sign up'
			footerLinkTo='/signup'
			error={error}
		/>
	);
}
