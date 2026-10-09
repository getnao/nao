import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { LlmProvider } from '@nao/shared/types';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc } from '@/main';

type ManagedWelcomeGrantDecision = 'send' | 'cancel' | 'switch-project';

interface ManagedWelcomeGrantContextValue {
	confirmBeforeSend: (provider: LlmProvider | undefined) => Promise<ManagedWelcomeGrantDecision>;
}

interface PendingConfirmation {
	resolve: (decision: ManagedWelcomeGrantDecision) => void;
	organizationName: string;
}

const ManagedWelcomeGrantContext = createContext<ManagedWelcomeGrantContextValue>({
	confirmBeforeSend: async () => 'send',
});

export function ManagedWelcomeGrantProvider({ children }: { children: React.ReactNode }) {
	const queryClient = useQueryClient();
	const confirmGrant = useMutation(trpc.account.confirmWelcomeGrant.mutationOptions());
	const pendingRef = useRef<PendingConfirmation | null>(null);
	const [pending, setPending] = useState<PendingConfirmation | null>(null);
	const [error, setError] = useState<string>();

	const settle = useCallback((decision: ManagedWelcomeGrantDecision) => {
		const current = pendingRef.current;
		if (!current) {
			return;
		}
		pendingRef.current = null;
		setPending(null);
		setError(undefined);
		current.resolve(decision);
	}, []);

	useEffect(() => () => pendingRef.current?.resolve('cancel'), []);

	const confirmBeforeSend = useCallback(
		async (provider: LlmProvider | undefined): Promise<ManagedWelcomeGrantDecision> => {
			if (provider !== 'nao') {
				return 'send';
			}
			if (pendingRef.current) {
				return 'cancel';
			}
			const status = await queryClient.fetchQuery(trpc.account.getManagedCreditStatus.queryOptions());
			const organization = status.organization;
			if (!status.enabled || status.welcomeGrantStatus !== 'unclaimed' || !organization) {
				return 'send';
			}
			return new Promise((resolve) => {
				const confirmation = { resolve, organizationName: organization.name };
				pendingRef.current = confirmation;
				setPending(confirmation);
			});
		},
		[queryClient],
	);

	const handleConfirm = async () => {
		setError(undefined);
		try {
			await confirmGrant.mutateAsync();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.account.getManagedCreditStatus.queryKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.account.getCreditSummary.queryKey() }),
				queryClient.invalidateQueries({
					queryKey: trpc.project.listAvailableTranscribeModels.queryKey(),
				}),
			]);
			settle('send');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not assign the welcome credit.');
		}
	};

	return (
		<ManagedWelcomeGrantContext.Provider value={{ confirmBeforeSend }}>
			{children}
			<Dialog
				open={!!pending}
				onOpenChange={(open) => {
					if (!open && !confirmGrant.isPending) {
						settle('cancel');
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Use your $5 welcome credit with {pending?.organizationName}</DialogTitle>
					</DialogHeader>
					<DialogDescription>
						This one-time credit will be permanently assigned to {pending?.organizationName} and shared with
						its members.
					</DialogDescription>
					{error && <p className='text-center text-sm text-red-500'>{error}</p>}
					<div className='flex justify-end gap-2'>
						<Button
							variant='outline'
							className='rounded-full'
							disabled={confirmGrant.isPending}
							onClick={() => settle('switch-project')}
						>
							Switch project
						</Button>
						<Button
							className='rounded-full'
							disabled={confirmGrant.isPending}
							isLoading={confirmGrant.isPending}
							onClick={handleConfirm}
						>
							Apply $5 and send
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</ManagedWelcomeGrantContext.Provider>
	);
}

export const useManagedWelcomeGrant = () => useContext(ManagedWelcomeGrantContext);
