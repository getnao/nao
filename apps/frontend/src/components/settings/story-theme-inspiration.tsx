import { useMutation } from '@tanstack/react-query';
import { FileText, FolderArchive, Globe, Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	MAX_IMAGE_BYTES,
	MAX_PDF_BYTES,
	MAX_SOURCE_IMAGES,
	MAX_ZIP_BYTES,
	SOURCE_IMAGE_MEDIA_TYPES,
} from '@nao/shared/story-theme-source';

import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { SourceImageMediaType } from '@nao/shared/story-theme-source';
import type { RenderedPdf } from '@/components/settings/story-theme-pdf';
import { renderPdfPages, renderZipPdfs } from '@/components/settings/story-theme-pdf';
import { Button } from '@/components/ui/button';
import { Favicon } from '@/components/ui/favicon';
import { NakedInput } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { cn, formatBytes } from '@/lib/utils';
import { trpc } from '@/main';

type GenerateResult = inferRouterOutputs<TrpcRouter>['storyTheme']['generate'];
type FileSourceKind = 'image' | 'pdf' | 'zip';

interface PickedFile {
	name: string;
	size: number;
	mediaType: string;
	data: string;
}

const IMAGE_MEDIA_TYPE_ALIASES: Record<string, SourceImageMediaType> = { 'image/jpg': 'image/jpeg' };
const ZIP_MEDIA_TYPES = ['application/zip', 'application/x-zip-compressed', 'application/x-zip'];
const MAX_BYTES: Record<FileSourceKind, number> = { image: MAX_IMAGE_BYTES, pdf: MAX_PDF_BYTES, zip: MAX_ZIP_BYTES };
const SOURCE_NAMES: Record<FileSourceKind, string> = { image: 'Image', pdf: 'PDF', zip: 'ZIP' };
const WELL_CLASS =
	'flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm';

export interface InspirationOutcome {
	label: string;
}

export function StoryThemeInspiration({
	disabled,
	outcome,
	onGenerated,
	onDismiss,
}: {
	disabled: boolean;
	outcome: InspirationOutcome | null;
	onGenerated: (label: string, result: GenerateResult) => void;
	onDismiss: () => void;
}) {
	const [url, setUrl] = useState('');
	const [image, setImage] = useState<PickedFile | null>(null);
	const [zip, setZip] = useState<PickedFile | null>(null);
	const [pdf, setPdf] = useState<PickedFile | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState(false);

	const onError = (mutationError: { message: string }) => setError(mutationError.message);
	const generateTheme = useMutation({ ...trpc.storyTheme.generate.mutationOptions(), onError });
	const sourceLocked = disabled || running;
	const hasSource = Boolean(url.trim() || image || zip || pdf);
	const canGenerate = hasSource && !sourceLocked;

	const generate = () => {
		if (!canGenerate) {
			return;
		}
		const trimmed = url.trim();
		const normalized = trimmed ? (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) : undefined;
		if (!normalized && !image && !zip && !pdf) {
			return;
		}
		setRunning(true);
		renderPdfSources(pdf, zip).then(
			(pdfs) =>
				generateTheme.mutate(
					{
						url: normalized,
						image: image
							? { data: image.data, mediaType: image.mediaType as SourceImageMediaType }
							: undefined,
						zip: zip ? { data: zip.data, fileName: zip.name } : undefined,
						pdfs,
					},
					{
						onSuccess: (result) => {
							onGenerated(sourceLabel(normalized, image, pdf, zip), result);
							setError(null);
						},
						onSettled: () => {
							setRunning(false);
						},
					},
				),
			() => {
				setError(
					`${pdf?.name ?? 'The PDF'} could not be read. Export it again or use a screenshot of its pages.`,
				);
				setRunning(false);
			},
		);
	};

	return (
		<SettingsCard
			title='Start from a brand'
			description='Read colours, fonts and shapes from a website, an image, a PDF (brand guidelines, a deck) or a ZIP of brand assets — or several together. The result defines the settings below.'
			className={cn('gap-0', outcome && 'overflow-hidden pb-0')}
		>
			<div className='flex flex-col gap-2'>
				<UrlSource url={url} onUrlChange={setUrl} disabled={sourceLocked} onSubmit={generate} />
				<FileSource kind='image' file={image} onFile={setImage} disabled={sourceLocked} setError={setError} />
				<FileSource kind='pdf' file={pdf} onFile={setPdf} disabled={sourceLocked} setError={setError} />
				<FileSource kind='zip' file={zip} onFile={setZip} disabled={sourceLocked} setError={setError} />
				{error && <p className='text-xs text-destructive'>{error}</p>}
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<p className='min-w-0 flex-1 text-xs text-muted-foreground'>
						Paste a URL or screenshot. Use a screenshot for Figma or pages behind a login.
					</p>
					<GenerateButton
						pending={running}
						disabled={!hasSource || disabled}
						onClick={generate}
						label={pendingLabel(url, image, pdf, zip)}
					/>
				</div>
			</div>
			{outcome && (
				<div className='-mx-4 mt-4 flex items-start gap-2 border-t bg-muted/40 px-4 py-3'>
					<div className='min-w-0 flex-1'>
						<p className='text-sm'>
							<Sparkles className='mr-1.5 inline size-3.5 text-muted-foreground' />
							Theme applied from{' '}
							<span className='font-medium' title={outcome.label}>
								{outcome.label}
							</span>
							.
						</p>
					</div>
					<Button
						variant='ghost'
						size='icon'
						className='-mr-1 -mt-1 size-7 shrink-0'
						onClick={onDismiss}
						aria-label='Dismiss'
					>
						<X className='size-3.5' />
					</Button>
				</div>
			)}
		</SettingsCard>
	);
}

function UrlSource({
	url,
	onUrlChange,
	disabled,
	onSubmit,
}: {
	url: string;
	onUrlChange: (url: string) => void;
	disabled: boolean;
	onSubmit: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const preview = websitePreview(url);

	useEffect(() => {
		if (disabled) {
			return;
		}
		const onPaste = (event: ClipboardEvent) => {
			if (isTypingTarget(event.target) || imageFromClipboard(event)) {
				return;
			}
			const pasted = urlFromTransfer(event.clipboardData);
			if (!pasted) {
				return;
			}
			event.preventDefault();
			onUrlChange(pasted);
		};
		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	}, [disabled, onUrlChange]);

	return (
		<div className={cn(WELL_CLASS, disabled && 'pointer-events-none opacity-50')}>
			<div
				className='flex min-w-0 flex-1 cursor-text items-center gap-3'
				onClick={() => inputRef.current?.focus()}
			>
				<span className='flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-background'>
					{preview ? (
						<Favicon
							url={preview.href}
							className='size-10 object-contain'
							fallback={<Globe className='size-4 text-muted-foreground' />}
						/>
					) : (
						<Globe className='size-4 text-muted-foreground' />
					)}
				</span>
				<div className='min-w-0 flex-1'>
					<NakedInput
						ref={inputRef}
						value={url}
						onChange={(event) => onUrlChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								onSubmit();
							}
						}}
						placeholder='acme.com'
						disabled={disabled}
						aria-label='Website URL'
						className='h-5 w-full text-sm placeholder:text-muted-foreground'
					/>
					<p className='truncate text-xs text-muted-foreground/70'>{preview ? preview.host : 'Website'}</p>
				</div>
			</div>
			{url ? <ClearButton disabled={disabled} onClick={() => onUrlChange('')} label='Clear website' /> : null}
		</div>
	);
}

function FileSource({
	kind,
	file,
	onFile,
	disabled,
	setError,
}: {
	kind: FileSourceKind;
	file: PickedFile | null;
	onFile: (file: PickedFile | null) => void;
	disabled: boolean;
	setError: (message: string | null) => void;
}) {
	const [isDragging, setIsDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const isImage = kind === 'image';

	const pick = useCallback(
		(picked: File) => {
			const rejection = rejectionFor(picked, kind);
			if (rejection) {
				setError(rejection);
				return;
			}
			readAsBase64(picked)
				.then((data) => {
					onFile({
						name: picked.name || DEFAULT_FILE_NAMES[kind],
						size: picked.size,
						mediaType: isImage ? imageMediaTypeOf(picked) : picked.type || DEFAULT_MEDIA_TYPES[kind],
						data,
					});
					setError(null);
				})
				.catch(() => setError('The file could not be read.'));
		},
		[isImage, kind, onFile, setError],
	);

	useEffect(() => {
		if (!isImage || disabled) {
			return;
		}
		const onPaste = (event: ClipboardEvent) => {
			const image = imageFromClipboard(event);
			if (!image) {
				return;
			}
			event.preventDefault();
			pick(image);
		};
		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	}, [disabled, isImage, pick]);

	return (
		<div
			className={cn(
				WELL_CLASS,
				disabled && 'pointer-events-none opacity-50',
				isDragging && 'border-foreground/40 bg-accent',
			)}
			onDragEnter={(event) => {
				event.preventDefault();
				if (!disabled) {
					setIsDragging(true);
				}
			}}
			onDragOver={(event) => event.preventDefault()}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) {
					setIsDragging(false);
				}
			}}
			onDrop={(event) => {
				event.preventDefault();
				setIsDragging(false);
				const dropped = event.dataTransfer.files[0];
				if (!disabled && dropped) {
					pick(dropped);
				}
			}}
		>
			<label
				aria-disabled={disabled}
				aria-label={ADD_LABELS[kind]}
				tabIndex={disabled ? -1 : 0}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						inputRef.current?.click();
					}
				}}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-3'
			>
				{file ? (
					<>
						<span className='flex size-10 shrink-0 items-center justify-center rounded bg-background'>
							{isImage ? (
								<img
									src={`data:${file.mediaType};base64,${file.data}`}
									alt=''
									className='size-10 shrink-0 rounded object-cover'
								/>
							) : (
								<SourceIcon kind={kind} />
							)}
						</span>
						<span className='min-w-0 truncate'>
							{file.name}
							<span className='text-muted-foreground'> · {formatBytes(file.size)}</span>
						</span>
					</>
				) : (
					<>
						<div className='flex items-center px-3'>
							<SourceIcon kind={kind} />
						</div>
						<span className='min-w-0 flex-1'>
							<span className='block text-muted-foreground'>{DROP_PROMPTS[kind]}</span>
							<span className='block truncate text-xs text-muted-foreground/70'>
								{acceptedFormatsHint(kind)}
							</span>
						</span>
					</>
				)}
				<input
					ref={inputRef}
					type='file'
					accept={ACCEPTED_TYPES[kind]}
					className='hidden'
					disabled={disabled}
					onChange={(event) => {
						const picked = event.target.files?.[0];
						if (picked) {
							pick(picked);
						}
						event.target.value = '';
					}}
				/>
			</label>
			{file ? <ClearButton disabled={disabled} onClick={() => onFile(null)} label={REMOVE_LABELS[kind]} /> : null}
		</div>
	);
}

const DEFAULT_FILE_NAMES: Record<FileSourceKind, string> = {
	image: 'pasted-image.png',
	pdf: 'brand.pdf',
	zip: 'upload.zip',
};
const DEFAULT_MEDIA_TYPES: Record<FileSourceKind, string> = {
	image: 'image/png',
	pdf: 'application/pdf',
	zip: 'application/zip',
};
const ADD_LABELS: Record<FileSourceKind, string> = { image: 'Add an image', pdf: 'Add a PDF', zip: 'Add a ZIP' };
const REMOVE_LABELS: Record<FileSourceKind, string> = { image: 'Remove image', pdf: 'Remove PDF', zip: 'Remove ZIP' };
const DROP_PROMPTS: Record<FileSourceKind, string> = {
	image: 'Drop, paste or click to add an image',
	pdf: 'Drop or click to add a PDF',
	zip: 'Drop or click to add a ZIP',
};
const ACCEPTED_TYPES: Record<FileSourceKind, string> = {
	image: SOURCE_IMAGE_MEDIA_TYPES.join(','),
	pdf: '.pdf,application/pdf',
	zip: '.zip,application/zip',
};

function SourceIcon({ kind }: { kind: FileSourceKind }) {
	const Icon = kind === 'image' ? ImageIcon : kind === 'pdf' ? FileText : FolderArchive;
	return <Icon className='size-4 shrink-0 text-muted-foreground' />;
}

/** The browser renders PDF pages (the file itself and any PDF inside the ZIP) and sends them as images. */
async function renderPdfSources(pdf: PickedFile | null, zip: PickedFile | null) {
	const standalone = pdf ? [await renderPdfPages(pdf.name, base64ToBytes(pdf.data))] : [];
	const remainingPages = MAX_SOURCE_IMAGES - standalone.reduce((total, item) => total + item.pages.length, 0);
	const fromZip = zip && remainingPages > 0 ? await renderZipPdfs(base64ToBytes(zip.data), remainingPages) : [];
	return [
		...standalone.map((item) => toPdfInput(item, false)),
		...fromZip.map((item) => toPdfInput(item, true)),
	].filter((item) => item.pages.length > 0);
}

function toPdfInput(pdf: RenderedPdf, fromZip: boolean) {
	return { fileName: pdf.fileName, pageCount: pdf.pageCount, pages: pdf.pages, fromZip };
}

function base64ToBytes(data: string): Uint8Array {
	return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

function acceptedFormatsHint(kind: FileSourceKind): string {
	if (kind === 'image') {
		return `PNG, JPEG or WebP · up to ${formatBytes(MAX_IMAGE_BYTES)}`;
	}
	if (kind === 'pdf') {
		return `Brand guidelines or a deck · up to ${formatBytes(MAX_PDF_BYTES)}`;
	}
	return `PDF, CSS, HTML, SVG, JSON, YAML, images · up to ${formatBytes(MAX_ZIP_BYTES)}`;
}

function ClearButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
	return (
		<Button
			type='button'
			variant='ghost'
			size='icon-xs'
			className='shrink-0'
			disabled={disabled}
			onClick={onClick}
			aria-label={label}
		>
			<X className='size-3.5' />
		</Button>
	);
}

function GenerateButton({
	pending,
	disabled,
	onClick,
	label,
}: {
	pending: boolean;
	disabled: boolean;
	onClick: () => void;
	label: string;
}) {
	return (
		<Button
			type='button'
			variant='primary-gradient'
			className='rounded-full transition-colors'
			onClick={onClick}
			disabled={disabled || pending}
			aria-busy={pending}
		>
			{pending ? <Loader2 className='size-3.5 animate-spin' /> : <Sparkles className='size-3.5' />}
			{pending ? label : 'Generate theme'}
		</Button>
	);
}

function sourceLabel(
	url: string | undefined,
	image: PickedFile | null,
	pdf: PickedFile | null,
	zip: PickedFile | null,
): string {
	const parts = [
		url ? displaySourceLabel(url) : null,
		image?.name ?? null,
		pdf?.name ?? null,
		zip?.name ?? null,
	].filter((part): part is string => Boolean(part));
	if (parts.length <= 1) {
		return parts[0] ?? '';
	}
	if (parts.length === 2) {
		return `${parts[0]} and ${parts[1]}`;
	}
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function pendingLabel(url: string, image: PickedFile | null, pdf: PickedFile | null, zip: PickedFile | null): string {
	const count = [url.trim(), image, pdf, zip].filter(Boolean).length;
	if (count > 1) {
		return 'Reading your sources…';
	}
	if (url.trim()) {
		return 'Reading the site…';
	}
	if (image) {
		return 'Reading the image…';
	}
	if (pdf) {
		return 'Reading the PDF…';
	}
	return 'Reading the ZIP…';
}

function displaySourceLabel(label: string): string {
	try {
		const parsed = new URL(label);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return label;
		}
		return parsed.host.replace(/^www\./, '');
	} catch {
		return label;
	}
}

function websitePreview(raw: string): { href: string; host: string } | null {
	const trimmed = raw.trim();
	if (!trimmed || /\s/.test(trimmed)) {
		return null;
	}
	try {
		const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}
		if (parsed.hostname !== 'localhost' && !parsed.hostname.includes('.')) {
			return null;
		}
		return { href: parsed.origin, host: parsed.hostname };
	} catch {
		return null;
	}
}

function urlFromTransfer(data: DataTransfer | null): string | null {
	if (!data) {
		return null;
	}
	const fromList = data
		.getData('text/uri-list')
		.split(/\r?\n/)
		.find((line) => line && !line.startsWith('#'));
	const candidate = (fromList ?? data.getData('text/plain')).trim();
	if (!candidate || /\s/.test(candidate)) {
		return null;
	}
	try {
		const parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}
		return candidate;
	} catch {
		return null;
	}
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function rejectionFor(picked: File, kind: FileSourceKind): string | null {
	const maxBytes = MAX_BYTES[kind];
	if (picked.size > maxBytes) {
		return `${SOURCE_NAMES[kind]} too large (${formatBytes(picked.size)}). Max ${formatBytes(maxBytes)}.`;
	}
	if (kind === 'image' && !isSupportedImage(picked.type)) {
		return 'Use a PNG, JPEG or WebP image.';
	}
	if (kind === 'pdf' && !looksLikePdf(picked)) {
		return 'Use a PDF.';
	}
	if (kind === 'zip' && !looksLikeZip(picked)) {
		return 'Use a ZIP.';
	}
	return null;
}

function looksLikePdf(file: File): boolean {
	return file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name));
}

function isSupportedImage(type: string): boolean {
	return type in IMAGE_MEDIA_TYPE_ALIASES || SOURCE_IMAGE_MEDIA_TYPES.includes(type as SourceImageMediaType);
}

function imageMediaTypeOf(file: File): SourceImageMediaType {
	return IMAGE_MEDIA_TYPE_ALIASES[file.type] ?? ((file.type || 'image/png') as SourceImageMediaType);
}

/** Browsers often report an empty type for ZIPs, so the extension is the fallback. */
function looksLikeZip(file: File): boolean {
	return ZIP_MEDIA_TYPES.includes(file.type) || (!file.type && /\.zip$/i.test(file.name));
}

function imageFromClipboard(event: ClipboardEvent): File | null {
	for (const item of Array.from(event.clipboardData?.items ?? [])) {
		if (item.kind !== 'file' || !isSupportedImage(item.type)) {
			continue;
		}
		const file = item.getAsFile();
		if (!file) {
			continue;
		}
		const type = IMAGE_MEDIA_TYPE_ALIASES[file.type || item.type] ?? (file.type || item.type);
		const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
		if (file.type && file.name) {
			return file;
		}
		return new File([file], file.name || `pasted-image.${extension}`, { type });
	}
	for (const file of Array.from(event.clipboardData?.files ?? [])) {
		if (isSupportedImage(file.type)) {
			return file;
		}
	}
	return null;
}

function readAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			resolve(result.slice(result.indexOf(',') + 1));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}
