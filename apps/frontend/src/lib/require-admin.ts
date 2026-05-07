import { redirect } from '@tanstack/react-router';
import { queryClient, trpc } from '@/main';

export async function requireAdmin() {
	const project = await queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions());
	if (!project || project.userRole !== 'admin') {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireAdminNonCloud() {
	await requireAdmin();
	const config = await queryClient.ensureQueryData(trpc.system.getPublicConfig.queryOptions());
	if (config.naoMode === 'cloud') {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireAdminNonCloudWithLicense() {
	await requireAdminNonCloud();
	const license = await queryClient.ensureQueryData(trpc.license.getStatus.queryOptions());
	if (!license.tokenProvided) {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireNonViewer() {
	const project = await queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions());
	if (!project || project.userRole === 'viewer') {
		throw redirect({ to: '/settings/account' });
	}
}
