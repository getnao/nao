import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { CREATE_USER_TEXT, USER_FORM_INITIAL_VALUES, USER_VALIDATION_SCHEMA } from './constants';
import type { CreateUserFormValues, ModifyUserInfoProps } from './types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useCreateUser } from '@/queries/useUsersQuery';
import { COMMON_TEXT } from '@/components/constants';

export function CreateUser({ open, onOpenChange, onUserCreated }: ModifyUserInfoProps) {
	const [formError, setFormError] = useState<string | null>(null);

	const { mutate: createUser } = useCreateUser();

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isSubmitting, isValid },
	} = useForm<CreateUserFormValues>({
		resolver: yupResolver(USER_VALIDATION_SCHEMA),
		mode: 'onChange',
		defaultValues: USER_FORM_INITIAL_VALUES,
	});

	const onSubmit = (data: CreateUserFormValues) => {
		createUser(
			{
				name: data.name,
				email: data.email,
			},
			{
				onSuccess: (ctx) => {
					onOpenChange(false);
					onUserCreated(data.email, ctx.password);
					reset();
				},
				onError: (err: any) => {
					setFormError(err.message);
				},
			},
		);
	};

	const { TITLE, EMAIL_PLACEHOLDER, NAME_PLACEHOLDER } = CREATE_USER_TEXT;
	const { NAME, EMAIL, SAVE_BUTTON } = COMMON_TEXT;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{TITLE}</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit(onSubmit)} className='flex flex-col gap-4'>
					{formError && <div className='rounded bg-red-50 p-2 text-sm text-red-600'>{formError}</div>}
					<div className='flex flex-col gap-2'>
						<label htmlFor='name' className='text-sm font-medium text-slate-700'>
							{NAME}
						</label>
						<Input id='name' type='text' placeholder={NAME_PLACEHOLDER} {...register('name')} />
						{errors.name && <p className='text-sm text-red-500'>{errors.name.message}</p>}
					</div>

					<div className='flex flex-col gap-2'>
						<label htmlFor='email' className='text-sm font-medium text-slate-700'>
							{EMAIL}
						</label>
						<Input id='email' type='text' placeholder={EMAIL_PLACEHOLDER} {...register('email')} />
						{errors.email && <p className='text-sm text-red-500'>{errors.email.message}</p>}
					</div>

					<div className='flex justify-end'>
						<Button type='submit' disabled={isSubmitting || !isValid}>
							{SAVE_BUTTON}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
