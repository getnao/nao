import { createFileRoute } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { LinkingCodesCard } from '@/components/settings/linking-code-section';
import { MattermostConfigSection } from '@/components/settings/mattermost-config-section';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/mattermost')({
	component: ProjectMattermostTabPage,
});

function ProjectMattermostTabPage() {
	const { isAdmin } = usePermissions();

	return (
		<>
			<MattermostConfigSection isAdmin={isAdmin} />
			<Accordion type='single' collapsible>
				<AccordionItem
					value='manual-link'
					className='rounded-xl border border-border bg-background last:border-b'
				>
					<AccordionTrigger className='group items-center px-4 py-3 hover:no-underline'>
						<span>Link manually</span>
						<ChevronDown className='ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180' />
					</AccordionTrigger>
					<AccordionContent className='p-4'>
						<LinkingCodesCard provider='mattermost' />
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</>
	);
}
