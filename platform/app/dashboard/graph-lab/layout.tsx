import { requireTeacher } from "@/lib/auth";

/**
 * Graph Lab is a teacher's tool, and its page is a client component with no
 * role check of its own: a student who typed the URL used to get the page,
 * copy about the model behind it included, even though every Graph Lab API
 * refuses them. This server layout sends anyone who is not a teacher to
 * /unauthorized before the page renders.
 */
export default async function GraphLabLayout({ children }: { children: React.ReactNode }) {
  await requireTeacher();
  return children;
}
