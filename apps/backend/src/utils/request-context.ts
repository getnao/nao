import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
	userEmail?: string;
}

const store = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
	return store.run(context, fn);
}

export function getRequestContext(): RequestContext {
	return store.getStore() ?? {};
}
