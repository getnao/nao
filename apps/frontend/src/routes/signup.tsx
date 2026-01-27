import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { signUp } from '@/lib/auth-client';
import { SignInForm } from '@/components/signin-form';

export const Route = createFileRoute('/signup')({
	component: SignUp,
});

function SignUp() {
	const navigate = useNavigate();
	const [formData, setFormData] = useState({
		name: '',
		email: '',
		password: '',
	});
	const [error, setError] = useState('');

	const handleSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		await signUp.email(
			{
				name: formData.name,
				email: formData.email,
				password: formData.password,
			},
			{
				onSuccess: () => {
					navigate({ to: '/' });
				},
				onError: (ctx) => {
					setError(ctx.error.message);
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
			title='Sign Up'
			fields={[
				{
					name: 'name',
					placeholder: 'Name',
				},
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
			onSubmit={handleSignUp}
			onChange={handleChange}
			submitButtonText='Sign Up'
			footerText='Already have an account?'
			footerLinkText='Sign in'
			footerLinkTo='/login'
			error={error}
		/>
	);
}
