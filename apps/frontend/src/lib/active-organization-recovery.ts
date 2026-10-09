import { observable } from '@trpc/server/observable';
import { clearStaleActiveOrganization } from './active-organization';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { TRPCLink } from '@trpc/client';

export function createActiveOrganizationRecovery({
	invalidateQueries,
	invalidateRouter,
}: {
	invalidateQueries: () => void;
	invalidateRouter: () => void;
}) {
	const requestSelections = new Map<number, { organizationId: string | null; projectId: string | null }>();
	const link: TRPCLink<TrpcRouter> = () => {
		return ({ next, op }) => {
			return observable((observer) => {
				const subscription = next(op).subscribe({
					next(result) {
						observer.next(result);
					},
					error(error) {
						const selection = requestSelections.get(op.id);
						requestSelections.delete(op.id);
						const cleared =
							op.path === 'organization.get' &&
							clearStaleActiveOrganization(
								selection?.organizationId ?? null,
								selection?.projectId ?? null,
								error,
							);

						observer.error(error);
						if (cleared) {
							queueMicrotask(() => {
								invalidateQueries();
								invalidateRouter();
							});
						}
					},
					complete() {
						requestSelections.delete(op.id);
						observer.complete();
					},
				});

				return () => {
					requestSelections.delete(op.id);
					subscription.unsubscribe();
				};
			});
		};
	};

	return {
		link,
		trackRequests(operationIds: number[], selection: { organizationId: string | null; projectId: string | null }) {
			for (const operationId of operationIds) {
				requestSelections.set(operationId, selection);
			}
		},
	};
}
