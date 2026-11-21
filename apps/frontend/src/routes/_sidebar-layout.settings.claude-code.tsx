import { createFileRoute } from '@tanstack/react-router';
import { ClaudeCodeConnectionSettings } from '@/components/settings/claude-code-connection';
import { SettingsPageWrapper } from '@/components/ui/settings-card';

export const Route = createFileRoute('/_sidebar-layout/settings/claude-code')({
	component: ClaudeCodeConnectionPage,
});

function ClaudeCodeConnectionPage() {
	return (
		<SettingsPageWrapper>
			<ClaudeCodeConnectionSettings />
		</SettingsPageWrapper>
	);
}
