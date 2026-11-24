import {
	BUSINESS_CONTEXT_FILE_ACCEPT,
	BUSINESS_CONTEXT_FILE_EXTENSIONS,
	documentExtension,
	MAX_BUSINESS_CONTEXT_FILES,
	MAX_BUSINESS_CONTEXT_FILE_SIZE_MB,
	MAX_BUSINESS_CONTEXT_TOTAL_SIZE_MB,
} from '@nao/shared/attachments';
import { FileText, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-fields';
import { cn } from '@/lib/utils';

interface FileContextSetupProps {
	files: File[];
	disabled: boolean;
	error: string | null;
	onFilesChange: (files: File[]) => void;
}

export function FileContextSetup({ files, disabled, error, onFilesChange }: FileContextSetupProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [rejection, setRejection] = useState<string | null>(null);

	const addFiles = async (candidates: File[]) => {
		try {
			const nextFiles = [...files];
			const fingerprints = new Set(await Promise.all(files.map(fileFingerprint)));
			let totalSize = files.reduce((total, file) => total + file.size, 0);
			let nextRejection: string | null = null;

			for (const file of candidates) {
				const problem = validateFile(file);
				if (problem) {
					nextRejection = problem;
					continue;
				}
				const fingerprint = await fileFingerprint(file);
				if (fingerprints.has(fingerprint)) {
					continue;
				}
				if (nextFiles.length >= MAX_BUSINESS_CONTEXT_FILES) {
					nextRejection = `You can upload up to ${MAX_BUSINESS_CONTEXT_FILES} business context files.`;
					continue;
				}
				if (totalSize + file.size > MAX_BUSINESS_CONTEXT_TOTAL_SIZE_MB * 1024 * 1024) {
					nextRejection = `Business context files cannot exceed ${MAX_BUSINESS_CONTEXT_TOTAL_SIZE_MB} MB in total.`;
					continue;
				}
				fingerprints.add(fingerprint);
				nextFiles.push(file);
				totalSize += file.size;
			}

			setRejection(nextRejection);
			onFilesChange(nextFiles);
		} catch (caughtError) {
			setRejection(
				caughtError instanceof Error
					? caughtError.message
					: 'Could not read the selected business context files.',
			);
		}
	};

	const handleDrop = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setIsDragging(false);
		if (!disabled) {
			void addFiles(Array.from(event.dataTransfer.files));
		}
	};

	return (
		<section
			className={cn(
				'space-y-4 rounded-xl border bg-muted/20 p-4 transition-colors',
				isDragging && 'border-primary bg-primary/5',
			)}
			onDragEnter={(event) => {
				event.preventDefault();
				if (!disabled) {
					setIsDragging(true);
				}
			}}
			onDragOver={(event) => {
				event.preventDefault();
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setIsDragging(false);
				}
			}}
			onDrop={handleDrop}
		>
			<div className='flex items-center gap-3'>
				<div className='flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs'>
					<Upload className='size-5 text-muted-foreground' aria-hidden />
				</div>
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2'>
						<h3 className='text-sm font-medium'>Files</h3>
						<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
							Optional
						</Badge>
					</div>
					<p className='text-xs text-muted-foreground'>Add Markdown or text documents as business context.</p>
				</div>
				<Button
					type='button'
					variant='outline'
					size='sm'
					onClick={() => inputRef.current?.click()}
					disabled={disabled}
				>
					Add files
				</Button>
				<input
					ref={inputRef}
					type='file'
					accept={BUSINESS_CONTEXT_FILE_ACCEPT}
					multiple
					disabled={disabled}
					aria-label='Upload business context files'
					className='sr-only'
					onChange={(event) => {
						if (event.target.files) {
							void addFiles(Array.from(event.target.files));
						}
						event.target.value = '';
					}}
				/>
			</div>

			<div
				className={cn(
					'rounded-lg border border-dashed px-4 py-3 text-center text-xs text-muted-foreground',
					isDragging && 'border-primary text-foreground',
				)}
			>
				{isDragging ? 'Drop files here' : 'Drop .md or .txt files here'}
				<span className='ml-1 text-muted-foreground/70'>
					· {MAX_BUSINESS_CONTEXT_FILE_SIZE_MB} MB each · {MAX_BUSINESS_CONTEXT_FILES} files /{' '}
					{MAX_BUSINESS_CONTEXT_TOTAL_SIZE_MB} MB total
				</span>
			</div>

			{files.length > 0 && (
				<ul className='space-y-2'>
					{files.map((file, index) => (
						<li
							key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
							className='flex items-center gap-3 rounded-lg border bg-background px-3 py-2'
						>
							<FileText className='size-4 shrink-0 text-muted-foreground' aria-hidden />
							<div className='min-w-0 flex-1'>
								<p className='truncate text-sm font-medium'>{file.name}</p>
								<p className='text-[11px] text-muted-foreground'>{formatFileSize(file.size)}</p>
							</div>
							<Button
								type='button'
								variant='ghost'
								size='icon-xs'
								aria-label={`Remove ${file.name}`}
								disabled={disabled}
								onClick={() => onFilesChange(files.filter((candidate) => candidate !== file))}
							>
								<X aria-hidden />
							</Button>
						</li>
					))}
				</ul>
			)}

			{(error || rejection) && <FormError error={error ?? rejection ?? ''} />}
		</section>
	);
}

function validateFile(file: File): string | null {
	const extension = documentExtension(file.name);
	if (!extension || !(BUSINESS_CONTEXT_FILE_EXTENSIONS as readonly string[]).includes(extension)) {
		return `${file.name} must be a Markdown or text file.`;
	}
	if (file.size > MAX_BUSINESS_CONTEXT_FILE_SIZE_MB * 1024 * 1024) {
		return `${file.name} is larger than the ${MAX_BUSINESS_CONTEXT_FILE_SIZE_MB} MB upload limit.`;
	}
	return null;
}

async function fileFingerprint(file: File): Promise<string> {
	const bytes = Uint8Array.from(new Uint8Array(await readFile(file)));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return `${file.name}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function readFile(file: File): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
		reader.onload = () => {
			if (reader.result instanceof ArrayBuffer) {
				resolve(reader.result);
			} else {
				reject(new Error(`Could not read ${file.name}.`));
			}
		};
		reader.readAsArrayBuffer(file);
	});
}

function formatFileSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}
