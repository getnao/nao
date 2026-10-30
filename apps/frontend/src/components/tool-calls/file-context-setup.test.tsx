// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileContextSetup } from './file-context-setup';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('FileContextSetup', () => {
	it('adds and removes Markdown and text files', async () => {
		render(<ControlledFileContextSetup />);
		const file = new File(['Company notes'], 'company.txt', { type: 'text/plain' });

		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [file] },
		});

		await screen.findByText('company.txt');
		fireEvent.click(screen.getByRole('button', { name: 'Remove company.txt' }));
		expect(screen.queryByText('company.txt')).toBeNull();
	});

	it('rejects unsupported files before adding them', async () => {
		render(<ControlledFileContextSetup />);
		const file = new File(['PDF'], 'company.pdf', { type: 'application/pdf' });

		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [file] },
		});

		await screen.findByText('company.pdf must be a Markdown or text file.');
		expect(screen.queryByRole('button', { name: 'Remove company.pdf' })).toBeNull();
	});

	it('shows file fingerprint failures instead of rejecting the event handler promise', async () => {
		const onFilesChange = vi.fn();
		vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('Could not fingerprint company.txt.'));
		render(<FileContextSetup files={[]} disabled={false} error={null} onFilesChange={onFilesChange} />);
		const file = new File(['Company notes'], 'company.txt', { type: 'text/plain' });

		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [file] },
		});

		await screen.findByText('Could not fingerprint company.txt.');
		expect(onFilesChange).not.toHaveBeenCalled();
	});

	it('accepts files dropped onto the source card', async () => {
		const onFilesChange = vi.fn();
		render(<FileContextSetup files={[]} disabled={false} error={null} onFilesChange={onFilesChange} />);
		const file = new File(['# Handbook'], 'handbook.md', { type: 'text/markdown' });

		fireEvent.drop(screen.getByRole('heading', { name: 'Files' }).closest('section')!, {
			dataTransfer: { files: [file] },
		});

		await waitFor(() => expect(onFilesChange).toHaveBeenCalledWith([file]));
	});

	it('keeps at most ten selected files', async () => {
		render(<ControlledFileContextSetup />);
		const files = Array.from(
			{ length: 11 },
			(_, index) => new File([`${index}`], `context-${index + 1}.txt`, { type: 'text/plain' }),
		);

		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files },
		});

		await screen.findByText('You can upload up to 10 business context files.');
		expect(screen.getByText('context-10.txt')).toBeTruthy();
		expect(screen.queryByText('context-11.txt')).toBeNull();
	});

	it('keeps same-name files with matching metadata when their contents differ', async () => {
		render(<ControlledFileContextSetup />);
		const first = new File(['first'], 'notes.txt', { lastModified: 1 });
		const second = new File(['other'], 'notes.txt', { lastModified: 1 });

		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [first, second] },
		});

		await waitFor(() => expect(screen.getAllByText('notes.txt')).toHaveLength(2));
	});

	it('shows an upload failure instead of an older local rejection', async () => {
		const onFilesChange = vi.fn();
		render(
			<FileContextSetup
				files={[]}
				disabled={false}
				error='notes.txt is not valid UTF-8.'
				onFilesChange={onFilesChange}
			/>,
		);
		const file = new File(['PDF'], 'company.pdf', { type: 'application/pdf' });

		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [file] },
		});

		await waitFor(() => expect(onFilesChange).toHaveBeenCalled());
		expect(screen.getByText('notes.txt is not valid UTF-8.')).toBeTruthy();
		expect(screen.queryByText('company.pdf must be a Markdown or text file.')).toBeNull();
	});
});

function ControlledFileContextSetup({ error = null }: { error?: string | null }) {
	const [files, setFiles] = useState<File[]>([]);
	return <FileContextSetup files={files} disabled={false} error={error} onFilesChange={setFiles} />;
}
