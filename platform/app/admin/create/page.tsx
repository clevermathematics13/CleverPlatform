import { requireTeacher } from "@/lib/auth";
import { CreatePacketForm } from "./create-packet-form";

// Server-side gate: this route sits outside /dashboard (per the request), so it
// does not inherit the auth check that dashboard/layout.tsx applies to everything
// under /dashboard. requireTeacher() redirects unauthenticated visitors to /login
// and non-teachers to /unauthorized before any of the client form ever renders.
export default async function CreatePacketPage() {
  await requireTeacher();

  return <CreatePacketForm />;
}
