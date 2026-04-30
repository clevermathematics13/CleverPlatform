import { requireTeacher } from "@/lib/auth";
import { QuestionBankClient } from "./question-bank-client";

export default async function QuestionsPage() {
  await requireTeacher();

  return (
    <div className="w-full">
      <QuestionBankClient />
    </div>
  );
}
