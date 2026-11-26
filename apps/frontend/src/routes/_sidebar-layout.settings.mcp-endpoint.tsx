import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { McpEndpointSection } from '@/components/settings/mcp-endpoint';
import { McpEndpointSettings } from '@/components/settings/mcp-endpoint';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/mcp-endpoint')({
	component: McpEndpointPage,
});

function McpEndpointPage() {
	const { isAdmin } = usePermissions();
	const [section, setSection] = useState<McpEndpointSection>('setup');

	return (
		<SettingsPageWrapper>
			<McpEndpointSettings isAdmin={isAdmin} section={section} onSectionChange={setSection} />
		</SettingsPageWrapper>
	);
}
