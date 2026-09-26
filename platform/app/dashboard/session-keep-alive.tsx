"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a signed-in teacher's access token fresh for as long as a dashboard
 * tab is open.
 *
 * Nothing else in the dashboard tree holds a Supabase browser client. The only
 * one is imported lazily inside the AI-grading upload handler, so on every
 * other screen no refresh timer is running at all, and a token was refreshed
 * solely as a side effect of a request passing through src/proxy.ts. A tab
 * left sitting on a marking screen between clicks therefore refreshes nothing,
 * and the first click after the access token lapses comes back 401 "Not
 * authenticated".
 *
 * That is what happened on 10 Sep 2026: the accept wrote all 41 marks, and the
 * refresh fired immediately after it 401'd, leaving a red "Not authenticated"
 * stacked above a blue "41 mark(s) written to ClevMarks." with no way for
 * the teacher to tell which one to believe.
 *
 * createBrowserClient runs its own autoRefreshToken ticker, and being the
 * @supabase/ssr client it stores tokens in cookies -- so a refresh it performs
 * is visible to the next server request rather than living only in this tab.
 * Mounted once in DashboardShell, which wraps every dashboard page.
 *
 * The empty onAuthStateChange callback is deliberate: the subscription is what
 * holds the client for the life of the page. Nothing here needs to react to
 * the event, and re-rendering the whole dashboard on a token refresh would be
 * a cost with no benefit.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {});
    return () => subscription.unsubscribe();
  }, []);

  return null;
}
