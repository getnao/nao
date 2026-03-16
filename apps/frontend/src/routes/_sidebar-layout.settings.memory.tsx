import { createFileRoute } from '@tanstack/react-router';
import { SettingsMemories } from '@/components/settings/memories';
import { SettingsPageWrapper } from '@/components/ui/settings-card';

export const Route = createFileRoute('/_sidebar-layout/settings/memory')({
	component: MemoryPage,
});

function MemoryPage() {
	return (
		<SettingsPageWrapper>
			<SettingsMemories />
		</SettingsPageWrapper>
	);
}
