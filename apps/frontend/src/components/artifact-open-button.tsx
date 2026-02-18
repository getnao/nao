import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { ArtifactViewer } from '@/components/side-panel/artifact-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useAgentContext } from '@/contexts/agent.provider';
import { findArtifacts, collectArtifactVersions } from '@/lib/artifact.utils';

export function ArtifactOpenButton() {
	const { messages } = useAgentContext();
	const { content, open: openSidePanel } = useSidePanel();
	const artifacts = useMemo(() => findArtifacts(messages), [messages]);

	if (artifacts.length === 0 || content) {
		return null;
	}

	const openArtifact = (artifactId: string) => {
		const versions = collectArtifactVersions(messages, artifactId);
		openSidePanel(<ArtifactViewer artifactId={artifactId} initialVersions={versions} />);
	};

	if (artifacts.length === 1) {
		return (
			<Button
				variant='outline'
				size='icon-sm'
				onClick={() => openArtifact(artifacts[0].id)}
				title={artifacts[0].title}
			>
				<FileText className='size-4' />
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='icon-sm'>
					<FileText className='size-4' />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent align='end'>
				{artifacts.map((artifact) => (
					<DropdownMenuItem key={artifact.id} onClick={() => openArtifact(artifact.id)}>
						<FileText className='size-3.5' />
						<span className='truncate'>{artifact.title}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
