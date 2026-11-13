/** The number of a GitHub pull request, GitLab merge request or Bitbucket pull request, read from its URL. */
export function getReviewRequestNumber(url: string): string | null {
	return url.match(/\/(?:pull|pull-requests|merge_requests)\/(\d+)\/?(?:[?#].*)?$/)?.[1] ?? null;
}
