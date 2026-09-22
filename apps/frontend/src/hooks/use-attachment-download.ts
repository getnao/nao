import { useMutation } from '@tanstack/react-query';

import { documentExtension } from '@nao/shared/attachments';

import { useSidePanel } from '@/contexts/side-panel';
import { downloadAttachment, fileNameOf } from '@/lib/attachments';
import { trpc } from '@/main';

/**
 * Saves a file out of permanent storage. The bytes never pass through a route that could record
 * the download, so the chat it was taken from is credited from here instead.
 */
export function useAttachmentDownload(path: string) {
	const { chatId } = useSidePanel();
	const logChatDownload = useMutation(trpc.analyticsEvent.logChatDownload.mutationOptions());

	return useMutation({
		mutationFn: () => downloadAttachment(path),
		onSuccess: () => {
			const format = documentExtension(path) ?? 'other';
			if (chatId) {
				logChatDownload.mutate({ chatId, format, title: fileNameOf(path) });
			}
		},
	});
}
