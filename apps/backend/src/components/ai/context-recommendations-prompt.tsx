import { DBContextRecommendation } from '../../db/abstractSchema';
import { Block, Code, List, ListItem, renderToMarkdown, Span, Title } from '../../lib/markdown';
import type { LinkedContextRepo } from '../../types/context-recommendation';

type ExistingRecommendationSummary = Pick<
	DBContextRecommendation,
	'fingerprint' | 'suggestedFile' | 'subjectKey' | 'title' | 'status'
>;

type ContextRecommendationsPromptProps = {
	windowStart: Date;
	windowEnd: Date;
	existing: ExistingRecommendationSummary[];
	proposeFixes?: boolean;
	linkedRepos?: LinkedContextRepo[];
	contextRepoConnected?: boolean;
};

export function renderContextRecommendationsPrompt(props: ContextRecommendationsPromptProps): string {
	return renderToMarkdown(<ContextRecommendationsPrompt {...props} />);
}

function ContextRecommendationsPrompt({
	windowStart,
	windowEnd,
	existing,
	proposeFixes = false,
	linkedRepos = [],
	contextRepoConnected = false,
}: ContextRecommendationsPromptProps) {
	return (
		<Block>
			<Span>
				Analysis window: {windowStart.toISOString()} to {windowEnd.toISOString()}.
			</Span>

			<Block separator={'\n'}>
				<Title>What to look for (mine the window, then locate the fix)</Title>
				<List ordered>
					<ListItem>
						Tool errors: v_messages where tool_state = &quot;output-error&quot; — cluster by the failing
						table/column. Cross-reference databases/**/columns.md and description.md.
					</ListItem>
					<ListItem>
						Source-code context: if a warehouse gap traces back to SQL, dbt, docs, or application code in{' '}
						<Code>repos/&lt;name&gt;/**</Code>, cross-reference that file and target it when it is the real
						source of truth.
					</ListItem>
					<ListItem>
						Repeated corrections: v_memories where category = &quot;global_rule&quot; — each is a rule users
						had to teach; it likely belongs in RULES.md or semantics/*.md.
					</ListItem>
					<ListItem>Downvote themes: v_messages where vote = &quot;down&quot; (+ explanation).</ListItem>
					<ListItem>Regeneration / friction: v_messages where superseded_at is not null.</ListItem>
					<ListItem>
						Coverage gaps: frequent first user prompts (v_messages text) with no matching semantics doc.
					</ListItem>
				</List>
			</Block>

			<Block separator={'\n'}>
				<Title>Recording (record as you go — never batch until the end)</Title>
				<Span>
					Your step budget is limited. The MOMENT you have confirmed a problematic resource — both its signal
					in the data and the relevant context file — call <Code>record_recommendation</Code> for it, then
					move to the next signal. If you defer recording and run out of steps, the finding is lost, so tackle
					the strongest signals first.
				</Span>
				<Span>
					Group findings by TARGET RESOURCE (a file + a stable subject such as a table, column, or normalized
					rule), and call <Code>record_recommendation</Code> once per resource with: suggestedFile,
					subjectKey, severity, title, summary, suggestedAction, and the supporting insights (each:
					signalType, a metric label, a count, and a few exampleChatIds). Derive counts from query results —
					never invent them.
				</Span>
				<Span>
					Choose <Code>suggestedFile</Code> as the file whose pull request should change: context files such
					as <Code>RULES.md</Code> or <Code>semantics/*.md</Code> for agent instructions
					{contextRepoConnected ? '' : ' when a context repo is connected'}, or{' '}
					<Code>repos/&lt;name&gt;/...</Code> when the real fix belongs in a linked source repo. Do not
					combine files from different repositories in one recommendation.
				</Span>
				<LinkedRepos repos={linkedRepos} />
			</Block>

			<Block separator={'\n'}>
				<Title>Re-verify existing recommendations</Title>
				<Span>
					These recommendations already exist. For each, either (a) re-record it via{' '}
					<Code>record_recommendation</Code> if the gap STILL exists (with refreshed insights), or (b) call{' '}
					<Code>resolve_recommendation({'{ fingerprint }'})</Code> ONLY after you have read the file and
					verified the gap is fixed. If unsure, leave it alone.
				</Span>
				<ExistingRecommendations existing={existing} />
			</Block>

			<Span>
				Be precise and evidence-driven. Record each substantiated finding the moment you confirm it
				{proposeFixes
					? ', then immediately propose its fix (edit_file for human-written context files or linked GitHub repo files, propose_manual_fix for generated or unlinked sources)'
					: ''}
				; stop once every problematic resource you can support has been recorded.
			</Span>
		</Block>
	);
}

function LinkedRepos({ repos }: { repos: LinkedContextRepo[] }) {
	if (repos.length === 0) {
		return <Span>No repositories are declared in nao_config.yaml for this project.</Span>;
	}
	return (
		<Block>
			<Span>
				Linked repositories detected from <Code>nao_config.yaml</Code>:
			</Span>
			<List>
				{repos.map((repo) => (
					<ListItem key={repo.name}>
						<Code>{repo.contextPath}/</Code> →{' '}
						{repo.repoFullName ? (
							<>
								<Code>{repo.repoFullName}</Code>
								{repo.branch ? (
									<>
										{' '}
										on <Code>{repo.branch}</Code>
									</>
								) : null}
							</>
						) : (
							<>
								not PR-capable (
								{repo.localPath ? (
									<>
										local path <Code>{repo.localPath}</Code>
									</>
								) : (
									<>
										URL <Code>{repo.url ?? 'missing'}</Code>
									</>
								)}
								)
							</>
						)}
					</ListItem>
				))}
			</List>
		</Block>
	);
}

function ExistingRecommendations({ existing }: { existing: ExistingRecommendationSummary[] }) {
	if (existing.length === 0) {
		return <Span>There are no existing open recommendations.</Span>;
	}
	return (
		<List>
			{existing.map((r) => (
				<ListItem key={r.fingerprint}>
					[{r.status}] fingerprint={r.fingerprint} file={r.suggestedFile} subject={r.subjectKey} — {r.title}
				</ListItem>
			))}
		</List>
	);
}
