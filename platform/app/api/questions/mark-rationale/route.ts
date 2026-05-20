import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';
import { IB_MARK_RATIONALE_SYSTEM } from '@/lib/latex-utils';

export const runtime = 'nodejs';
export const maxDuration = 30;

type MarkRationaleRequest = {
  partLabel: string;
  partMarks: number;
  token: { id: string; label: string; ordinal: number; snippet: string };
  subtopicCodes: string[];
  primarySubtopicCode: string | null;
  questionLatex: string;
  markschemeLatex: string;
  availableSubtopics: { code: string; descriptor: string }[];
};

type MarkRationaleResult = {
  selectedSubtopic: string;
  confidence: number;
  confidenceBucket: 'high' | 'medium' | 'low';
  rationale: string;
  evidenceSpan: string;
};

export async function POST(req: Request) {
  try {
    // Auth: teachers only
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, user, profile } = auth;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
    }

    const body = (await req.json()) as MarkRationaleRequest;
    if (
      !body?.token ||
      !Array.isArray(body?.subtopicCodes) ||
      body.subtopicCodes.length === 0
    ) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Build a concise descriptor lookup for just the part's subtopics
    const relevantDescriptors = body.subtopicCodes
      .map((code) => {
        const found = body.availableSubtopics.find((s) => s.code === code);
        return found ? `  ${code}: ${found.descriptor}` : `  ${code}`;
      })
      .join('\n');

    const userMessage = `## Part ${body.partLabel} (${body.partMarks} mark${body.partMarks !== 1 ? 's' : ''})

### Subtopics assigned to this part
Primary: ${body.primarySubtopicCode ?? '(none set)'}
All assigned:
${relevantDescriptors}

### Question LaTeX
${body.questionLatex.trim()}

### Markscheme LaTeX
${body.markschemeLatex.trim()}

### Token to attribute
Token: ${body.token.label} (token #${body.token.ordinal + 1} in this part)
Context snippet (up to 300 chars ending at the token):
${body.token.snippet}

Which of the assigned subtopics does this ${body.token.label} token primarily test? Return JSON only.`;

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: IB_MARK_RATIONALE_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawText =
      response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    // Strip markdown code fences if present
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let result: MarkRationaleResult;
    try {
      result = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        { error: 'Claude returned non-JSON', raw: rawText },
        { status: 502 },
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Mark rationale error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
