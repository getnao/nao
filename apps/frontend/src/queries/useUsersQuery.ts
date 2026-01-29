import { useMutation } from '@tanstack/react-query';
import { trpc } from '@/main';
import { queryClient } from '@/utils/query-client';

export const useCreateUser = () =>
	useMutation(
		trpc.user.createUserAndAddToProject.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAllUsersWithRoles.queryKey(),
				});
			},
		}),
	);
