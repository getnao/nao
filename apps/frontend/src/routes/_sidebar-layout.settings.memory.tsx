import { createFileRoute } from '@tanstack/react-router';
import { SettingsMemories } from '@/components/settings/memories';

export const Route = createFileRoute('/_sidebar-layout/settings/memory')({
	component: SettingsMemories,
});
