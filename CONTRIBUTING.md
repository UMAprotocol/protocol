# How to contribute

We really appreciate contributions to the UMA ecosystem. The guidelines below are meant to help increase the odds that
the process works smoothly and your contributions can be merged as quickly and efficiently as possible.

## Maintainers

- Everyone on the @UMAprotocol/eng team is considered a maintainer of the protocol repository.
- If you are a maintainer and your review is requested, you are expected to either provide a review within 1 business
  day (in your time zone) or reassign the review to another maintainer.
- The same expectations apply for follow-up reviews where your review is re-requested after an update has been made.
- See [MAINTAINING.md](./MAINTAINING.md) for information about the responsibilities of the on-duty maintainer.

## Communication

- Before starting work on a significant change, please open a GitHub issue outlining what you would like to change,
  how, and why. There are issue templates to guide you.
- The issue process should be used as a precursor to drive consensus around whether a change should be made and how it
  should be made. It may feel like a formality in some cases, but it often helps avoid wasted time, both on the part of
  reviewers and contributors.

## Issues

- Issues should be used to open a discussion about something that you want to see changed.
- Please tag individual maintainers if you would like their input. If you don't know which maintainer to tag, just tag
  @UMAprotocol/eng.
- To make a change, add a feature, or fix a bug, one should start by opening an issue briefly describing what should be
  changed and why.
- Maintainers will generally assign the issue to a particular person to avoid multiple people working on the same issue
  at the same time.
- Once an issue is open and one or more maintainers have expressed corroborating opinions, the assigned person should
  feel comfortable beginning work on the issue.
- If an issue is a major project, consider working with the maintainers to break it down into sub-issues and creating a
  milestone to track progress.

## PRs

- No PRs should be opened that are not associated with one or more issues.
- If you are not sure who to request as reviewers on your PR, request a review from @UMAprotocol/eng.
- If you have one maintainer in mind, but do not know who else to add, you can always add @UMAprotocol/eng to
  auto-select a second.
- If you make updates and would like another round of reviews, use the cycle icon next to the reviewers names to
  request a follow-up review.
- PRs should be narrow and focused. Making multiple, unrelated changes in the same PR makes things difficult for reviewers
  and can often slow PR progress. If this is the case, you may be asked to split the PR up.
- PRs must get approval from _at least_ one maintainer. However, it is considered best practice to make sure all
  comments are completely resolved before merging.
- PRs can only be merged by maintainers. If a maintainer opened the PR, it's preferred (although, not required) to
  allow them to merge it, themselves.
- Reviewer comments should be resolved by the reviewer, not the person who opened the PR.
- PR titles should be in [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) format. This helps
  inform versioning and changelogs. Please include a breaking change footer in your PR description if the change will
  break consumers of any package. If you don't know how to correctly title your PR, this can be addressed in the review
  process. See the section below for more details on conventional commits.

## Conventional Commits

See [here](https://www.conventionalcommits.org/en/v1.0.0/) for details on how a conventional commit is structured.
Conventional commits generally fall into three types:

- `fix`: a bug fix.
- `feat`: a new feature.
- `improve`: catch-all for any change that doesn't add a feature or fixes a bug.

`improve` can be broken down further for specificity, but this is completely optional. Here are the types that
[angular](https://github.com/angular/angular/blob/22b96b9/CONTRIBUTING.md#type) uses in addition to `feature` and `fix`:

- build: Changes that affect the build system or external dependencies
- ci: Changes to our CI configuration files and scripts
- docs: Documentation only changes
- perf: A code change that improves performance
- refactor: A code change that neither fixes a bug nor adds a feature
- style: Changes that do not affect the meaning of the code
- test: Adding missing tests or correcting existing tests

Here are a few examples of good conventional commit PR titles:

- feat(dvm): adds a new function to compute voting rewards offchain
- fix(monitor): fixes broken link in liquidation log
- feat(voter-dapp): adds countdown timer component to the header
- build(solc): updates solc version to 0.6.12
- improve(emp-client): parallelizes web3 calls to improve performance

## External Packages

- Adding npm packages in the course of normal work is acceptable. It's better to add a package than reinvent the wheel.
- There are certain packages that cannot be added for security reasons. These tend to be packages that are not heavily
  used by the javascript community, those that are not actively maintained, or are maintained by a single person.
- The above rule is somewhat subjective, so the maintainers can give guidance as to whether a package is appropriate
  to include. This rule tends to be more strict when a package is used in sensitive areas of the code and less strict
  when it's used in a nonessential way, like dev tooling.
- For highly useful packages, especially small ones, that don't meet the above requirements, the maintainers may agree
  to fork the package into the UMA Github Organization, audit it, and push a version to npm under the UMA scope. This
  allows the maintainers to have more direct control of the dependency and patch it when necessary. This method should be
  used sparingly as it adds a significant maintenance burden.

## Style guide

You can find the style guide [here](./STYLE.md).
