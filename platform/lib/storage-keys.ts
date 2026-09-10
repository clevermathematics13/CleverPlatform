/**
 * Object-key helpers for Supabase Storage.
 *
 * Supabase's storage-api validates every object key against
 *
 *   /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/
 *
 * and `\w` there is ASCII-only, so any accented letter rejects the whole
 * upload with `Invalid key: <the entire key>` -- which is what a student
 * uploading `Diseno sin titulo.pdf` (with the tilde and the accent) saw.
 *
 * The quieter failure matters more. storage-js interpolates the key straight
 * into the request URL without encoding it, so a `#` or a `?` in a filename is
 * read as the start of a fragment or a query string and everything after it is
 * dropped. The upload then *succeeds* under a truncated name while the caller
 * records the full one, and every later download 404s. A real correction
 * uploaded as `Math KA #6 Corrections.pdf` has been stored as `Math KA ` since
 * May 2026 for exactly this reason.
 *
 * Both go away if the key never carries anything but `[A-Za-z0-9.-]`.
 */

/** Strip diacritics, then reduce anything left outside `[A-Za-z0-9]` to `-`. */
function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Make a filename safe to use as the final segment of a storage object key.
 *
 * Transliterates rather than blanking out, so the name stays recognisable to
 * the student who uploaded it: `Diseno sin titulo.pdf` (accented) becomes
 * `Diseno-sin-titulo.pdf`, not `Dise_o_sin_t_tulo.pdf`.
 *
 * The extension is slugged separately so the trailing `.pdf` survives; a name
 * that slugs away to nothing becomes `file`.
 */
export function safeStorageName(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < name.length - 1;
  const stem = slug(hasExt ? name.slice(0, lastDot) : name).slice(0, 100);
  const ext = hasExt ? slug(name.slice(lastDot + 1)).toLowerCase().slice(0, 10) : "";
  return ext ? `${stem || "file"}.${ext}` : stem || "file";
}

/**
 * Build the `corrections` bucket key for a student's corrected-work PDF.
 *
 * The first segment must stay the raw student UUID: the bucket's INSERT and
 * SELECT policies both check `(storage.foldername(name))[1] = auth.uid()::text`.
 *
 * The unique prefix is not decoration. The bucket has INSERT and SELECT
 * policies and no UPDATE policy, so writing to a key that already exists takes
 * the update path and fails RLS -- a student re-uploading a file under the name
 * they used before would get `new row violates row-level security policy`.
 * A fresh key per upload keeps every write on the INSERT path. The timestamp
 * leads so the folder sorts chronologically; the random suffix is what
 * actually guarantees uniqueness, since `Date.now()` alone repeats inside a
 * millisecond (a double-clicked Upload button is enough).
 */
export function correctionsKey(studentId: string, testId: string, fileName: string): string {
  const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return `${studentId}/${testId}/${unique}-${safeStorageName(fileName)}`;
}
