import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Copy, Check, Ellipsis, ClipboardCopy, FileText, FileDown, Loader2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';
import type { FormEvent, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { trpc, trpcClient } from '@/main';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { getMessageMarkdown, getChatMarkdown } from '@/lib/serialize-message';
import { downloadBase64File, downloadTextFile, toFileSlug } from '@/lib/export-chat';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function AssistantMessageActions({
	message,
	className,
	chatId,
}: {
	message: UIMessage;
	className?: string;
	chatId: string;
}) {
	const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
	const [includeErrors, setIncludeErrors] = useState(false);
	const [includeSql, setIncludeSql] = useState(true);
	const [includePython, setIncludePython] = useState(true);
	const [isExportingPdf, setIsExportingPdf] = useState(false);
	const { isCopied, copy } = useCopyToClipboard();
	const agent = useOptionalAgentContext();
	const { data: chat } = useQuery(trpc.chat.get.queryOptions({ chatId }));

	const chatMessages = agent?.messages ?? [message];
	const chatTitle = chat?.title ?? 'nao chat';
	const chatMetadata = { title: chatTitle, createdAt: chat?.createdAt, updatedAt: chat?.updatedAt };
	const exportOptions = { includeErrors, includeSql, includePython };

	const buildChatMarkdown = () => getChatMarkdown(chatMessages, exportOptions, chatMetadata);

	const handleCopyChat = () => copy(buildChatMarkdown());

	const handleExportMarkdown = () => {
		downloadTextFile(`${toFileSlug(chatTitle)}.md`, buildChatMarkdown(), 'text/markdown');
	};

	const handleExportPdf = async () => {
		setIsExportingPdf(true);
		try {
			const result = await trpcClient.chat.download.query({ chatId, format: 'pdf', ...exportOptions });
			downloadBase64File(result.filename, result.data, result.mimeType);
		} finally {
			setIsExportingPdf(false);
		}
	};

	const submitFeedback = useMutation(
		trpc.feedback.submit.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId }), (prev) =>
					prev
						? {
								...prev,
								messages: prev.messages.map((m) =>
									m.id === message.id ? { ...m, feedback: data } : m,
								),
							}
						: prev,
				);
			},
		}),
	);

	const handlePositiveFeedback = () => {
		if (message.feedback?.vote === 'up') {
			return;
		}
		submitFeedback.mutate({
			chatId,
			messageId: message.id,
			vote: 'up',
		});
	};

	const handleNegativeFeedbackClick = () => {
		setShowFeedbackDialog(true);
	};

	const handleNegativeFeedbackSubmit = (explanation?: string) => {
		submitFeedback.mutate({
			chatId,
			messageId: message.id,
			vote: 'down',
			explanation,
		});
		setShowFeedbackDialog(false);
	};

	return (
		<>
			<div className={cn('flex items-center gap-1', className)}>
				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handlePositiveFeedback}
					disabled={submitFeedback.isPending}
					className={cn(
						'hover:rounded-full',
						message.feedback?.vote === 'up' ? 'text-primary' : 'opacity-50 hover:opacity-100',
					)}
					aria-label='Good response'
				>
					<ThumbsUp className='size-4' />
				</Button>

				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handleNegativeFeedbackClick}
					disabled={submitFeedback.isPending}
					className={cn(
						'hover:rounded-full',
						message.feedback?.vote === 'down' ? 'text-primary' : 'opacity-50 hover:opacity-100',
					)}
					aria-label='Bad response'
				>
					<ThumbsDown className='size-4' />
				</Button>

				<Button
					variant='ghost'
					size='icon-sm'
					onClick={() => copy(getMessageMarkdown(message, exportOptions))}
					className='opacity-50 hover:opacity-100 hover:rounded-full'
					aria-label='Copy message'
				>
					{isCopied ? <Check className='size-4' /> : <Copy className='size-4' />}
				</Button>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant='ghost'
							size='icon-sm'
							className='opacity-50 hover:opacity-100 hover:rounded-full'
							aria-label='More actions'
						>
							<Ellipsis className='size-4' />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='start' className='min-w-56'>
						<label
							className='flex items-center justify-between gap-4 px-2 py-1.5 text-xs font-medium cursor-pointer select-none'
							onClick={(e) => e.stopPropagation()}
						>
							<span>Include errors</span>
							<Switch checked={includeErrors} onCheckedChange={setIncludeErrors} />
						</label>
						<label
							className='flex items-center justify-between gap-4 px-2 py-1.5 text-xs font-medium cursor-pointer select-none'
							onClick={(e) => e.stopPropagation()}
						>
							<span>Include SQL</span>
							<Switch checked={includeSql} onCheckedChange={setIncludeSql} />
						</label>
						<label
							className='flex items-center justify-between gap-4 px-2 py-1.5 text-xs font-medium cursor-pointer select-none'
							onClick={(e) => e.stopPropagation()}
						>
							<span>Include Python</span>
							<Switch checked={includePython} onCheckedChange={setIncludePython} />
						</label>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={handleCopyChat}>
							<ClipboardCopy />
							<span>Copy chat to Markdown</span>
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={handleExportMarkdown}>
							<FileText />
							<span>Export chat to Markdown</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={isExportingPdf}
							onSelect={(e) => {
								e.preventDefault();
								void handleExportPdf();
							}}
						>
							{isExportingPdf ? <Loader2 className='animate-spin' /> : <FileDown />}
							<span>{isExportingPdf ? 'Generating PDF…' : 'Export chat to PDF'}</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<NegativeFeedbackDialog
				open={showFeedbackDialog}
				onOpenChange={setShowFeedbackDialog}
				onSubmit={handleNegativeFeedbackSubmit}
				isPending={submitFeedback.isPending}
			/>
		</>
	);
}

interface NegativeFeedbackDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (explanation?: string) => void;
	isPending: boolean;
}

export function NegativeFeedbackDialog({ open, onOpenChange, onSubmit, isPending }: NegativeFeedbackDialogProps) {
	const [explanation, setExplanation] = useState('');

	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onSubmit(explanation.trim() || undefined);
		setExplanation('');
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			e.currentTarget.form?.requestSubmit();
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton>
				<DialogHeader>
					<DialogTitle>What went wrong?</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						Help us improve by explaining what was wrong with this response.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
					<Textarea
						placeholder='Tell us what could be better (optional)'
						value={explanation}
						onKeyDown={handleKeyDown}
						onChange={(e) => setExplanation(e.target.value)}
						rows={4}
						className='resize-none bg-panel'
					/>

					<Button variant='primary-gradient' className='rounded-full' type='submit' disabled={isPending}>
						Submit
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
