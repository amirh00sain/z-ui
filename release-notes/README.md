# Release Notes

Create one Markdown file per tag in this directory.

Naming convention:

- `release-notes/v0.1.0.md`
- `release-notes/v0.1.1.md`

When a tag matching `v*` is pushed, the release workflow reads `release-notes/<tag>.md` and uses it as the GitHub Release body.

If the file is missing, the workflow fails so a release is never published with an empty description.

## Style guide

Release notes are published straight to the GitHub Release page for **end users and operators**. Keep the total length low (usually under 300 words), organise by feature, and avoid implementation detail written from a developer's point of view.

Every historical version (v0.1.0 to v0.3.1) has been backfilled to this style and pushed to the corresponding GitHub Release.

### Recommended structure

```markdown
# xray-pilot vX.Y.Z

One-sentence theme.

## Added
- A user-facing feature description ("you can now do X", not "we implemented X")

## Fixed
- Short description (only when there is a user-visible bug fix)

## Upgrade
- Database migration behaviour / API compatibility / how to upgrade

## Notes
- Security reminders and prerequisites (optional, only when genuinely needed)
```

### What to include

- One to three sentences per feature, covering what it is and how you use it
- Database schema changes (automatic migration / manual steps)
- Breaking changes, if any
- Security-relevant usage reminders (for example, flows that expose a sensitive credential)

### What to leave out

- Implementation notes (file paths, helper names, unit test lists)
- Internal architecture moves (fields reserved for a future vX.Y)
- Engineering trade-offs (what was deferred and why)
- Commit hashes or PR links (the GitHub Release page shows those automatically)

That material belongs in commit messages and PR descriptions — not in the release notes.
