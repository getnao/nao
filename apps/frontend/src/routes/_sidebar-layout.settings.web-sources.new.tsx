import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import type { WebRobotRecipe } from '@nao/shared/web-robot';

import type { WebSourceFormInitial, WebSourceFormSubmit } from '@/components/settings/web-source-recipe';
import { WebSourceCreateFromUrl } from '@/components/settings/web-source-create-from-url';
import { WebSourceForm } from '@/components/settings/web-source-form';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/web-sources/new')({
	component: NewWebSourcePage,
});

function NewWebSourcePage() {
	const navigate = useNavigate();
	const create = useMutation(trpc.webRobot.create.mutationOptions());
	const [initial, setInitial] = useState<WebSourceFormInitial>();
	const [formKey, setFormKey] = useState(0);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const handleSubmit = async (input: WebSourceFormSubmit) => {
		setSubmitError(null);
		try {
			const robot = await create.mutateAsync(input);
			await navigate({ to: '/settings/web-sources/$robotId', params: { robotId: robot.id } });
		} catch (error) {
			setSubmitError(error instanceof Error ? error.message : String(error));
		}
	};

	const handlePrefillRecipe = (recipe: WebRobotRecipe, title?: string) => {
		setInitial({ name: title ? `${title} products` : '', recipe, cron: '', enabled: false });
		setFormKey((key) => key + 1);
	};

	return (
		<div className='flex flex-col gap-6'>
			<WebSourceCreateFromUrl
				onCreated={(robotId) => void navigate({ to: '/settings/web-sources/$robotId', params: { robotId } })}
				onPrefillRecipe={handlePrefillRecipe}
			/>
			<WebSourceForm
				key={formKey}
				isCreate
				initial={initial}
				submitLabel='Create web source'
				isPending={create.isPending}
				submitError={submitError}
				onSubmit={handleSubmit}
			/>
		</div>
	);
}
