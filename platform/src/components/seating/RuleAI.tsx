'use client';

import { useState } from 'react';
import type { Rule, Student, Seat } from '@/lib/seating-types';

interface Props {
  students: Student[];
  seats: Seat[];
  classGroup: string;
  onRules: (rules: Rule[]) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ALLOWED_RULE_TYPES = new Set(['PAIR', 'POD']);

function isValidRule(rule: unknown): rule is Rule {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Record<string, unknown>;
  if (!ALLOWED_RULE_TYPES.has(r.rule_type as string)) return false;
  if (typeof r.weight !== 'number' || r.weight < -15 || r.weight > 15) return false;
  if (typeof r.student_a !== 'string') return false;
  if (typeof r.student_b !== 'string') return false;
  if (typeof r.student_id !== 'string') return false;
  if (typeof r.pod_id !== 'string') return false;
  return true;
}

function buildSystemPrompt(students: Student[], seats: Seat[], pods: string[], classGroup: string): string {
  const studentList = students
    .map((s) => `  - "${s.name}" (id: ${s.student_id})`)
    .join('\n');

  // Include seat count per pod so the AI can resolve partner-count requests
  const podSeatCounts = new Map<string, number>();
  seats.filter((s) => s.active).forEach((s) => {
    podSeatCounts.set(s.pod_id, (podSeatCounts.get(s.pod_id) ?? 0) + 1);
  });
  const podList = pods
    .map((p) => `  - ${p} (${podSeatCounts.get(p) ?? '?'} seats)`)
    .join('\n');

  return `You are a seating chart assistant for a classroom. Convert the teacher's natural-language seating requests into structured rules.

CLASS GROUP: ${classGroup}

STUDENTS:
${studentList}

PODS (table groups):
${podList}

RULE TYPES:
- PAIR: controls whether two students sit together or apart (uses student_a + student_b)
- POD: controls whether a student is assigned to a specific pod (uses student_id + pod_id)

WEIGHT SCALE (-15 to +15):
  +15 = must always sit together / in that pod (hard constraint 🔒)
  +5 to +10 = strong preference to sit together / in that pod
  -5 to -10 = strong preference to sit apart / avoid that pod
  -15 = must never sit together / in that pod (hard constraint 🔒)
  0 = no preference

OUTPUT FORMAT:
Respond ONLY with a valid JSON array. Each element must have exactly these fields:
{
  "rule_type": "PAIR" | "POD",
  "class_group": "${classGroup}",
  "student_a": "<student_id or empty string>",
  "student_b": "<student_id or empty string>",
  "student_id": "<student_id or empty string>",
  "pod_id": "<pod_id or empty string>",
  "weight": <integer -15 to 15>,
  "active": true,
  "notes": "<one-sentence explanation>"
}

Rules:
- For PAIR rules: set student_a and student_b; leave student_id and pod_id as ""
- For POD rules: set student_id and pod_id; leave student_a and student_b as ""
- Only use student IDs and pod IDs from the lists above
- If a name is ambiguous, pick the closest match and note it
- Return [] if no valid rules can be generated
- Do not include markdown, explanations, or any text outside the JSON array

HANDLING PARTNER/GROUP-SIZE REQUESTS:
When a teacher says "X should have N partners" or "X should sit with N others" or "X should always have N table partners":
  - N partners = pod must have N+1 people total (including X)
  - Generate ONE POD rule: student_id = X's id, pod_id = "" (empty string), weight = N+1
  - "always" / "must" / "should always" → same (weight = N+1, e.g. weight 3 for "2 partners")
  - Do NOT set pod_id to a specific pod name for partner-count requests
  - Do NOT generate multiple rules for the same student for this type of request
  - "never alone" → weight: 2 (pod must have at least 2 people)
  - The weight value IS the minimum number of people required in the student's pod`;
}

export default function RuleAI({ students, seats, classGroup, onRules }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [suggested, setSuggested] = useState<Rule[]>([]);
  const [error, setError] = useState('');

  const filteredStudents = students.filter(
    (s) => s.active && (classGroup === '*' || s.class_group === classGroup),
  );
  const pods = [...new Set(seats.filter((s) => s.active).map((s) => s.pod_id))].sort();

  const send = async () => {
    const text = input.trim();
    if (!text || pending) return;

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setPending(true);
    setError('');
    setSuggested([]);

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: buildSystemPrompt(filteredStudents, seats, pods, classGroup),
          messages: newMessages,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const rawText: string =
        data?.content?.[0]?.type === 'text' ? data.content[0].text : '';

      // Extract JSON array from response (handles any stray whitespace)
      const match = rawText.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array in response');

      const parsed: unknown[] = JSON.parse(match[0]);
      const valid = parsed.filter(isValidRule);

      const assistantMsg = valid.length
        ? `Generated ${valid.length} rule${valid.length > 1 ? 's' : ''}. Review below.`
        : 'No valid rules could be generated for that request.';

      setMessages([...newMessages, { role: 'assistant', content: assistantMsg }]);
      setSuggested(valid);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const accept = () => {
    onRules(suggested);
    setSuggested([]);
    setMessages((m) => [
      ...m,
      { role: 'assistant', content: `✓ ${suggested.length} rule(s) added.` },
    ]);
  };

  const reject = () => {
    setSuggested([]);
    setMessages((m) => [...m, { role: 'assistant', content: 'Rules discarded.' }]);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-purple-400 bg-purple-100 px-3 py-1.5 text-sm font-semibold text-purple-900 hover:bg-purple-200"
      >
        ✦ AI Rule Generator
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-purple-300 bg-purple-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-purple-950">✦ AI Rule Generator</span>
        <button
          onClick={() => setOpen(false)}
          className="text-purple-600 hover:text-purple-900 text-lg leading-none"
        >✕</button>
      </div>

      {/* Chat history */}
      {messages.length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto text-sm">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`px-3 py-2 rounded-lg ${
                m.role === 'user'
                  ? 'bg-white border border-gray-300 text-gray-900 ml-4'
                  : 'bg-purple-700 text-white mr-4'
              }`}
            >
              {m.content}
            </div>
          ))}
        </div>
      )}

      {/* Suggested rules */}
      {suggested.length > 0 && (
        <div className="rounded-lg border border-purple-400 bg-white p-3 space-y-2">
          <p className="text-xs font-semibold text-purple-900 uppercase tracking-wide">
            Suggested rules
          </p>
          {suggested.map((rule, i) => {
            const studentName = (id: string) =>
              filteredStudents.find((s) => s.student_id === id)?.name ?? id;
            const label =
              rule.rule_type === 'PAIR'
                ? `${studentName(rule.student_a)} ↔ ${studentName(rule.student_b)}`
                : rule.pod_id
                ? `${studentName(rule.student_id)} → pod ${rule.pod_id}`
                : `${studentName(rule.student_id)} – min ${rule.weight} people in their pod`;
            const sign = rule.weight > 0 ? '+' : '';
            return (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  rule.rule_type === 'PAIR'
                    ? 'bg-blue-600 text-white'
                    : 'bg-green-700 text-white'
                }`}>{rule.rule_type}</span>
                <div>
                  <span className="font-semibold text-gray-900">{label}</span>
                  <span className="ml-2 text-gray-600 font-medium">weight {sign}{rule.weight}</span>
                  {rule.notes && (
                    <p className="text-xs text-gray-600 mt-0.5">{rule.notes}</p>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            <button
              onClick={accept}
              className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
            >✓ Accept all</button>
            <button
              onClick={reject}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >✕ Discard</button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          Error: {error}
        </p>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={`e.g. "Keep Carlos and Gael apart" or "Put Asha near the window pod"`}
          rows={2}
          className="flex-1 rounded-lg border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-purple-600"
        />
        <button
          onClick={send}
          disabled={pending || !input.trim()}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 self-end"
        >
          {pending ? '…' : 'Send'}
        </button>
      </div>
      <p className="text-xs text-gray-600">
        Describe rules in plain English. Press Enter or Send. Review before accepting.
      </p>
    </div>
  );
}
