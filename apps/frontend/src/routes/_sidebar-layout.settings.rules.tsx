import { createFileRoute } from '@tanstack/react-router';
import { SettingsRules } from '@/components/settings/rules';
import { requireNonViewer } from '@/lib/require-admin';
import { SettingsPageWrapper } from '@/components/ui/settings-card';

export const Route = createFileRoute('/_sidebar-layout/settings/rules')({
	beforeLoad: requireNonViewer,
	component: RulesPage,
});

function RulesPage() {
	return (
		<SettingsPageWrapper>
			<SettingsRules />
		</SettingsPageWrapper>
	);
}
