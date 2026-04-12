import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

export interface SmtpEditingState {
    isEditing: boolean;
}

export function useSmtpSettings() {
    const queryClient = useQueryClient();

    const smtpSettings = useQuery(trpc.authConfig.smtp.getSettings.queryOptions());
    const updateSettings = useMutation(trpc.authConfig.smtp.updateSettings.mutationOptions());

    const [editingState, setEditingState] = useState<SmtpEditingState | null>(null);

    const invalidateQueries = async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.authConfig.smtp.getSettings.queryOptions().queryKey });
        await queryClient.invalidateQueries({ queryKey: trpc.authConfig.smtp.isSetup.queryOptions().queryKey });
    };

    const handleSubmit = async (values: {
        host: string;
        port: string;
        ssl: string;
        mailFrom: string;
        password: string;
    }) => {
        await updateSettings.mutateAsync({
            ...values,
            ssl: values.ssl as 'true' | 'false',
        });
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
        settings: smtpSettings.data,
        usingDbOverride: smtpSettings.data?.usingDbOverride ?? false,

        editingState,

        updatePending: updateSettings.isPending,
        updateError: updateSettings.error,

        handleSubmit,
        handleCancel,
        handleEdit,
    };
}
