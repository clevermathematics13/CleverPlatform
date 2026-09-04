/**
 * Pablo Clevenger's two personal accounts, used to test the platform as
 * other roles (see app/login/choose-role and the set_test_account_role()
 * migration). Both are enrolled in every real rostered course, including
 * 9A, so they'd otherwise trip the Grade 9 "minimal nav" treatment meant
 * for real Grade 9 students -- excluded from that check wherever it runs.
 */
export const MULTI_ROLE_TEST_EMAILS = ["pcleveng@amersol.edu.pe", "paulsclevenger@gmail.com"];

export const MULTI_ROLE_TEST_PROFILE_IDS = [
  "44db5d56-f3ab-419f-9238-83377ac05b1d", // pcleveng@amersol.edu.pe
  "822c943e-f9ff-46ab-8953-4c99229c9f03", // paulsclevenger@gmail.com
];
