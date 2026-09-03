import { DBContextRecommendation } from '../../db/abstractSchema';
import { Block, Bold, Code, List, ListItem, renderToMarkdown, Span, Title } from '../../lib/markdown';
import type { FlaggedContextFile } from '../../services/context-recommendations.file-costs';
import type { LinkedContextRepo } from '../../types/context-recommendation';

type ExistingRecommendationSummary = Pick<
	DBContextRecommendation,
	'fingerprint' | 'suggestedFile' | 'subjectKey' | 'title' | 'status'
>;

type ContextRecommendationsPromptProps = {
	windowStart: Date;
	windowEnd: Date;
	existing: ExistingRecommendationSummary[];
	fileReadCosts?: FlaggedContextFile[];
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
	fileReadCosts = [],
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
						table/column. Count how many tool calls failed per root cause. Cross-reference
						databases/**/columns.md and description.md.
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
					<ListItem>
						Downvote themes: v_messages where vote = &quot;down&quot; (+ explanation). Collect the
						message_id values from those rows and pass them as feedbackMessageIds when you call{' '}
						<Code>record_recommendation</Code> so each downvote is linked to the recommendation.
					</ListItem>
					<ListItem>Regeneration / friction: v_messages where superseded_at is not null.</ListItem>
					<ListItem>
						Coverage gaps: frequent first user prompts (v_messages text) with no matching semantics doc.
						Treat each distinct metric or concept users asked for as its own gap and its own recommendation,
						not a single lumped &quot;missing semantics&quot; finding.
					</ListItem>
					<ListItem>
						Token cost: use the &quot;Context file read cost&quot; table below. A monolithic file that is
						read often and is heavy per read (flagged <Code>frequent_and_expensive</Code>) inflates LLM cost
						on every use; a rarely read but very large file (flagged <Code>rare_but_outlier</Code>) spikes
						cost whenever it is pulled in; a file flagged <Code>truncated_on_read</Code> is so large the
						read tool cut it off, so the agent never even saw the whole file. For any of these, record a{' '}
						<Code>context_bloat</Code> recommendation to split it into smaller, focused files so the agent
						only loads the relevant part. When the heavy content is really a repeatable process the agent
						keeps re-reading, record a <Code>skills</Code> recommendation to factor it into an on-demand
						skill instead.
					</ListItem>
				</List>
			</Block>

			<ContextFileCosts files={fileReadCosts} />

			<Block separator={'\n'}>
				<Title>Recording (record as you go — never batch until the end)</Title>
				<Span>
					Your step budget is limited. The MOMENT you have confirmed a problematic resource — both its signal
					in the data and the relevant context file — call <Code>record_recommendation</Code> for it, then
					move to the next signal. If you defer recording and run out of steps, the finding is lost, so tackle
					the strongest signals first.
				</Span>
				<Span>
					Group findings by the <Bold>fix</Bold>, not the root cause, following the system prompt&apos;s
					rules: one recommendation per undefined metric or concept, and no umbrella finding on top of the
					split ones.
				</Span>
				<Span>
					For each finding, set <Code>category</Code>, write a precise one-sentence <Code>rootCause</Code>{' '}
					describing the exact sequence (what was read or not read, what mistake followed), set{' '}
					<Code>rootCauseKind</Code> and <Code>fixTarget</Code> according to the system prompt guidelines.
				</Span>
				<Span>
					Call <Code>record_recommendation</Code> once per distinct fix, with <Code>subjectKey</Code> set to a
					normalized name for that fix. Provide: suggestedFile, subjectKey, category, rootCause,
					rootCauseKind, fixTarget, title, summary, suggestedAction, feedbackMessageIds (the message_id values
					from v_messages rows where vote = &quot;down&quot; that this recommendation addresses), and the
					supporting insights (each: signalType, a metric label, a count, and triggerRefs). For each insight,
					populate <Code>triggerRefs</Code> as an array of <Code>{'{ chatId, targetId }'}</Code> objects — at
					most 5 per insight. <Code>targetId</Code> must point to the exact origin of the finding in the chat
					so the replay can scroll to and highlight it; always set it:
					<List>
						<ListItem>
							For <Code>tool_error</Code> signals: use the <Code>tool_call_id</Code> of the failing tool
							call from v_messages.
						</ListItem>
						<ListItem>
							For every other signal (<Code>downvote_theme</Code>, <Code>repeated_correction</Code>,{' '}
							<Code>friction</Code>, <Code>coverage_gap</Code>, hallucinations): use the{' '}
							<Code>message_id</Code> from v_messages of the message that shows the problem — the
							downvoted or corrected assistant answer, the hallucinated response, or the user prompt with
							no coverage. Only leave <Code>targetId</Code> undefined when no single message is the
							origin.
						</ListItem>
					</List>
					Derive counts from query results — never invent them.
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

function ContextFileCosts({ files }: { files: FlaggedContextFile[] }) {
	if (files.length === 0) {
		return null;
	}
	return (
		<Block separator={'\n'}>
			<Title>Context file read cost (estimated tokens, this window)</Title>
			<Span>
				Estimated from the size of each <Code>read</Code> tool call, capped per read at the read-tool truncation
				limit and ordered by total tokens. Flags mark files worth modularizing; unflagged rows are context for
				comparison. Files injected automatically (e.g. <Code>RULES.md</Code>) may not appear here.
			</Span>
			<List>
				{files.map((file) => (
					<ListItem key={file.filePath}>
						<Code>{file.filePath}</Code> — {file.readCount} reads, {file.totalTokens} tokens total (avg{' '}
						{file.avgTokens}, max {file.maxTokens} per read){file.truncated ? ', truncated on read' : ''}
						{file.flag ? (
							<>
								{' '}
								— <Bold>{file.flag}</Bold>
							</>
						) : null}
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
