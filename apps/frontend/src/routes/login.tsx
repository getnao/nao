import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import { SignInForm } from '@/components/signin-form';

export const Route = createFileRoute('/login')({
	component: Login,
});

function Login() {
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
				onError: (err) => {
					setError(err.error.message);
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

	return (
		<SignInForm
			title='Sign In'
			fields={[
				{
					name: 'email',
					type: 'email',
					placeholder: 'Email',
				},
				{
					name: 'password',
					type: 'password',
					placeholder: 'Password',
				},
			]}
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
