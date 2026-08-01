# Releasing

This project uses <code>vMAJOR.MINOR.PATCH</code> Git tags. Before version 1.0,
minor versions may contain breaking changes; call those changes out prominently
in the release notes.

Use release labels on merged pull requests:

- <code>release: breaking</code> for incompatible behavior or configuration.
- <code>release: feature</code> for new capabilities.
- <code>release: fix</code> for bug and security fixes.
- <code>release: maintenance</code> for documentation, tests, dependencies, and tooling.
- <code>skip-changelog</code> for changes that should not appear in generated notes.

## Checklist

1. Start from an up-to-date, clean <code>main</code> branch.
2. Choose the next version and move entries from Unreleased into a dated
   changelog section.
3. Update <code>package.json</code> and <code>package-lock.json</code> to the same version.
4. Run <code>npm ci</code>, <code>npm test</code>, and <code>npm run typecheck</code>.
5. Merge the release preparation pull request.
6. Create and push an annotated tag:

       git tag -a v0.1.0 -m "Release v0.1.0"
       git push origin v0.1.0

7. Create a GitHub release from that tag, use the automatically generated notes
   as a starting point, and verify deployment instructions before publishing.

Prereleases may use identifiers such as <code>v0.2.0-beta.1</code>. Do not create
a release tag until the commit it names has been pushed and passed CI.
