import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Copy, Check, Ellipsis, ClipboardCopy, FileText, FileDown, Loader2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';
import type { FormEvent, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { trpc, trpcClient } from '@/main';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useAgentMessagesGetter } from '@/contexts/agent.provider';
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
	const [feedbackDialogVote, setFeedbackDialogVote] = useState<FeedbackVote>('down');
	const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
	const [includeErrors, setIncludeErrors] = useState(false);
	const [includeSql, setIncludeSql] = useState(true);
	const [includePython, setIncludePython] = useState(true);
	const [isExportingPdf, setIsExportingPdf] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);
	const { isCopied, copy } = useCopyToClipboard();
	const getAgentMessages = useAgentMessagesGetter();
	const { data: chat } = useQuery(trpc.chat.get.queryOptions({ chatId }));

	const chatTitle = chat?.title ?? 'nao chat';
	const chatMetadata = { title: chatTitle, createdAt: chat?.createdAt, updatedAt: chat?.updatedAt };
	const exportOptions = { includeErrors, includeSql, includePython };

	const buildChatMarkdown = () => {
		const agentMessages = getAgentMessages();
		const chatMessages = agentMessages.length > 0 ? agentMessages : [message];
		return getChatMarkdown(chatMessages, exportOptions, chatMetadata);
	};

	const handleCopyChat = () => copy(buildChatMarkdown());

	const handleExportMarkdown = () => {
		downloadTextFile(`${toFileSlug(chatTitle)}.md`, buildChatMarkdown(), 'text/markdown');
	};

	const handleExportPdf = async () => {
		setIsExportingPdf(true);
		setExportError(null);
		try {
			const result = await trpcClient.chat.download.query({ chatId, format: 'pdf', ...exportOptions });
			downloadBase64File(result.filename, result.data, result.mimeType);
		} catch (error) {
			setExportError(error instanceof Error ? error.message : 'Export failed');
			console.error('Chat PDF export failed:', error);
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
				void ctx.client.invalidateQueries({
					queryKey: trpc.project.getChatReplay.queryKey({ chatId }),
				});
				void ctx.client.invalidateQueries({
					queryKey: trpc.project.getProjectChats.queryKey(),
				});
			},
		}),
	);

	const handlePositiveFeedbackClick = () => {
		setFeedbackDialogVote('up');
		setFeedbackDialogOpen(true);
	};

	const handleNegativeFeedbackClick = () => {
		setFeedbackDialogVote('down');
		setFeedbackDialogOpen(true);
	};

	const handleFeedbackSubmit = (explanation?: string) => {
		submitFeedback.mutate({
			chatId,
			messageId: message.id,
			vote: feedbackDialogVote,
			explanation,
		});
		setFeedbackDialogOpen(false);
	};

	return (
		<>
			<div className={cn('flex items-center gap-1', className)}>
				<Button
					variant='ghost'
					size='icon-sm'
					onClick={handlePositiveFeedbackClick}
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

				{exportError && (
					<p className='text-xs text-destructive max-w-64 truncate' title={exportError}>
						{exportError}
					</p>
				)}
			</div>

			<FeedbackDialog
				open={feedbackDialogOpen}
				onOpenChange={setFeedbackDialogOpen}
				onSubmit={handleFeedbackSubmit}
				isPending={submitFeedback.isPending}
				vote={feedbackDialogVote}
			/>
		</>
	);
}

export type FeedbackVote = 'up' | 'down';

interface FeedbackDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (explanation?: string) => void;
	isPending: boolean;
	vote: FeedbackVote;
}

export function FeedbackDialog({ open, onOpenChange, onSubmit, isPending, vote }: FeedbackDialogProps) {
	const [explanation, setExplanation] = useState('');
	const isPositive = vote === 'up';

	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onSubmit(explanation.trim() || undefined);
		setExplanation('');
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setExplanation('');
		}
		onOpenChange(nextOpen);
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			e.currentTarget.form?.requestSubmit();
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent showCloseButton>
				<DialogHeader>
					<DialogTitle>{isPositive ? 'What went well?' : 'What went wrong?'}</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						{isPositive
							? 'Help us improve by explaining what worked well with this response.'
							: 'Help us improve by explaining what was wrong with this response.'}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
					<Textarea
						placeholder={
							isPositive
								? 'Tell us what worked well (optional)'
								: 'Tell us what could be better (optional)'
						}
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
