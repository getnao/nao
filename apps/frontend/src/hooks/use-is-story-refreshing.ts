import { useIsMutating } from '@tanstack/react-query';
import type { MutationKey } from '@tanstack/react-query';

/**
 * Reads the refresh state from the mutation cache instead of the observer's `isPending`: a refresh started
 * from a mount effect loses its observer under StrictMode's remount, which would leave the spinner on forever.
 */
export function useIsStoryRefreshing(mutationKey: MutationKey, input: Record<string, string>): boolean {
	const pendingCount = useIsMutating({
		mutationKey,
		predicate: (mutation) => {
			return matchesInput(mutation.state.variables, input);
		},
	});
	return pendingCount > 0;
}

function matchesInput(variables: unknown, input: Record<string, string>): boolean {
	if (typeof variables !== 'object' || variables === null) {
		return false;
	}
	const values = variables as Record<string, unknown>;
	return Object.entries(input).every(([key, value]) => values[key] === value);
}
