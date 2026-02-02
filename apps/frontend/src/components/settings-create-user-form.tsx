import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { TextField, FormError } from '@/components/ui/form-fields';

interface CreateUserFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUserCreated: (email: string, password: string) => void;
}

export function CreateUserForm({ open, onOpenChange, onUserCreated }: CreateUserFormProps) {
	const { refetch } = useSession();
	const queryClient = useQueryClient();

	const form = useForm({
		defaultValues: { name: '', email: '' },
		onSubmit: async ({ value }) => {
			await createUserMutation.mutateAsync(value);
		},
	});

	const createUserMutation = useMutation(
		trpc.user.createUserAndAddToProject.mutationOptions({
			onSuccess: async (ctx) => {
				await refetch();
				await queryClient.invalidateQueries({
					queryKey: trpc.project.getAllUsersWithRoles.queryKey(),
				});
				onOpenChange(false);
				onUserCreated(form.state.values.email, ctx.password);
				form.reset();
			},
			onError: (err) => {
				form.setErrorMap({ onSubmit: { form: err.message, fields: {} } });
			},
		}),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create User</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className='flex flex-col gap-4'
				>
					<TextField form={form} name='name' label='Name' placeholder="Enter the new user's name" required />
					<TextField
						form={form}
						name='email'
						label='Email'
						type='email'
						placeholder="Enter the new user's email"
						required
					/>
					<FormError form={form} />
					<div className='flex justify-end'>
						<form.Subscribe
							selector={(state: { canSubmit: boolean; isSubmitting: boolean }) => ({
								canSubmit: state.canSubmit,
								isSubmitting: state.isSubmitting,
							})}
						>
							{({ canSubmit, isSubmitting }: { canSubmit: boolean; isSubmitting: boolean }) => (
								<Button type='submit' disabled={!canSubmit || isSubmitting}>
									Create user
								</Button>
							)}
						</form.Subscribe>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
