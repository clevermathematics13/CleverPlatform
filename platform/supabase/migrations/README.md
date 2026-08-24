# Migrations

Every `.sql` file in this directory corresponds one-to-one with a row in the live
database's `supabase_migrations.schema_migrations` ledger, matched on the 14-digit
version prefix in the filename. As of 24 Aug 2026 that is 83 files / 83 rows, and
each file is byte-identical to the SQL recorded in the ledger.

Keep it that way. `supabase db push` decides what to apply by comparing the version
prefixes of the files here against the ledger; anything present here but absent
there is treated as pending and will be executed against production.

## How this directory got rebuilt

The repo and the database had drifted completely apart. Files `001_*` through
`057_*` (plus one mis-timestamped `20250601000001_*`) were never recorded in the
ledger, while ~4 months of schema changes applied directly via MCP existed only in
the database. The Supabase CLI matches `^([0-9]+)_(.*)\.sql$` -- `[0-9]+`, not a
14-digit timestamp -- so `001_initial_schema.sql` parsed as version `001` and
counted as pending. Several of those legacy files are destructive
(`014_016_combined.sql` drops the seating tables; `023_reset_aahl_students.sql`
deletes student enrolment rows).

Nothing was ever applied, because `CLEVERPLATFORM_SUPABASE_DB_URL` is not
configured and the workflow's push step silently skips and exits 0. All 23
"successful" runs of `platform-supabase-migrations.yml` were no-ops on that step.

The directory was rebuilt from the ledger itself: each row's stored `statements`
were written back out as `<version>_<name>.sql`. No production write was involved.
The legacy files were moved to `../migrations-legacy/` for reference.

## Adding a migration

Create `<14-digit-UTC-timestamp>_<name>.sql` here and apply it. If you apply it via
MCP `apply_migration`, pass the same name so the ledger row and the filename agree.
Never renumber or rename an existing file: the version prefix is the identity the
CLI matches on, and changing it makes an already-applied migration look pending.

## migrations-legacy/

Historical record only. These are superseded by the schema currently live, are not
recorded in the ledger, and must not be moved back into this directory.
