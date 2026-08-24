-- get_public_schema() is referenced nowhere in the application. It exposed the
-- full table/column map of `public` to any holder of the anon key.
-- Default EXECUTE is granted to PUBLIC, so role-level revokes were insufficient.
REVOKE ALL ON FUNCTION public.get_public_schema() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.get_public_schema() SET search_path = '';

-- get_my_role() is evaluated *inside* RLS policies that target the `public`
-- role, so anon must retain EXECUTE or anonymous reads raise errors instead of
-- returning zero rows. It only ever reports the caller's own role.
GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon, authenticated;;
