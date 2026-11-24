// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomModelDialog } from '@/components/settings/custom-model-dialog';

describe('CustomModelDialog', () => {
	afterEach(cleanup);

	it.each([
		{ typed: '1050000', saved: 1_050_000 },
		{ typed: '', saved: undefined },
		{ typed: '-5', saved: undefined },
	])('saves the context window "$typed" as $saved', ({ typed, saved }) => {
		const onSave = vi.fn();
		render(
			<CustomModelDialog
				open={true}
				onOpenChange={vi.fn()}
				provider='openai'
				modelId='acsw@azure/gpt-6-sol'
				value={{ id: 'acsw@azure/gpt-6-sol', contextWindow: 400_000 }}
				onSave={onSave}
			/>,
		);
		const input = screen.getByLabelText(/Context window/) as HTMLInputElement;
		expect(input.value).toBe('400000');

		fireEvent.change(input, { target: { value: typed } });
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ contextWindow: saved }));
	});
});
