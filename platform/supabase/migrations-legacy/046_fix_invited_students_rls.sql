-- 046: Fix invited_students RLS for first-time logins
--
-- The previous policy checked profiles.email, but first-time users have
-- no profile row yet when the auth callback checks their invitation.
-- Reading the email directly from the JWT works even before profile creation.

DROP POLICY IF EXISTS "Users can view own invitations" ON public.invited_students;

CREATE POLICY "Users can view own invitations"
  ON public.invited_students FOR SELECT
  USING (lower(email) = lower(auth.jwt() ->> 'email'));
