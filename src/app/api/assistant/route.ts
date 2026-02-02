import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface AssistantRequestBody {
  question: string;
  context: Record<string, unknown>;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

const SYSTEM_PROMPT = `Du bist eine freundliche KI-Assistentin, die Mitarbeitenden ihre Monatskennzahlen erläutert.
Nutze ausschließlich die übergebenen Kontextdaten (JSON). Erfinde nichts.
Erkläre Zahlen in verständlichem Deutsch, nenne relevante Vergleichswerte und gib Tipps, falls sinnvoll.`;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY ist nicht gesetzt. Bitte in der .env.local hinterlegen.' },
      { status: 500 }
    );
  }

  let question = '';
  let context: Record<string, unknown> = {};
  let history: { role: 'user' | 'assistant'; content: string }[] = [];

  try {
    const body = (await request.json()) as AssistantRequestBody;
    question = String(body?.question ?? '').trim();
    context = (body?.context ?? {}) as Record<string, unknown>;
    if (Array.isArray(body?.history)) {
      history = body.history.filter((entry) => entry && entry.content);
    }
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }

  if (!question) {
    return NextResponse.json({ error: 'Bitte stelle eine Frage.' }, { status: 400 });
  }

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      {
        role: 'user',
        content: `Frage: ${question}\n\nKontext (JSON): ${JSON.stringify(context)}`,
      },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const data = await response.json();
        detail = data?.error?.message ?? '';
      } catch {
        detail = await response.text();
      }
      return NextResponse.json(
        { error: detail || 'Die Assistenten-Anfrage ist fehlgeschlagen.' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim?.();
    if (!answer) {
      return NextResponse.json(
        { error: 'Keine Antwort vom Sprachmodell erhalten.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json(
      { error: 'Die Assistenten-Anfrage konnte nicht verarbeitet werden.' },
      { status: 500 }
    );
  }
}
