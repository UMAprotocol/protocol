# How to contribute

We really appreciate contributions to the UMA ecosystem. The guidelines below are meant to help increase the odds that
the process works smoothly and your contributions can be merged as quickly and efficiently as possible.

## Maintainers

Everyone on the @UMAprotocol/eng team is considered a maintainer of the protocol repository.

## Communication

- Before starting work on a significant change, please open a GitHub issue outlining what you would like to change,
  how, and why. There are issue templates to guide you.
- The issue process should be used as a precursor to drive consensus around whether a change should be made and how it
  should be made. It may feel like a formality in some cases, but it often helps avoid wasted time, both on the part of
  reviewers and contributors.

## Issues

- Issues should be used to open a discussion about something that you want to see changed.
- To make a change, add a feature, or fix a bug, one should start by opening an issue briefly describing what should be
  changed and why.
- Maintainers will generally assign the issue to a particular person to avoid multiple people working on the same issue
  at the same time.
- Once an issue is open and one or more maintainers have expressed corroborating opinions, the assigned person should
  feel comfortable beginning work on the issue.
- If an issue is a major project, consider working the maintainers to break it down into sub-issues and creating a
  milestone to track progress.

## PRs

- No PRs should be opened that are not associated with one or more issues.
- If you are not sure who to assign as reviewers on your PR, please assign @UMAprotocol/eng.
- PRs should be narrow and focused. Making multiple, unrelated changes in the same PR makes things difficult on reviewers
  and can often slow PR progress. If this is the case, you may be asked to split the PR up.
- PRs must get approval from _at least_ one maintainer. However, it is considered best practice to make sure all
  comments are completely resolved before merging.
- PRs can only be merged by maintainers. If a maintainer opened the PR, it's preferred (although, not required) to
  allow them to merge it, themselves.
- PR titles should be in [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) format. This helps
  inform versioning and changelogs. Please include a breaking change footer in your PR description if the change will
  break consumers of any package. If you don't know how to correctly title your PR, this can be addressed in the review
  process.

Note on conventional commit titles: the [angular](https://github.com/angular/angular/blob/22b96b9/CONTRIBUTING.md#type) types
are a good guideline to follow:

- build: Changes that affect the build system or external dependencies
- ci: Changes to our CI configuration files and scripts
- docs: Documentation only changes
- feat: A new feature
- fix: A bug fix
- perf: A code change that improves performance
- refactor: A code change that neither fixes a bug nor adds a feature
- style: Changes that do not affect the meaning of the code
- test: Adding missing tests or correcting existing tests

A few examples of good conventional commit PR titles:

- feat(dvm): adds a new function to compute voting rewards offchain
- fix(monitor): fixes broken link in liquidation log
- feat(voter-dapp): adds countdown timer component to the header
- build(solc): updated solc version to 0.6.12

## Style guide

You can find the style guide [here](./STYLE.md).
