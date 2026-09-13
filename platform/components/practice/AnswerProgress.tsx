"use client";

/**
 * "7 of 26 answered", kept live as the student types.
 *
 * Server-rendered from the saved answers and then corrected in the browser, so
 * the number is right on first paint and right again a keystroke later. It
 * listens for the window event the answer boxes dispatch rather than being
 * handed a callback -- the page that renders both is a server component.
 *
 * Counted in PARTS, not questions. A nineteen-mark question with five of them
 * is not one thirteenth of the work.
 */

import { useEffect, useState } from "react";
import { ANSWER_EVENT, type AnswerEventDetail } from "@/lib/practice-answers";

export default function AnswerProgress({
  initialAnsweredKeys,
  totalSlots,
}: {
  initialAnsweredKeys: string[];
  totalSlots: number;
}) {
  const [answered, setAnswered] = useState<Set<string>>(() => new Set(initialAnsweredKeys));

  useEffect(() => {
    function onAnswer(event: Event) {
      const detail = (event as CustomEvent<AnswerEventDetail>).detail;
      if (!detail) return;
      setAnswered((prev) => {
        const has = prev.has(detail.key);
        if (has === detail.answered) return prev;
        const next = new Set(prev);
        if (detail.answered) next.add(detail.key);
        else next.delete(detail.key);
        return next;
      });
    }
    window.addEventListener(ANSWER_EVENT, onAnswer);
    return () => window.removeEventListener(ANSWER_EVENT, onAnswer);
  }, []);

  if (totalSlots === 0) return null;

  const count = answered.size;
  return (
    <span className={count === totalSlots ? "text-da-success" : "text-da-muted"}>
      {count} of {totalSlots} answered
    </span>
  );
}
