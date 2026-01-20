import './styles.css';

import { StrictMode } from 'react';
import { createTRPCClient, httpBatchLink, loggerLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import superjson from 'superjson';
import { routeTree } from './routeTree.gen';
import reportWebVitals from './reportWebVitals';
import type { TrpcRouter } from 'backend/trpc';

// Register the router instance for type safety
declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

// Create a new router instance
const router = createRouter({
	routeTree,
	context: {},
	defaultPreload: 'intent',
	scrollRestoration: true,
	defaultStructuralSharing: true,
	defaultPreloadStaleTime: 0,
});

/** Query client for state management */
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: 5 * 60 * 1000, // 5 minutes
		},
	},
});

/** TRPC client for typed requests to the backend */
export const trpcClient = createTRPCClient<TrpcRouter>({
	links: [
		loggerLink(),
		httpBatchLink({
			url: '/api/trpc',
			transformer: superjson,
		}),
	],
});

/** TRPC proxy that uses the trpc and query client */
export const trpc = createTRPCOptionsProxy<TrpcRouter>({
	client: trpcClient,
	queryClient,
});

// Render the app
const rootElement = document.getElementById('app')!;
if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>,
	);
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
