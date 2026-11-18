import { joinWithAnd } from '@nao/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, Globe, Loader2, PenLine, Sparkles, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	cleanDocumentText,
	MAX_DOCUMENT_BYTES,
	MAX_DOCUMENT_PROMPT_CHARACTERS,
	MAX_IMAGE_BYTES,
	MAX_PDF_BYTES,
	MAX_SOURCE_IMAGES,
	MAX_THEME_INSTRUCTIONS_LENGTH,
	MAX_ZIP_BYTES,
	SOURCE_IMAGE_MEDIA_TYPES,
} from '@nao/shared/story-theme-source';

import { describeStoryThemeSources } from '@nao/shared/story-theme-generation';
import { STORY_LOGO_MEDIA_TYPES } from '@nao/shared/story-theme';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { SourceImageMediaType } from '@nao/shared/story-theme-source';
import type { StoryThemeGeneration } from '@nao/shared/story-theme-generation';
import type { StoryLogoMediaType } from '@nao/shared/story-theme';
import type { RenderedPdf } from '@/components/settings/story-theme-pdf';
import type { ViewedThemeVersion } from '@/components/settings/story-theme-recorded-sources';
import { renderPdfPages, renderZipPdfs } from '@/components/settings/story-theme-pdf';
import {
	GenerationSummary,
	RecordedSources,
	SOURCE_ICONS,
	WELL_CLASS,
} from '@/components/settings/story-theme-recorded-sources';
import { Button } from '@/components/ui/button';
import { Favicon } from '@/components/ui/favicon';
import { Switch } from '@/components/ui/switch';
import { NakedInput } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatBytes } from '@/lib/utils';
import { trpc } from '@/main';

export type GenerateResult = inferRouterOutputs<TrpcRouter>['storyTheme']['generate'];
type FileSourceKind = 'image' | 'pdf' | 'document' | 'zip';

interface PickedFile {
	name: string;
	size: number;
	mediaType: string;
	data: string;
	/** Characters a document holds once cleaned, when more than nao reads. */
	truncatedFrom?: number;
}

type PickedFiles = Partial<Record<FileSourceKind, PickedFile>>;
type AcceptedFile = { kind: FileSourceKind; file: PickedFile };
type PickOutcome = AcceptedFile | { rejection: string };

const FILE_SOURCE_KINDS: FileSourceKind[] = ['image', 'pdf', 'document', 'zip'];
const IMAGE_MEDIA_TYPE_ALIASES: Record<string, SourceImageMediaType> = { 'image/jpg': 'image/jpeg' };
const ZIP_MEDIA_TYPES = ['application/zip', 'application/x-zip-compressed', 'application/x-zip'];
const DOCUMENT_MEDIA_TYPES = ['text/markdown', 'text/x-markdown', 'text/plain'];
const DOCUMENT_EXTENSION = /\.(md|markdown|txt)$/i;
const ACCEPTED_FILE_TYPES = [
	...SOURCE_IMAGE_MEDIA_TYPES,
	'.pdf',
	'application/pdf',
	'.zip',
	...ZIP_MEDIA_TYPES,
	'.md',
	'.markdown',
	'.txt',
	...DOCUMENT_MEDIA_TYPES,
].join(',');
const MAX_BYTES: Record<FileSourceKind, number> = {
	image: MAX_IMAGE_BYTES,
	pdf: MAX_PDF_BYTES,
	document: MAX_DOCUMENT_BYTES,
	zip: MAX_ZIP_BYTES,
};
const MAX_SOURCE_FILE_NAME_LENGTH = 200;
const SOURCE_NAMES: Record<FileSourceKind, string> = { image: 'Image', pdf: 'PDF', document: 'Document', zip: 'ZIP' };
const TEXT_WELL_CLASS = cn(WELL_CLASS, 'border-solid transition-colors focus-within:border-foreground/30');
const PICKED_FILE_CLASS = 'flex min-w-0 items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm';

export interface InspirationOutcome {
	label: string;
	generation: StoryThemeGeneration | null;
}

export function StoryThemeInspiration({
	disabled,
	outcome,
	viewedVersion,
	onGenerated,
	onDismiss,
	onLeaveVersion,
	logo,
}: {
	disabled: boolean;
	outcome: InspirationOutcome | null;
	viewedVersion: ViewedThemeVersion | null;
	onGenerated: (label: string, result: GenerateResult) => void;
	onDismiss: () => void;
	onLeaveVersion: () => void;
	/** The logo set in the Brand header card, sent along as a source so the model reads it. */
	logo: string | null;
}) {
	const [url, setUrl] = useState('');
	const [files, setFiles] = useState<PickedFiles>({});
	const { image, pdf, zip, document: brandDocument } = files;
	const [instructions, setInstructions] = useState('');
	const [useWhiteLabel, setUseWhiteLabel] = useState(true);
	const whiteLabel = useWhiteLabelSource();
	const readsWhiteLabel = whiteLabel !== null && useWhiteLabel;
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState(false);

	const onError = (mutationError: { message: string }) => setError(mutationError.message);
	const generateTheme = useMutation({ ...trpc.storyTheme.generate.mutationOptions(), onError });
	const sourceLocked = disabled || running;
	const logoInput = logoSource(logo);
	const hasFile = FILE_SOURCE_KINDS.some((kind) => files[kind]);
	const hasSource = Boolean(url.trim() || hasFile || instructions.trim() || readsWhiteLabel || logoInput);
	const canGenerate = hasSource && !sourceLocked;

	const addFiles = useCallback((accepted: AcceptedFile[]) => {
		setFiles((current) => ({ ...current, ...Object.fromEntries(accepted.map(({ kind, file }) => [kind, file])) }));
	}, []);

	const removeFile = useCallback((kind: FileSourceKind) => {
		setFiles((current) => ({ ...current, [kind]: undefined }));
	}, []);

	const generate = () => {
		if (!canGenerate) {
			return;
		}
		const trimmed = url.trim();
		const trimmedInstructions = instructions.trim();
		const normalized = trimmed ? (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) : undefined;
		if (!normalized && !hasFile && !trimmedInstructions && !readsWhiteLabel && !logoInput) {
			return;
		}
		setRunning(true);
		renderPdfSources(pdf ?? null, zip ?? null).then(
			(pdfs) =>
				generateTheme.mutate(
					{
						url: normalized,
						image: image
							? {
									data: image.data,
									mediaType: image.mediaType as SourceImageMediaType,
									fileName: toSourceFileName(image.name, DEFAULT_FILE_NAMES.image),
								}
							: undefined,
						zip: zip ? { data: zip.data, fileName: toSourceFileName(zip.name, 'brand.zip') } : undefined,
						logo: logoInput,
						pdfs,
						document: brandDocument
							? {
									fileName: toSourceFileName(brandDocument.name, DEFAULT_FILE_NAMES.document),
									text: brandDocument.data,
								}
							: undefined,
						instructions: trimmedInstructions || undefined,
						useWhiteLabel: readsWhiteLabel,
					},
					{
						onSuccess: (result) => {
							onGenerated(
								sourceLabel(
									normalized,
									files,
									trimmedInstructions,
									readsWhiteLabel ? whiteLabel : null,
									Boolean(logoInput),
								),
								result,
							);
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
			description='Describe the theme you want, then optionally add a website or brand files (images, PDF, ZIP, Markdown or text) so nao can ground it in brand assets.'
			className={cn('gap-0', (outcome || viewedVersion) && 'overflow-hidden pb-0')}
		>
			{viewedVersion ? (
				<RecordedSources version={viewedVersion} onLeave={onLeaveVersion} />
			) : (
				<div className='flex flex-col gap-2'>
					<InstructionSource value={instructions} onChange={setInstructions} disabled={sourceLocked} />
					<UrlSource url={url} onUrlChange={setUrl} disabled={sourceLocked} onSubmit={generate} />
					<BrandFilesSource
						files={files}
						onAdd={addFiles}
						onRemove={removeFile}
						disabled={sourceLocked}
						setError={setError}
					/>
					{whiteLabel && (
						<WhiteLabelSource
							source={whiteLabel}
							checked={useWhiteLabel}
							onCheckedChange={setUseWhiteLabel}
							disabled={sourceLocked}
						/>
					)}
					{error && <p className='text-xs text-destructive'>{error}</p>}
					<div className='flex flex-wrap items-center justify-between gap-3'>
						<p className='min-w-0 flex-1 text-xs text-muted-foreground'>
							Assets are optional but help with exact colours, typography and shape language.
						</p>
						<GenerateButton
							pending={running}
							disabled={!hasSource || disabled}
							onClick={generate}
							label={pendingLabel(
								url,
								files,
								instructions,
								readsWhiteLabel ? whiteLabel : null,
								Boolean(logoInput),
							)}
						/>
					</div>
				</div>
			)}
			{viewedVersion ? (
				<GenerationSummary
					sentence={describeViewedThemeVersion(viewedVersion)}
					generation={viewedVersion.generation}
				/>
			) : (
				outcome && (
					<GenerationSummary
						sentence={`Theme applied from ${outcome.label}.`}
						generation={outcome.generation}
						onDismiss={onDismiss}
					/>
				)
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
		<div className={cn(TEXT_WELL_CLASS, disabled && 'pointer-events-none opacity-50')}>
			<div
				className='flex min-w-0 flex-1 cursor-text items-center gap-3'
				onClick={() => inputRef.current?.focus()}
			>
				<span className='flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-transparent'>
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

/** One drop zone for every file format; each kind keeps one file, so a new image replaces the previous one. */
function BrandFilesSource({
	files,
	onAdd,
	onRemove,
	disabled,
	setError,
}: {
	files: PickedFiles;
	onAdd: (accepted: AcceptedFile[]) => void;
	onRemove: (kind: FileSourceKind) => void;
	disabled: boolean;
	setError: (message: string | null) => void;
}) {
	const [isDragging, setIsDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const add = useCallback(
		(picked: File[]) => {
			Promise.all(picked.map(toPickOutcome)).then((outcomes) => {
				const accepted = outcomes.flatMap((outcome) => ('rejection' in outcome ? [] : [outcome]));
				const rejections = outcomes.flatMap((outcome) => ('rejection' in outcome ? [outcome.rejection] : []));
				if (accepted.length > 0) {
					onAdd(accepted);
				}
				setError(rejections.length > 0 ? rejections.join(' ') : null);
			});
		},
		[onAdd, setError],
	);

	useEffect(() => {
		if (disabled) {
			return;
		}
		const onPaste = (event: ClipboardEvent) => {
			const image = imageFromClipboard(event);
			if (!image) {
				return;
			}
			event.preventDefault();
			add([image]);
		};
		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	}, [disabled, add]);

	return (
		<>
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
					const dropped = Array.from(event.dataTransfer.files);
					if (!disabled && dropped.length > 0) {
						add(dropped);
					}
				}}
			>
				<label
					aria-disabled={disabled}
					aria-label='Add brand files'
					tabIndex={disabled ? -1 : 0}
					onKeyDown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							inputRef.current?.click();
						}
					}}
					className='flex min-w-0 flex-1 cursor-pointer items-center gap-3'
				>
					<div className='flex items-center px-3'>
						<Upload className='size-4 shrink-0 text-muted-foreground' />
					</div>
					<span className='min-w-0 flex-1'>
						<span className='block text-muted-foreground'>Drop, paste or click to add brand files</span>
						<span className='block truncate text-xs text-muted-foreground/70'>
							Image, PDF, ZIP, Markdown or text · one of each
						</span>
					</span>
					<input
						ref={inputRef}
						type='file'
						multiple
						accept={ACCEPTED_FILE_TYPES}
						className='hidden'
						disabled={disabled}
						onChange={(event) => {
							const picked = Array.from(event.target.files ?? []);
							if (picked.length > 0) {
								add(picked);
							}
							event.target.value = '';
						}}
					/>
				</label>
			</div>
			{FILE_SOURCE_KINDS.map((kind) => {
				const file = files[kind];
				return file ? (
					<PickedFileRow
						key={kind}
						kind={kind}
						file={file}
						disabled={disabled}
						onRemove={() => onRemove(kind)}
					/>
				) : null;
			})}
		</>
	);
}

function PickedFileRow({
	kind,
	file,
	disabled,
	onRemove,
}: {
	kind: FileSourceKind;
	file: PickedFile;
	disabled: boolean;
	onRemove: () => void;
}) {
	return (
		<div className={cn(PICKED_FILE_CLASS, disabled && 'pointer-events-none opacity-50')}>
			<span className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded'>
				{kind === 'image' ? (
					<img src={`data:${file.mediaType};base64,${file.data}`} alt='' className='size-8 object-cover' />
				) : (
					<SourceIcon kind={kind} />
				)}
			</span>
			<span className='min-w-0 flex-1 truncate'>
				{file.name}
				<span className='text-muted-foreground'>
					{' '}
					· {SOURCE_NAMES[kind]} · {formatBytes(file.size)}
					{file.truncatedFrom ? ` · ${describeTruncation(file.truncatedFrom)}` : null}
				</span>
			</span>
			<ClearButton disabled={disabled} onClick={onRemove} label={REMOVE_LABELS[kind]} />
		</div>
	);
}

function describeTruncation(characters: number): string {
	return `first ${MAX_DOCUMENT_PROMPT_CHARACTERS.toLocaleString('en-US')} of ${characters.toLocaleString('en-US')} characters read`;
}

function InstructionSource({
	value,
	onChange,
	disabled,
}: {
	value: string;
	onChange: (value: string) => void;
	disabled: boolean;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	return (
		<div className={cn(TEXT_WELL_CLASS, 'items-start', disabled && 'pointer-events-none opacity-50')}>
			<div
				className='flex min-w-0 flex-1 cursor-text items-start gap-3'
				onClick={() => textareaRef.current?.focus()}
			>
				<span className='mt-1 flex size-10 shrink-0 items-center justify-center'>
					<PenLine className='size-4 text-muted-foreground' />
				</span>
				<div className='min-w-0 flex-1 py-1'>
					<Textarea
						ref={textareaRef}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						placeholder='Dark and premium, navy with an amber accent, square cards, no purple.'
						disabled={disabled}
						maxLength={MAX_THEME_INSTRUCTIONS_LENGTH}
						aria-label='Theme instructions'
						className='resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0 dark:bg-transparent md:text-sm'
					/>
					<p className='truncate text-xs text-muted-foreground/70'>
						Instructions · take priority over the sources below
					</p>
				</div>
			</div>
			{value ? (
				<ClearButton
					className='mt-1'
					disabled={disabled}
					onClick={() => onChange('')}
					label='Clear instructions'
				/>
			) : null}
		</div>
	);
}

const DEFAULT_FILE_NAMES: Record<FileSourceKind, string> = {
	image: 'pasted-image.png',
	pdf: 'brand.pdf',
	document: 'brand.md',
	zip: 'upload.zip',
};
const DEFAULT_MEDIA_TYPES: Record<FileSourceKind, string> = {
	image: 'image/png',
	pdf: 'application/pdf',
	document: 'text/markdown',
	zip: 'application/zip',
};
const REMOVE_LABELS: Record<FileSourceKind, string> = {
	image: 'Remove image',
	pdf: 'Remove PDF',
	document: 'Remove document',
	zip: 'Remove ZIP',
};
const READING_LABELS: Record<FileSourceKind, string> = {
	image: 'Reading the image…',
	pdf: 'Reading the PDF…',
	document: 'Reading the document…',
	zip: 'Reading the ZIP…',
};

function SourceIcon({ kind }: { kind: FileSourceKind }) {
	const Icon = SOURCE_ICONS[kind];
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
	return {
		fileName: toSourceFileName(pdf.fileName, 'document.pdf'),
		pageCount: pdf.pageCount,
		pages: pdf.pages,
		fromZip,
	};
}

/** The server accepts names up to this length; a longer or blank one must not fail an otherwise valid source. */
function toSourceFileName(name: string, fallback: string): string {
	return name.trim().slice(0, MAX_SOURCE_FILE_NAME_LENGTH) || fallback;
}

function base64ToBytes(data: string): Uint8Array {
	return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

function ClearButton({
	disabled,
	onClick,
	label,
	className,
}: {
	disabled: boolean;
	onClick: () => void;
	label: string;
	className?: string;
}) {
	return (
		<Button
			type='button'
			variant='ghost'
			size='icon-xs'
			className={cn('shrink-0', className)}
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

function describeViewedThemeVersion({ label, generation }: ViewedThemeVersion): string {
	if (!generation) {
		return `${label} was set by hand.`;
	}
	const edited = generation.editedByHand ? ', then edited by hand' : '';
	return `${label} was generated from ${describeStoryThemeSources(generation.sources)}${edited}.`;
}

const LOGO_DATA_URI = /^data:([^;,]+);base64,(.+)$/;

function logoSource(logo: string | null) {
	const match = logo?.match(LOGO_DATA_URI);
	const mediaType = match?.[1] as StoryLogoMediaType | undefined;
	if (!match || !mediaType || !STORY_LOGO_MEDIA_TYPES.includes(mediaType)) {
		return undefined;
	}
	return { data: match[2], mediaType, fileName: 'Brand header logo' };
}

interface WhiteLabelSourceInfo {
	name: string;
	hasName: boolean;
	brandColor: string | null;
	logoUrl: string | null;
}

/** The white-label identity, when this instance has one worth reading. */
function useWhiteLabelSource(): WhiteLabelSourceInfo | null {
	const state = useQuery(trpc.storyTheme.getState.queryOptions());
	const identity = state.data?.whiteLabelIdentity;
	if (!identity) {
		return null;
	}
	return {
		name: identity.name || 'White-label settings',
		hasName: Boolean(identity.name),
		brandColor: identity.brandColor,
		logoUrl: identity.logo,
	};
}

function WhiteLabelSource({
	source,
	checked,
	onCheckedChange,
	disabled,
}: {
	source: WhiteLabelSourceInfo;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled: boolean;
}) {
	const details = [source.hasName ? 'brand name' : 'white-label', source.brandColor, source.logoUrl ? 'logo' : null]
		.filter(Boolean)
		.join(' · ');
	return (
		<div className={cn(WELL_CLASS, 'border-solid', disabled && 'pointer-events-none opacity-50')}>
			<span className='flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md'>
				{source.logoUrl ? (
					<img src={source.logoUrl} alt='' className='max-h-8 max-w-8 object-contain' />
				) : (
					<BadgeCheck className='size-4 text-muted-foreground' />
				)}
			</span>
			<div className='min-w-0 flex-1'>
				<p className='truncate'>{source.name}</p>
				<p className='flex items-center gap-1.5 truncate text-xs text-muted-foreground'>
					{source.brandColor && (
						<span className='size-2.5 shrink-0 rounded-full' style={{ background: source.brandColor }} />
					)}
					{details}
				</p>
			</div>
			<Switch
				checked={checked}
				onCheckedChange={onCheckedChange}
				disabled={disabled}
				aria-label='Use the white-label branding'
			/>
		</div>
	);
}

function sourceLabel(
	url: string | undefined,
	files: PickedFiles,
	instructions: string,
	whiteLabel: WhiteLabelSourceInfo | null,
	hasLogo: boolean,
): string {
	const parts = [
		url ? displaySourceLabel(url) : null,
		...FILE_SOURCE_KINDS.map((kind) => files[kind]?.name ?? null),
		instructions ? 'instructions' : null,
		whiteLabel ? whiteLabelSourceLabel(whiteLabel) : null,
		hasLogo ? 'the logo' : null,
	].filter((part): part is string => Boolean(part));
	return joinWithAnd(parts);
}

function pendingLabel(
	url: string,
	files: PickedFiles,
	instructions: string,
	whiteLabel: WhiteLabelSourceInfo | null,
	hasLogo: boolean,
): string {
	const pickedKinds = FILE_SOURCE_KINDS.filter((kind) => files[kind]);
	const count = [url.trim(), instructions.trim(), whiteLabel, hasLogo].filter(Boolean).length + pickedKinds.length;
	if (count > 1) {
		return 'Reading your sources…';
	}
	if (url.trim()) {
		return 'Reading the site…';
	}
	if (pickedKinds[0]) {
		return READING_LABELS[pickedKinds[0]];
	}
	if (instructions.trim()) {
		return 'Applying instructions…';
	}
	if (whiteLabel) {
		return `Reading ${whiteLabelSourceLabel(whiteLabel)}…`;
	}
	if (hasLogo) {
		return 'Reading the logo…';
	}
	return 'Generating theme…';
}

function whiteLabelSourceLabel(source: WhiteLabelSourceInfo): string {
	const parts = [
		source.hasName ? 'brand name' : null,
		source.logoUrl ? 'logo' : null,
		source.brandColor ? 'brand colour' : null,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? `the ${joinWithAnd(parts)}` : 'the white-label settings';
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

async function toPickOutcome(picked: File): Promise<PickOutcome> {
	const kind = fileSourceKindOf(picked);
	if (!kind) {
		return { rejection: unsupportedFileMessage(picked) };
	}
	const name = picked.name || DEFAULT_FILE_NAMES[kind];
	const maxBytes = MAX_BYTES[kind];
	if (picked.size > maxBytes) {
		return {
			rejection: `${name} is too large (${formatBytes(picked.size)}). ${SOURCE_NAMES[kind]} files are limited to ${formatBytes(maxBytes)}.`,
		};
	}
	try {
		const mediaType = kind === 'image' ? imageMediaTypeOf(picked) : picked.type || DEFAULT_MEDIA_TYPES[kind];
		if (kind !== 'document') {
			return { kind, file: { name, size: picked.size, mediaType, data: await readAsBase64(picked) } };
		}
		const text = cleanDocumentText(await picked.text());
		if (!text) {
			return { rejection: `${name} is empty.` };
		}
		return { kind, file: { name, size: picked.size, mediaType, ...fitDocumentText(text) } };
	} catch {
		return { rejection: `${name} could not be read.` };
	}
}

/** Only what the model reads is uploaded; the row says when the rest is left out. */
function fitDocumentText(text: string): Pick<PickedFile, 'data' | 'truncatedFrom'> {
	return text.length > MAX_DOCUMENT_PROMPT_CHARACTERS
		? { data: text.slice(0, MAX_DOCUMENT_PROMPT_CHARACTERS), truncatedFrom: text.length }
		: { data: text };
}

function fileSourceKindOf(file: File): FileSourceKind | null {
	if (isSupportedImage(file.type)) {
		return 'image';
	}
	if (looksLikePdf(file)) {
		return 'pdf';
	}
	if (looksLikeZip(file)) {
		return 'zip';
	}
	if (looksLikeDocument(file)) {
		return 'document';
	}
	return null;
}

function unsupportedFileMessage(file: File): string {
	const name = file.name || 'That file';
	if (file.type.startsWith('image/')) {
		return `${name}: use a PNG, JPEG or WebP image.`;
	}
	return `${name} is not a format nao reads. Add an image, a PDF, a ZIP, or a Markdown or text file.`;
}

function looksLikeDocument(file: File): boolean {
	return DOCUMENT_MEDIA_TYPES.includes(file.type) || DOCUMENT_EXTENSION.test(file.name);
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
