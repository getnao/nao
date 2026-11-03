import { pluralize, stripAssistantTags } from '@nao/shared';
import { Actions, Card, type CardChild, LinkButton, type SentMessage, type Thread } from 'chat';

import type { ToolCallEntry } from '../types/messaging-provider';
import { logger } from '../utils/logger';
import {
	countToolsByNoun,
	createCompletionCard,
	createImageBlock,
	createStopButtonActions,
} from '../utils/messaging-provider';

/** Google Chat allows about one message write per second in a space, so streaming updates are throttled below it. */
const STREAMING_UPDATE_INTERVAL_MS = 1500;
const RATE_LIMIT_RETRY_DELAY_MS = 2000;

/** Google Chat rejects messages above 4,096 characters; the rest of the answer stays readable in nao. */
const MAX_TEXT_LENGTH = 4000;

const CODE_SPAN_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/;

/**
 * One answer in Google Chat, rendered as two messages: the answer text, which Google Chat formats natively, and a
 * card below it holding the charts and buttons. Card text does not render Markdown, which is why
 * the text is not part of the card. The card is edited rather than replaced, so no "message deleted" trace is left.
 */
export class GoogleChatAnswer {
	private _segments: string[] = [];
	private _textSegmentIndex = -1;
	private _toolSegmentIndex = -1;
	private _imageUrls: string[] = [];
	private _sentText = '';
	private _sentImageCount = 0;
	private _lastUpdateAt = 0;
	private _updateInFlight: Promise<void> | null = null;

	private constructor(
		private readonly _threadId: string,
		private readonly _textMessage: SentMessage,
		private readonly _controlsCard: SentMessage,
		private readonly _appName: string,
	) {}

	public static async start(thread: Thread, appName: string): Promise<GoogleChatAnswer> {
		const textMessage = await thread.post(`✨ ${appName} is answering...`);
		const controlsCard = await thread.post(Card({ children: [createStopButtonActions()] }));
		return new GoogleChatAnswer(thread.id, textMessage, controlsCard, appName);
	}

	public setText(text: string): void {
		const segment = stripAssistantTags(text).trim();
		if (this._textSegmentIndex === -1) {
			this._textSegmentIndex = this._segments.length;
			this._segments.push(segment);
		} else {
			this._segments[this._textSegmentIndex] = segment;
		}
	}

	public setToolActivity(toolGroup: Map<string, ToolCallEntry>, isDone: boolean): void {
		const segment = `_${isDone ? 'Explored' : 'Exploring'} ${describeToolCounts(toolGroup)}${isDone ? '.' : '…'}_`;
		if (this._toolSegmentIndex === -1) {
			this._toolSegmentIndex = this._segments.length;
			this._segments.push(segment);
		} else {
			this._segments[this._toolSegmentIndex] = segment;
		}
		if (isDone) {
			this._toolSegmentIndex = -1;
			this._textSegmentIndex = -1;
		}
	}

	public appendText(markdown: string): void {
		this._segments.push(markdown);
		this._textSegmentIndex = -1;
	}

	public addImage(imageUrl: string): void {
		this._imageUrls.push(imageUrl);
	}

	/**
	 * Shows the latest state while streaming, without waiting for Google Chat. An update is skipped, not delayed,
	 * while the previous one is running or was sent less than an interval ago: `finish` sends the final state anyway.
	 */
	public update(): void {
		if (this._updateInFlight || Date.now() - this._lastUpdateAt < STREAMING_UPDATE_INTERVAL_MS) {
			return;
		}
		const write = this._nextStreamingWrite();
		if (!write) {
			return;
		}
		this._lastUpdateAt = Date.now();
		this._updateInFlight = write()
			.catch((error: unknown) => {
				logger.error(`Google Chat streaming update failed: ${String(error)}`, {
					source: 'system',
					context: { threadId: this._threadId },
				});
			})
			.finally(() => {
				this._updateInFlight = null;
			});
	}

	public async finish(chatUrl: string, vote?: 'up' | 'down'): Promise<void> {
		await this._updateInFlight;
		if (!this.renderText()) {
			this.appendText(this._imageUrls.length > 0 ? 'Here is what I found:' : 'No answer was produced.');
		}
		await this._sendFinalText();
		const completion = createCompletionCard(chatUrl, { vote, appName: this._appName });
		await this._sendFinalCard([...this._imageBlocks(), ...completion.children]);
	}

	/** Keeps an older answer's charts and nao link, but drops its feedback buttons once a newer answer exists. */
	public async retire(chatUrl: string): Promise<void> {
		const openInApp = Actions([LinkButton({ url: chatUrl, label: `Open in ${this._appName}` })]);
		await this._sendFinalCard([...this._imageBlocks(), openInApp]);
	}

	/** Ends an answer that never reached a saved chat: there is no nao link to offer, so the Stop card goes away. */
	public async abandon(): Promise<void> {
		await this._updateInFlight;
		await this._sendFinalText();
		await retryOnceWhenRateLimited(() => {
			return this._controlsCard.delete();
		});
	}

	public renderText(): string {
		const text = toGoogleChatText(this._segments.filter(Boolean).join('\n\n'));
		if (text.length <= MAX_TEXT_LENGTH) {
			return text;
		}
		return `${text.slice(0, MAX_TEXT_LENGTH).trimEnd()}…\n\n_The full answer is available in ${this._appName}._`;
	}

	/** The text goes first; new charts wait for the next update. Google Chat rejects empty text, so it is never sent. */
	private _nextStreamingWrite(): (() => Promise<void>) | null {
		const text = this.renderText();
		if (text && text !== this._sentText) {
			return () => {
				return this._editText(text);
			};
		}
		if (this._imageUrls.length > this._sentImageCount) {
			const imageCount = this._imageUrls.length;
			return () => {
				return this._editCard([...this._imageBlocks(), createStopButtonActions()], imageCount);
			};
		}
		return null;
	}

	private async _sendFinalText(): Promise<void> {
		const text = this.renderText();
		if (!text || text === this._sentText) {
			return;
		}
		await retryOnceWhenRateLimited(() => {
			return this._editText(text);
		});
	}

	private async _sendFinalCard(children: CardChild[]): Promise<void> {
		await retryOnceWhenRateLimited(() => {
			return this._editCard(children, this._imageUrls.length);
		});
	}

	private async _editText(text: string): Promise<void> {
		await this._textMessage.edit({ raw: text });
		this._sentText = text;
	}

	private async _editCard(children: CardChild[], imageCount: number): Promise<void> {
		await this._controlsCard.edit(Card({ children }));
		this._sentImageCount = imageCount;
	}

	private _imageBlocks(): CardChild[] {
		return this._imageUrls.map((imageUrl) => createImageBlock(imageUrl));
	}
}

/** The final edits are what the user keeps, so one rate-limited attempt is retried once the quota frees up. */
async function retryOnceWhenRateLimited(write: () => Promise<unknown>): Promise<void> {
	try {
		await write();
	} catch (error) {
		if (!isRateLimitError(error)) {
			throw error;
		}
		await new Promise((resolve) => {
			setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS);
		});
		await write();
	}
}

function isRateLimitError(error: unknown): boolean {
	return error instanceof Error && (error.name === 'AdapterRateLimitError' || /rate limit/i.test(error.message));
}

function describeToolCounts(toolGroup: Map<string, ToolCallEntry>): string {
	const parts = [...countToolsByNoun(toolGroup).entries()].map(
		([noun, count]) => `${count} ${pluralize(noun, count)}`,
	);
	return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join('');
}

/**
 * Google Chat reads `**bold**`, `*italic*`, `_italic_`, inline code and code blocks like Markdown, but has its own
 * syntax for links and bullets and no headings. Code is left untouched.
 */
function toGoogleChatText(markdown: string): string {
	return markdown
		.split(CODE_SPAN_PATTERN)
		.map((part, index) => (index % 2 === 1 ? part : convertMarkdownOutsideCode(part)))
		.join('');
}

function convertMarkdownOutsideCode(text: string): string {
	return text
		.replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
		.replace(/__(.+?)__/g, '**$1**')
		.replace(/~~(.+?)~~/g, '~$1~')
		.replace(/^(\s*)[-*+]\s+/gm, '$1• ')
		.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<$2|$1>');
}
