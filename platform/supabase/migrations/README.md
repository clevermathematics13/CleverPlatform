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

**`apply_migration` assigns its own version, not the one in your filename.** The
ledger row gets the timestamp of the moment it was applied (e.g. a file written as
`20260902113129_ai_usage_log.sql` landed as version `20260902113606`). After applying,
read the version back --

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 1;
```

-- and rename the file to that version before committing. Passing a name that already
carries a timestamp prefix (`20260827233723_na_...`) does not help: the ledger stores
it verbatim as the *name*, and the version is still the apply time.

## Second reconciliation, 2 Sep 2026

Nine days after the first one the directory had drifted again by exactly the mechanism
above: eight rows applied via MCP between 27 and 30 Aug had files here under the
timestamp the author *chose* rather than the one the ledger *assigned*, and one
(`na_batch_runs_tracking`, ledger `20260829031808`) had no file at all. Two of the
eight also differed in content from the ledger (a comment header the ledger never saw;
a trailing newline). All nine were renamed or rewritten to the ledger's exact version
and SQL, verified by md5 against `array_to_string(statements, E'\n')`. 95 files, 95
rows, byte-identical, as of that date. The check that found it:

```sh
# ledger versions vs file versions -- both lists should be identical
ls platform/supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort > /tmp/files
# select version from supabase_migrations.schema_migrations order by version  -> /tmp/ledger
comm -3 /tmp/ledger /tmp/files
```

## migrations-legacy/

Historical record only. These are superseded by the schema currently live, are not
recorded in the ledger, and must not be moved back into this directory.
