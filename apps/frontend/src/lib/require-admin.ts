import { redirect } from '@tanstack/react-router';
import { queryClient, trpc } from '@/main';

export async function requireAdmin() {
	const project = await queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions());
	if (!project || project.userRole !== 'admin') {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireNonCloud() {
	const config = await queryClient.ensureQueryData(trpc.system.getPublicConfig.queryOptions());
	if (config.naoMode === 'cloud') {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireAdminNonCloud() {
	await requireAdmin();
	await requireNonCloud();
}

export async function requireNonViewerNonCloud() {
	await requireNonViewer();
	await requireNonCloud();
}

export async function requireContextAdminOrAdmin() {
	const project = await queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions());
	if (!project || (project.userRole !== 'admin' && project.userRole !== 'context_admin')) {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireNonViewer() {
	const project = await queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions());
	if (!project || project.userRole === 'viewer') {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireAutomationsEnabled() {
	const config = await queryClient.ensureQueryData(trpc.system.getPublicConfig.queryOptions());
	if (!config.betaAutomationsEnabled) {
		throw redirect({ to: '/' });
	}
}
