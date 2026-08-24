-- 023: Reset IBDP AAHL students (Carlos, Camilla, Alejandro) to "not signed in"
-- This unlinks their profiles so they re-enroll fresh on next sign-in.

-- 1. Remove their rows from students (signed-in enrolments)
DELETE FROM public.students
WHERE profile_id IN (
  SELECT id FROM public.profiles
  WHERE email IN (
    '27crojas@amersol.edu.pe',
    '27ccohen@amersol.edu.pe',
    '27arosel@amersol.edu.pe'
  )
);

-- 2. Clear profile_id on their invitations so they appear as "Not signed in"
UPDATE public.invited_students
SET profile_id = NULL
WHERE email IN (
  '27crojas@amersol.edu.pe',
  '27ccohen@amersol.edu.pe',
  '27arosel@amersol.edu.pe'
);
