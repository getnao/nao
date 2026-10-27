import { createFileRoute } from '@tanstack/react-router';

import { ProjectAutomations } from '@/components/settings/project-automations';
import { requireAdmin, requireAutomationsEnabled } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/project/automations')({
	beforeLoad: async () => {
		await requireAutomationsEnabled();
		await requireAdmin();
	},
	staticData: {
		title: 'Automations',
		description: 'Review, disable, reassign, and delete the automations created by every member of this project.',
	},
	component: ProjectAutomations,
});
