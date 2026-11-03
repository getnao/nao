import { createFileRoute, redirect } from '@tanstack/react-router';

/** Tests live in the File Explorer's drawer; old links to the Tests page and its runs open them there. */
export const Route = createFileRoute('/_sidebar-layout/settings/tests')({
	validateSearch: (search: Record<string, unknown>): { run: string | undefined } => ({
		run: typeof search.run === 'string' && search.run.length > 0 ? search.run : undefined,
	}),
	beforeLoad: ({ search }) => {
		throw redirect({ to: '/settings/context-explorer', search: { testRun: search.run }, replace: true });
	},
});
