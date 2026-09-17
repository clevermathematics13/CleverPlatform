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

## The other `supabase/` directory

There are two `supabase/` directories in this repo, and only this one is real:

- `platform/supabase/migrations/` - these files, 1:1 with the live ledger.
- `supabase/` at the repo root - kept because `deploy-edge-functions.yml` ships
  `supabase/functions/process-correction`. Its `migrations/` subdirectory holds
  three 2024/2025 files that predate both reconciliations and are in no ledger.

The Supabase CLI resolves `supabase/migrations` relative to wherever it runs, so
`supabase db push` from the repo root reads those three and none of these. That
is exactly what `platform-supabase-migrations.yml` did until 7 Sep 2026, and why
it had never applied a migration from CI. **Run the CLI from `platform/`.**

It fails safe if you forget - the CLI refuses to push when local and remote
disagree that badly, with "Remote migration versions not found in local
migrations directory" - but the error names every ledger version and reads like
catastrophic drift when nothing is actually wrong. Check your working directory
before believing it.

## The md5 check above compares more than it looks like it does

Third reconciliation, 13 Sep 2026. `20260913174538_tighten_a1_answer_sketches`
had been applied but its file was never committed - 148 files against 149 ledger
rows, the same "applied via MCP, file never landed" gap as the second
reconciliation. The file was rebuilt from the ledger and verified by md5. The
version sets now match exactly: **149 files, 149 rows.**

Running the md5 comparison across the whole directory while doing that turns up
104 files whose md5 does NOT match `array_to_string(statements, E'\n')`. **That
is not drift, and those files must not be "fixed" by overwriting them from the
ledger.** The ledger stores PARSED statements with their trailing semicolons
removed, so the rejoined string is one character short per statement:

```
20260604114745   ledger=1298  file=1299  delta=+1   (1 statement)
20260910181334   ledger=2306  file=2312  delta=+6   (6 statements)
20260911055400   ledger=3439  file=3451  delta=+12  (12 statements)
```

Multi-statement rows additionally lose the blank lines between statements, since
the rejoin uses a single `\n`. Write a file back from the ledger and you get SQL
with no statement terminators.

The rows that DO match byte-for-byte are the ones applied through MCP
`apply_migration`, which stores the submitted text verbatim as a single
statement - semicolons and all. That is why the check reads clean right after a
reconciliation (every file was just written from a matching row) and accumulates
"mismatches" as CLI-applied migrations land.

So the invariant this directory actually holds is **one file per ledger version,
same version prefix** - which is all `supabase db push` compares. Use md5 to
verify a file you just wrote back from the ledger, not as a directory-wide
health check. To compare an older file against its row, ignore whitespace and
trailing semicolons, or diff the text directly.

## Fourth reconciliation, 17 Sep 2026

The same gap again, and it is now clearly the directory's characteristic failure
mode rather than a one-off: **five rows applied on 16 Sep via MCP had no file
here.** 159 files against 164 ledger rows.

```
20260916132044  a3_packet_row
20260916132433  a3_packet_version_rubric_anchors
20260916132457  a3_master_pdf_path
20260916132826  a3_prompt_crops
20260916181947  test_course_dates
```

All five were rebuilt from the ledger and verified by md5. All five were
MCP-applied, so each is a single statement stored verbatim, semicolons and all,
and each file is byte-identical to its row -- the caveat in the previous section
about semicolon-stripping applies to CLI-applied rows and did not bite here.
**164 files, 164 rows**, and the sorted version lists hash identically
(`2b94cf3fc7bad0459a9f97ce95a0860d`).

Two notes for whoever does the fifth one.

**Getting a large row out without a DB URL.** `CLEVERPLATFORM_SUPABASE_DB_URL`
is still not configured, so there is no psql. Two of these rows are 34 KB and
42 KB, which is too much to hand-copy reliably out of a query result. What
worked was a temporary `security definer` function in `public` returning the
row base64-encoded, called over PostgREST with the service-role key so curl
writes straight to disk:

```sql
create or replace function public.tmp_mig_sql_b64(v text)
returns text language sql stable security definer
set search_path = pg_catalog, public as $fn$
  select replace(encode(convert_to(array_to_string(statements, chr(10)),'UTF8'),'base64'), chr(10), '')
  from supabase_migrations.schema_migrations where version = v;
$fn$;
notify pgrst, 'reload schema';
```

```sh
curl -s -X POST "$URL/rest/v1/rpc/tmp_mig_sql_b64" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"v":"20260916132044"}' \
  | jq -r '.' | tr -d '\n' | base64 -d > 20260916132044_a3_packet_row.sql
```

Base64 rather than raw text because the rows contain newlines, quotes and
em dashes that would otherwise have to survive JSON escaping intact. **Drop the
function afterwards** (`drop function if exists public.tmp_mig_sql_b64(text);`)
and confirm it is gone -- it reads a schema PostgREST does not otherwise expose.

**A file written from a row needs no trailing newline.** The ledger text ends at
the final semicolon. `printf '%s' "$(cat f)" > f.tmp && mv f.tmp f` strips the
one a heredoc adds; without it the file is one byte longer than its row and
looks like drift forever after.

**These five files contain non-ASCII.** They carry em dashes in their comments
and data. That does not violate the ASCII-dashes rule in CLAUDE.md, which is
about source comments Turbopack lexes; a migration is never bundled. Do not
"fix" them -- any edit breaks byte-identity with the ledger.
