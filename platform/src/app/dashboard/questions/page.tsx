import { requireTeacher } from "@/lib/auth";
import { QuestionBankClient } from "./question-bank-client";

export default async function QuestionsPage() {
  await requireTeacher();

  return (
    <div className="max-w-7xl">
      <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">
        Question Bank
      </h1>
      <p className="mt-1 text-base font-medium text-blue-700">
        Browse, search, and filter IB questions.
      </p>
      <div className="mt-6">
        <QuestionBankClient />
      </div>
    </div>
  );
}
