import { requireTeacher } from "@/lib/auth";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { QuestionBankClient } from "./question-bank-client";

export default async function QuestionsPage() {
  await requireTeacher();
  const token = await getDriveTokenFromCookie();

  return (
    <div className="w-full">
      <QuestionBankClient initialDriveConnected={token !== null} />
    </div>
  );
}
