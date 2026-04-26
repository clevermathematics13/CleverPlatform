import { requireTeacher } from "@/lib/auth";
import SeatingApp from "./SeatingApp";

export default async function SeatingPage() {
  await requireTeacher();
  return <SeatingApp />;
}
