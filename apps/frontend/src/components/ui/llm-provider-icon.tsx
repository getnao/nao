import ClaudeIcon from '@/components/icons/claude.svg';
import GoogleIcon from '@/components/icons/google.svg';
import MistralIcon from '@/components/icons/mistral.svg';
import OpenAIIcon from '@/components/icons/openai.svg';
import { cn } from '@/lib/utils';

export function LlmProviderIcon({ provider, className: customClassName }: { provider: string; className?: string }) {
	const className = cn('text-foreground opacity-50', customClassName);
	switch (provider) {
		case 'anthropic':
			return <ClaudeIcon className={className} />;
		case 'openai':
			return <OpenAIIcon className={className} />;
		case 'mistral':
			return <MistralIcon className={className} />;
		case 'google':
			return <GoogleIcon className={className} />;
		default:
			return null;
	}
}
