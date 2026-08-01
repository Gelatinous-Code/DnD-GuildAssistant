# Security Policy

## Supported versions

This project is in early development. Security fixes are applied to
<code>main</code> and the latest published release only.

| Version | Supported |
| --- | --- |
| <code>main</code> | Yes |
| Latest release | Yes |
| Older releases | No |

## Report a vulnerability

Do not open a public issue or discussion for a suspected vulnerability.

Use GitHub's private vulnerability reporting page:

<https://github.com/Gelatinous-Code/DnD-GuildAssistant/security/advisories/new>

Include, when possible:

- A concise description and potential impact.
- The affected commit, version, command, or endpoint.
- Reproduction steps or a minimal proof of concept.
- Suggested mitigations, if known.
- Whether credentials or real guild/member data may be affected.

Maintainers aim to acknowledge reports within three business days and will
coordinate remediation and disclosure with the reporter. Please allow a
reasonable remediation window before publishing details.

If private vulnerability reporting is not yet available, contact a maintainer
through a private channel listed on the
[Gelatinous Code organization profile](https://github.com/Gelatinous-Code).

## Exposed secrets

If a Discord bot token, Cloudflare credential, or other secret is exposed,
revoke or rotate it immediately. Removing the value from Git history does not
make the original credential safe to reuse.
