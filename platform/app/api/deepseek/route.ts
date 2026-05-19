import { NextResponse } from 'next/server';
import { getApiTeacher } from '@/lib/auth';

export const runtime = 'nodejs';

type DeepSeekRequestBody = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
};

export async function POST(req: Request) {
  try {
    // Only authenticated teachers may call the DeepSeek API
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const { supabase, user, profile } = auth;

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'DEEPSEEK_API_KEY not set' },
        { status: 500 },
      );
    }

    const body = (await req.json()) as DeepSeekRequestBody;

    if (!body?.system || !Array.isArray(body?.messages)) {
      return NextResponse.json(
        { error: 'Invalid payload. Expected { system, messages[] }' },
        { status: 400 },
      );
    }

    // Build DeepSeek-compatible payload
    const messages = [
      { role: 'system' as const, content: body.system },
      ...body.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: 8192,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: { error?: { message?: string } } = {};
      try { parsed = JSON.parse(errorText); } catch { /* use raw text */ }
      return NextResponse.json(
        { error: parsed.error?.message ?? `DeepSeek API error (${response.status})` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DeepSeek API error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}