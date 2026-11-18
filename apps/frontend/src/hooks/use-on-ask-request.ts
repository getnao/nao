import { useEffect, useRef } from 'react';

import { useAskRequest } from '@/stores/ask-bar';

/** Runs once for each question asked after the page mounted, such as from the Edit story button. */
export function useOnAskRequest(onRequest: () => void) {
	const request = useAskRequest();
	const handledRequestId = useRef(request?.id);

	useEffect(() => {
		if (!request || request.id === handledRequestId.current) {
			return;
		}
		handledRequestId.current = request.id;
		onRequest();
	}, [request, onRequest]);
}
