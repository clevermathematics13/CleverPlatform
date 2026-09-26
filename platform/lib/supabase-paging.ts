/**
 * Reading more rows than PostgREST returns in one request.
 *
 * Its own module so that a page can page through a table without importing
 * lib/na-scanning.ts, and with it the whole grader (lib/ai-grading.ts reads
 * its policy files from disk when it loads).
 */

/**
 * PostgREST caps a single request at 1000 rows by default. A packet
 * version's na_response_crops easily exceeds that once enough students
 * have been scanned (confirmed in production: one packet version alone
 * has 1515 crop rows) -- a plain `.select().in("packet_scan_id", ...)`
 * across every scan in a packet version silently returns only 1000 of
 * them, with no error, and Postgres gives no ordering guarantee for
 * which 1000. Whichever students' crops land outside that window read as
 * having done no work at all (0 assessed, 0 marks) in the teacher's
 * results table, even though their feedback is complete and correct --
 * discovered when a teacher asked why a fully-assessed student's row
 * showed 0/39. Any query that can return more than ~1000 rows for a
 * whole packet version (not a single scan, which stays well under the
 * cap) must page through `.range()` with this helper instead of trusting
 * a single request to return everything. Give the query a stable
 * `.order()`, or pages can overlap and skip rows.
 */
export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/**
 * An `.in()` filter over many ids, a chunk of ids per request. A thousand
 * uuids in one `.in()` make a URL of about 37 KB, past what the gateway
 * accepts; a chunk of 100 is about 3.7 KB. Keep each chunk's result under
 * the 1000-row cap too, or page within it.
 */
export async function fetchInChunks<T>(
  ids: readonly string[],
  queryChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chunkSize = 100
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data, error } = await queryChunk(ids.slice(i, i + chunkSize));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}
