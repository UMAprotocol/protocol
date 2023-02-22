# Maintaining UMA Repositories

As our repos grow in activity, it takes more and more effort to maintain them and ensure code and issues are being
actively triaged for consideration and review. This document outlines the responsibilities of the on-duty maintainer.

## Responsibilities

- Every business day, the on-duty maintainer is expected to make a pass over _all_ open PRs and new issues in _all_
  UMA repositories.
  - On-duty maintainers rotate each week in a round robin fashion
- For each PR, the on-duty maintainer should make sure the PR is moving forward:
  - Check the title and description according to the [template](./.github/PULL_REQUEST_TEMPLATE.md). If either of
    these are incorrect, edit them and add a comment explaining your edits.
  - Make sure reviews are requested. If not, request them (if the PR is very small, feel free to just review it
    yourself).
  - If the PR has stalled, determine whose action is needed and tag them in a comment (or re-request a review if it's
    the reviewer). If a 3rd party's PR is ready and passing tests, merge it.
  - DCO is a common problem for many users, please help them by pointing them to the
    [DCO docs](https://github.com/apps/dco). Note: DCO checks can be overridden for UMA org members because DCO is covered
    by other agreements, but 3rd party developers _must_ sign off on their commits.
  - For the full PR process, see [the contributing guidelines](./CONTRIBUTING.md).
- For each _new_ issue:
  - If it's a 3rd party issue, triage by assigning or tagging a relevant UMA team member.
  - If it was posted by an UMA org member, no action is required.
