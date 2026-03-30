import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY ist nicht gesetzt. Bitte in der .env.local hinterlegen.' },
      { status: 500 }
    );
  }

  let text = '';
  try {
    const body = await request.json();
    text = String(body?.text ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: 'Kein Text für die Ansage angegeben.' }, { status: 400 });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: text,
        format: 'mp3',
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
        { error: detail || 'TTS-Anfrage an OpenAI fehlgeschlagen.' },
        { status: response.status }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Die TTS-Anfrage konnte nicht verarbeitet werden.' },
      { status: 500 }
    );
  }
}
