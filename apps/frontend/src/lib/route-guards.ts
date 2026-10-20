import { redirect } from '@tanstack/react-router';

import {
	ACCOUNT_SETTINGS_PATH,
	canSeeAdvancedSettings,
	readAdvancedSettingsAccessStore,
} from '@/lib/advanced-settings-access';
import { authClient } from '@/lib/auth-client';
import { queryClient, trpc } from '@/main';

export async function requireAdvancedSettingsAccess(pathname: string) {
	if (pathname.startsWith(ACCOUNT_SETTINGS_PATH)) {
		return;
	}
	const project = await queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions());
	const session = await authClient.getSession();
	if (!canSeeAdvancedSettings(readAdvancedSettingsAccessStore(), project?.userRole, session.data?.user.id)) {
		throw redirect({ to: ACCOUNT_SETTINGS_PATH });
	}
}

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

export async function requireCloudBilling() {
	const config = await queryClient.ensureQueryData(trpc.system.getPublicConfig.queryOptions());
	if (!config.cloudBillingEnabled) {
		throw redirect({ to: '/settings/account' });
	}
}

export async function requireOrganizationAdminCloudBilling() {
	await requireCloudBilling();
	const organization = await queryClient.ensureQueryData(trpc.organization.get.queryOptions());
	if (organization.role !== 'admin') {
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
