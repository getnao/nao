import { createFileRoute } from '@tanstack/react-router';
import { SettingsMemories } from '@/components/settings/memories';
import { requireNonViewer } from '@/lib/require-admin';
import { SettingsPageWrapper } from '@/components/ui/settings-card';

export const Route = createFileRoute('/_sidebar-layout/settings/memory')({
	beforeLoad: requireNonViewer,
	component: MemoryPage,
});

function MemoryPage() {
	return (
		<SettingsPageWrapper>
			<SettingsMemories />
		</SettingsPageWrapper>
	);
}
