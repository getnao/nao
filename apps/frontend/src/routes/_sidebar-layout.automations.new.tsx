import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useRef } from 'react';

import type { AutomationFormHandle, AutomationFormValue } from '@/components/automations-form';
import {
	AutomationChatPanel,
	OpenAutomationChatButton,
	useAutomationChatPanelOpen,
} from '@/components/automation-chat-panel';
import { AutomationEditorLayout } from '@/components/automation-editor-layout';
import { AutomationForm } from '@/components/automations-form';
import { Button } from '@/components/ui/button';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { usePermissions } from '@/hooks/use-permissions';
import { requireAutomationsEnabled } from '@/lib/route-guards';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/automations/new')({
	beforeLoad: async () => {
		await requireAutomationsEnabled();
	},
	component: NewAutomationPage,
});

function NewAutomationPage() {
	const { isViewer } = usePermissions();
	const { automationCreationEnabled, isLoading } = useEffectiveUserGroupFeatures();
	const canCreateAutomation = automationCreationEnabled && !isViewer;

	if (isLoading) {
		return null;
	}

	return canCreateAutomation ? <NewAutomationEditor /> : <AutomationCreationUnavailable />;
}

function NewAutomationEditor() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const createAutomation = useMutation(trpc.automation.create.mutationOptions());
	const formHandleRef = useRef<AutomationFormHandle>(null);
	const editorChatIdRef = useRef<string | undefined>(undefined);
	const [isChatOpen, setIsChatOpen] = useAutomationChatPanelOpen();

	async function handleCreate(value: AutomationFormValue) {
		const created = await createAutomation.mutateAsync({ ...value, editorChatId: editorChatIdRef.current });
		await queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() });
		navigate({ to: '/automations/$automationId', params: { automationId: created.id } });
	}

	return (
		<AutomationEditorLayout
			chatPanel={
				<AutomationChatPanel
					formHandleRef={formHandleRef}
					isOpen={isChatOpen}
					onOpenChange={setIsChatOpen}
					onChatStarted={(chatId) => {
						editorChatIdRef.current = chatId;
					}}
				/>
			}
		>
			<AutomationsBackLink />
			<div className='mb-6 flex items-center justify-between gap-3'>
				<h1 className='text-xl font-semibold tracking-tight'>New automation</h1>
				<OpenAutomationChatButton isOpen={isChatOpen} onOpen={() => setIsChatOpen(true)} />
			</div>
			<AutomationForm
				handleRef={formHandleRef}
				submitLabel='Create automation'
				isPending={createAutomation.isPending}
				onSubmit={handleCreate}
			/>
		</AutomationEditorLayout>
	);
}

function AutomationCreationUnavailable() {
	return (
		<AutomationEditorLayout chatPanel={null}>
			<AutomationsBackLink />
			<p className='text-sm text-muted-foreground'>You are not allowed to create automations in this project.</p>
		</AutomationEditorLayout>
	);
}

function AutomationsBackLink() {
	return (
		<Button variant='ghost' size='sm' className='mb-4' asChild>
			<Link to='/automations'>
				<ArrowLeft className='size-4' />
				Automations
			</Link>
		</Button>
	);
}
