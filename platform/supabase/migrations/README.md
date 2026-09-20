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

## Fourth reconciliation, 18 Sep 2026

The same gap as the second and third, grown to eight: the ledger held 167 rows
against 158 files here, so eight versions had been applied through MCP
`apply_migration` and their files never committed. Seven were rebuilt from the
ledger in this pass:

```
20260916132044  a3_packet_row                        34081 chars
20260916132433  a3_packet_version_rubric_anchors     42473
20260916132457  a3_master_pdf_path                     924
20260916132826  a3_prompt_crops                       1003
20260916181947  test_course_dates                     2215
20260917103734  backfill_aahl_na_continuity          19449
20260918123826  ka1_unit1_scheme_asks_what_it_marks   7349
```

The eighth, `20260918182655_tests_activity_rubric`, is delivered by its own
pull request rather than duplicated here, so this branch lands at 166 files
against 167 rows and the two match once that merges.

**Why it mattered this time.** `platform-supabase-migrations.yml` cannot push
while remote versions are missing locally -- the CLI refuses with "Remote
migration versions not found in local migrations directory", which is the fail
-safe the section above describes. A green run of that workflow was therefore
a skipped run, not a successful one.

**All eight were MCP-applied, which made the rebuild clean.** As the section
above explains, `apply_migration` stores the submitted text verbatim as a
SINGLE statement, semicolons and all, so writing these back out produced valid
SQL directly -- none of the terminator-stripping that makes a CLI-applied row
unsafe to rebuild this way. Every file was verified by md5 against
`array_to_string(statements, E'\n')` and matches exactly, allowing for the
trailing newline each file carries and the ledger's text does not.

**One trap when you verify, found the hard way.** Postgres `length()` counts
CHARACTERS and `wc -c` counts BYTES. `a3_packet_row` is 34081 characters and
34135 bytes, because of its em dashes, and comparing the two reads as
corruption when nothing is wrong. Compare md5s, which settle it; a length
check adds nothing once the md5 matches.

The check that found the gap, and that should be run whenever a migration is
applied outside the CLI:

```sh
# ledger versions vs file versions -- both lists should be identical
ls platform/supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort > /tmp/files
# select version from supabase_migrations.schema_migrations order by version  -> /tmp/ledger
comm -3 /tmp/ledger /tmp/files
```

Run it in BOTH directions. A ledger version with no file blocks CI, which is
what happened here; a file with no ledger version is the dangerous one, since
`supabase db push` treats it as pending and would execute it against
production. There were none of the latter.

### Merge the PR carrying the missing file FIRST

A reconciliation split across two pull requests leaves the directory short
between the two merges, and this workflow runs on every push to main -- so the
first merge goes red even though both PRs are correct.

That is what happened here, and it was avoidable. `20260918182655` belonged to
the feature PR that applied it; the reconciliation PR deliberately left it out,
because adding it in both places is an add/add conflict on merge. The
reconciliation was merged first, so for the few seconds between the two merges
main held 166 files against 167 rows and run #89 failed with the usual
"Remote migration versions not found in local migrations directory", naming
that version. Run #90, on the next merge, was green.

So when a reconciliation and a feature PR each carry part of the set, merge the
one holding the version the other omits first. Nothing is broken if you get it
the wrong way round -- `supabase db push` fails safe and applies nothing -- but
main carries a red run that means nothing, which is exactly the kind of noise
that trains people to ignore this workflow.

**Never run the `supabase migration repair --status reverted <version>` command
the failure message suggests** unless you have established the migration really
was reverted. On this class of failure it has not been: the row is applied and
live, and only its file is missing. Repairing it would tell the ledger a lie
about production.

## Fourth gap, 20 Sep 2026

Two rows applied through MCP on 18 Sep (`20260918205816_ka1_unit1_strand_descriptors_match_schemes`,
`20260918210444_ka1_unit1_q8_and_strand_a_to_ledger`) never got a file on any
branch: 167 files against 169 rows. Both were single-statement MCP applies, so
`array_to_string(statements, E'\n')` plus one trailing newline reproduced them
byte for byte (md5 checked against the ledger before committing). Then
`test_items_marking_notes` was applied the documented way -- MCP first, read
the assigned version back (`20260920042031`), rename the file to it -- and the
directory stands at 170/170.

The lesson is the one above, one more time: an MCP apply is not done until the
file with the ledger's version is on the branch that will merge.
