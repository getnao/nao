import { useCallback, useState } from 'react';

import { describeCommandError } from '@/lib/servers';

/** Runs a command, tracking whether it is pending and turning failures into a readable message. */
export function useAction<Args extends unknown[]>(action: (...args: Args) => Promise<unknown>) {
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string>();

	const run = useCallback(
		async (...args: Args) => {
			setIsPending(true);
			setError(undefined);
			try {
				await action(...args);
			} catch (actionError) {
				setError(describeCommandError(actionError));
			} finally {
				setIsPending(false);
			}
		},
		[action],
	);

	return { run, isPending, error };
}
