import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

export interface GoogleEditingState {
	isEditing: boolean;
}

export function useGoogleSettings() {
	const queryClient = useQueryClient();

	const googleSettings = useQuery(trpc.google.getSettings.queryOptions());
	const updateSettings = useMutation(trpc.google.updateSettings.mutationOptions());

	const [editingState, setEditingState] = useState<GoogleEditingState | null>(null);

	const invalidateQueries = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.google.getSettings.queryOptions().queryKey });
	};

	const handleSubmit = async (values: { clientId: string; clientSecret: string; authDomains: string }) => {
		await updateSettings.mutateAsync(values);
		await invalidateQueries();
		setEditingState(null);
		updateSettings.reset();
	};

	const handleCancel = () => {
		setEditingState(null);
		updateSettings.reset();
	};

	const handleEdit = () => {
		setEditingState({ isEditing: true });
	};

	return {
		// Data
		settings: googleSettings.data,
		usingDbOverride: googleSettings.data?.usingDbOverride ?? false,

		// State
		editingState,

		// Mutation state
		updatePending: updateSettings.isPending,
		updateError: updateSettings.error,

		// Handlers
		handleSubmit,
		handleCancel,
		handleEdit,
	};
}
