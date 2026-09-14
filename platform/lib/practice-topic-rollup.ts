/**
 * Rolling a class's practice verdicts up to the topic they belong to.
 *
 * The question this answers is not "how did they do on question 7" -- the
 * marking view already answers that -- but "what does this class not have
 * yet". A question tagged `5.16 (parts)` and one tagged `5.16.4` are both
 * further integration, and a teacher planning Monday's lesson needs them
 * counted together.
 *
 * That roll-up is only possible because subtopics.parent_code exists and is
 * now complete (migration 20260914162359). Before it, the three spellings the
 * codes use -- 5.11, 5.16.4, "5.16 (parts)" -- could not be related to each
 * other without parsing punctuation, which is exactly the kind of inference
 * that breaks the first time a code is named differently.
 *
 * Deliberately NOT a score. The verdicts are counted, never averaged into a
 * number out of anything: practice sits outside the gradebook, and a
 * percentage here would be the first step back towards it.
 */

import { VERDICTS, type Verdict } from "@/lib/practice-marking";

/** What the caller must know about each code: its name and where it rolls up. */
export interface SubtopicNode {
  code: string;
  name: string;
  /** Null for a topic-level code, which is its own topic. */
  parentCode: string | null;
  parentName: string | null;
}

/** One answer cell, reduced to just what the roll-up needs. */
export interface RollupCell {
  studentName: string;
  /** Null when the student wrote nothing, or wrote and was not read. */
  verdict: Verdict | null;
  /** True when the student wrote something, read or not. */
  answered: boolean;
  /** Every subtopic code on the question this answer belongs to. */
  subtopicCodes: readonly string[];
}

export interface TopicRollup {
  topicCode: string;
  topicName: string;
  /** The codes that rolled into this topic, in code order. */
  childCodes: string[];
  /** Answers written under this topic, read or not. */
  answered: number;
  /** Of those, how many the teacher has read. */
  marked: number;
  tally: Record<Verdict, number>;
  /** Students with at least one "not yet" here, named once, sorted. */
  notYetStudents: string[];
}

/**
 * The topic a code belongs to: its parent, or itself when it has none.
 *
 * A code with no node at all still gets a topic -- itself -- rather than being
 * dropped. A question tagged with something no longer in the taxonomy is a
 * tagging problem to see, not work to hide.
 */
export function topicOf(code: string, index: ReadonlyMap<string, SubtopicNode>): {
  code: string;
  name: string;
} {
  const node = index.get(code);
  if (!node) return { code, name: code };
  if (node.parentCode) return { code: node.parentCode, name: node.parentName ?? node.parentCode };
  return { code: node.code, name: node.name };
}

/**
 * Group every answer by the topic of the question it answers.
 *
 * A question carrying two subtopic codes counts once under EACH topic they
 * belong to -- a part that is both "definite integrals" and "volume of
 * revolution" is evidence about both -- but only once per topic, so a question
 * tagged `5.16 (parts)` and `5.16.4` does not count twice under 5.16.
 */
export function rollUpByTopic(
  cells: readonly RollupCell[],
  index: ReadonlyMap<string, SubtopicNode>
): TopicRollup[] {
  const byTopic = new Map<
    string,
    {
      name: string;
      childCodes: Set<string>;
      answered: number;
      marked: number;
      tally: Record<Verdict, number>;
      notYet: Set<string>;
    }
  >();

  for (const cell of cells) {
    if (!cell.answered) continue;

    const topics = new Map<string, string>();
    const childrenByTopic = new Map<string, string[]>();
    for (const code of cell.subtopicCodes) {
      const topic = topicOf(code, index);
      topics.set(topic.code, topic.name);
      childrenByTopic.set(topic.code, [...(childrenByTopic.get(topic.code) ?? []), code]);
    }

    for (const [topicCode, topicName] of topics) {
      let bucket = byTopic.get(topicCode);
      if (!bucket) {
        bucket = {
          name: topicName,
          childCodes: new Set(),
          answered: 0,
          marked: 0,
          tally: { correct: 0, almost: 0, not_yet: 0 },
          notYet: new Set(),
        };
        byTopic.set(topicCode, bucket);
      }
      for (const child of childrenByTopic.get(topicCode) ?? []) bucket.childCodes.add(child);
      bucket.answered += 1;
      if (cell.verdict) {
        bucket.marked += 1;
        bucket.tally[cell.verdict] += 1;
        if (cell.verdict === "not_yet") bucket.notYet.add(cell.studentName);
      }
    }
  }

  return [...byTopic.entries()].map(([topicCode, b]) => ({
    topicCode,
    topicName: b.name,
    childCodes: [...b.childCodes].sort(),
    answered: b.answered,
    marked: b.marked,
    tally: b.tally,
    notYetStudents: [...b.notYet].sort((a, c) => a.localeCompare(c)),
  }));
}

/**
 * Weakest first, because that is the order a teacher plans in.
 *
 * "Weakest" is the share of READ answers that are not yet, so a topic nobody
 * has been marked on cannot outrank one the class genuinely struggled with.
 * Ties break on how many were read (more evidence first), then on name, so the
 * order does not shuffle between refreshes.
 */
export function weakestFirst(rollups: readonly TopicRollup[]): TopicRollup[] {
  const share = (r: TopicRollup) => (r.marked === 0 ? -1 : r.tally.not_yet / r.marked);
  return [...rollups].sort(
    (a, b) =>
      share(b) - share(a) || b.marked - a.marked || a.topicName.localeCompare(b.topicName)
  );
}

/** Totals across every topic, for the header line. */
export function totalTally(rollups: readonly TopicRollup[]): Record<Verdict, number> {
  const total: Record<Verdict, number> = { correct: 0, almost: 0, not_yet: 0 };
  for (const r of rollups) for (const v of VERDICTS) total[v] += r.tally[v];
  return total;
}
