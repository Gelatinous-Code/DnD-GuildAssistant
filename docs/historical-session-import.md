# Historical session summary import

The historical importer stages immutable archive records from reviewed CSV exports. It never creates synthetic live sessions, attendance, XP, or gold.

## Prepare source and identity mapping

Export stable values from the authoritative worksheet rather than copying `IMPORTRANGE` formulas. Keep the source CSV outside the repository. Record its source URL, worksheet gid, retrieval time, season label, and file checksum in the generated validation report.

Identity mappings are explicit and reviewable:

```json
{
  "version": "season-4-reviewed-v1",
  "mappings": {
    "Alex": "123456789012345678"
  }
}
```

Names are normalized for case and whitespace matching, while every original spelling remains in the imported row. Leave ambiguous people unmapped; the report lists them.

## Dry-run and reconcile

```powershell
npm run history:import -- dry-run --source C:\tmp\season-4.csv --guild 123456789012345678 --season "Season 4" --source-url "https://docs.google.com/spreadsheets/d/1eJRjLd9NdRB3ntrjwn9E482cJvVOdtB4YTLcH-0ag7s/edit?gid=0#gid=0" --worksheet-gid 0 --mapping C:\tmp\season-4-map.json --expect-rows 103 --expect-dates 25 --expect-links 37 --report C:\tmp\season-4-report.json
```

Review every error, warning, unmatched identity, count, GM variant, and a sample of dates, summaries, locations, players, and journal links. Do not prepare SQL until `valid` is true.

## Stage and publish

Back up D1 first, then generate reviewed SQL:

```powershell
npm run history:import -- prepare --source C:\tmp\season-4.csv --guild 123456789012345678 --season "Season 4" --source-url "https://docs.google.com/spreadsheets/d/1eJRjLd9NdRB3ntrjwn9E482cJvVOdtB4YTLcH-0ag7s/edit?gid=0#gid=0" --worksheet-gid 0 --mapping C:\tmp\season-4-map.json --expect-rows 103 --expect-dates 25 --expect-links 37 --out C:\tmp\season-4-stage.sql --report C:\tmp\season-4-report.json
npx wrangler d1 execute DB --remote --file C:\tmp\season-4-stage.sql
```

Staging is idempotent by batch, row, and checksum. Query and sample the staged batch before publication. Then generate and execute the lifecycle SQL:

```powershell
npm run history:import -- publish --guild 123456789012345678 --batch <batch-id> --actor <admin-user-id> --reason "Counts and samples reconciled" --out C:\tmp\season-4-publish.sql
npx wrangler d1 execute DB --remote --file C:\tmp\season-4-publish.sql
```

Published records appear in the member-safe `historical-summaries.v1` website feed. Staged and rolled-back batches do not.

## Rollback and recovery

Rollback changes publication state; it deliberately does not delete immutable source rows:

```powershell
npm run history:import -- rollback --guild 123456789012345678 --batch <batch-id> --actor <admin-user-id> --reason "Reviewed mapping is incorrect" --out C:\tmp\season-4-rollback.sql
```

After fixing the mapping, prepare a new source/mapping version and batch. Use `recover` only to republish the exact rolled-back batch after its original records and checksums have been verified. Lifecycle SQL uses deterministic audit keys and is safe to rerun after interruption, including interruption between the state update and audit insert.

Keep the source export, mapping, report, generated SQL, and pre-import D1 backup together under the guild's retention policy. Never commit member exports or mappings to this repository.
