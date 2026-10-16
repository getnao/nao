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

export async function requireOrganizationAdminCloudBilling() {
	const config = await requireCloud();
	if (!config.cloudBillingEnabled) {
		throw redirect({ to: '/settings/account' });
	}
	await requireOrganizationAdmin();
}

export async function requireOrganizationAdminCloud() {
	const config = await requireCloud();
	await requireOrganizationAdmin();
	return config;
}

export async function requireCloud() {
	const config = await queryClient.ensureQueryData(trpc.system.getPublicConfig.queryOptions());
	if (config.naoMode !== 'cloud') {
		throw redirect({ to: '/settings/account' });
	}
	return config;
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

export async function requireUsageOrManagedAiAccess() {
	const [project, config] = await Promise.all([
		queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions()),
		queryClient.ensureQueryData(trpc.system.getPublicConfig.queryOptions()),
	]);
	if (
		project &&
		(project.userRole === 'admin' || project.userRole === 'user' || project.userRole === 'context_admin')
	) {
		return;
	}

	if (config.naoMode === 'cloud') {
		const organization = await queryClient.ensureQueryData(trpc.organization.get.queryOptions());
		if (organization.role === 'admin') {
			return;
		}
	}

	throw redirect({ to: '/settings/account' });
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

async function requireOrganizationAdmin() {
	const organization = await queryClient.ensureQueryData(trpc.organization.get.queryOptions());
	if (organization.role !== 'admin') {
		throw redirect({ to: '/settings/account' });
	}
}
