import { ModelParametersFields } from './model-parameters-fields';
import { useModelParameters } from './use-model-parameters';
import type { ModelInferenceSettings } from '@nao/backend/llm';
import type { LlmProvider } from '@nao/shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ModelParametersDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	provider: LlmProvider;
	model: { id: string; name: string };
	value: ModelInferenceSettings | undefined;
	onSave: (settings: ModelInferenceSettings) => void;
}

export function ModelParametersDialog({
	open,
	onOpenChange,
	provider,
	model,
	value,
	onSave,
}: ModelParametersDialogProps) {
	const { controls, values, setValue, errors, hasErrors, buildSettings } = useModelParameters({
		provider,
		modelId: model.id,
		open,
		value,
	});

	const handleSave = () => {
		if (hasErrors) {
			return;
		}
		onSave(buildSettings());
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Model parameters</DialogTitle>
					<DialogDescription className='font-mono text-xs break-all'>{model.name}</DialogDescription>
				</DialogHeader>

				<ModelParametersFields controls={controls} values={values} errors={errors} onValueChange={setValue} />

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' onClick={() => onOpenChange(false)} type='button'>
						Cancel
					</Button>
					<Button size='sm' onClick={handleSave} type='button' disabled={hasErrors}>
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
