import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { signUp } from '@/lib/auth-client';
import { SignForm } from '@/components/ui/signForm';

export const Route = createFileRoute('/signup')({
	component: SignUpForm,
});

function SignUpForm() {
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
			id: 'name',
			name: 'name',
			type: 'text',
			label: 'Name',
		},
		{
			id: 'email',
			name: 'email',
			type: 'email',
			label: 'Email',
			placeholder: 'test@gmail.com',
		},
		{
			id: 'password',
			name: 'password',
			type: 'password',
			label: 'Password',
		},
	];

	return (
		<SignForm
			title='Sign Up'
			fields={fields}
			formData={formData}
			onSubmit={handleSignUp}
			onChange={handleChange}
			submitButtonText='Sign Up'
			footerText='Already have an account?'
			footerLinkText='Sign in'
			footerLinkTo='/signin'
			error={error}
		/>
	);
}
