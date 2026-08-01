# Contributing

Thanks for helping improve the DnD New Dawn Guild Assistant.

## Before you begin

- Search existing issues and pull requests before starting duplicate work.
- Use a bug report or feature request form for substantial changes.
- Keep credentials, Discord messages, member data, and other private guild data
  out of issues, commits, tests, and screenshots.
- Report security problems privately as described in [SECURITY.md](SECURITY.md).

## Local development

Requirements: Node.js 22 or newer and npm.

    npm install
    Copy-Item .dev.vars.example .dev.vars
    npm test
    npm run typecheck

Automated tests do not require a real bot token. Live command registration,
Discord REST publication, reminder, and role flows do; keep the token only in
local/Cloudflare secrets.

## Making a change

1. Create a focused branch from <code>main</code>, such as
   <code>feat/table-signups</code> or <code>fix/invalid-signature-response</code>.
2. Add or update tests for behavior changes.
3. Keep changes small enough to review and avoid unrelated formatting churn.
4. Run <code>npm run db:migrate:local</code> and <code>npm run check</code>.
5. Update the README or changelog when behavior, setup, or user-facing features
   change.
6. Open a pull request and complete the template.

Conventional-style commit subjects are encouraged, for example
<code>feat: add GM signup command</code>, <code>fix: reject expired interactions</code>,
or <code>docs: clarify local setup</code>.

## Pull request expectations

A pull request should:

- Explain the problem and the chosen approach.
- Link its issue when one exists.
- Include test evidence.
- Call out security, privacy, deployment, or compatibility effects.
- Avoid generated files unless they are intentionally versioned.
- Stay in draft while known required work remains.

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](LICENSE).

## Releases

Maintainers use Semantic Versioning-style tags and GitHub-generated release
notes. See [RELEASING.md](RELEASING.md) for the release checklist.
