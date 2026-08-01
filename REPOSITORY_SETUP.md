# GitHub Repository Setup

Run these steps after the first push. They intentionally are not performed by
this repository setup because there is not yet a remote commit to protect or tag.

## Apply topics and labels

Install and authenticate the [GitHub CLI](https://cli.github.com/), then run:

    node scripts/configure-github.mjs

The script adds the topics and labels declared in
<code>.github/repository.json</code>. It updates matching labels but does not
delete unrelated labels.

## Review GitHub settings

In the repository settings:

1. Enable Issues and GitHub Actions.
2. Enable the dependency graph, Dependabot alerts, and Dependabot security
   updates.
3. Enable private vulnerability reporting so the link in SECURITY.md works.
4. Protect <code>main</code> with pull requests and require the
   <code>Test and typecheck</code> CI check. Requiring one approval and dismissing
   stale approvals are sensible defaults once more than one maintainer is active.
5. Limit direct pushes and tag creation to maintainers when the team is ready.

## First release tag

Do not tag an empty repository. After a release commit has passed CI, follow
[RELEASING.md](RELEASING.md) to create an annotated tag such as
<code>v0.1.0</code> and its GitHub release.
