'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { EmployeeMonthlyOverview } from '@/lib/services/employee/monthly-overview';
import type { EmployeeMonthlySummary } from '@/lib/services/employee/monthly-summary';

type SpeechRecognitionConstructor = new () => SpeechRecognition;

interface SpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

type SpeechRecognitionResultList = ArrayLike<SpeechRecognitionResult>;

type SpeechRecognitionResult = ArrayLike<SpeechRecognitionAlternative>;

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

interface MonthlyAssistantPanelProps {
  overview: EmployeeMonthlyOverview;
  summary: EmployeeMonthlySummary;
}

export default function MonthlyAssistantPanel({ overview, summary }: MonthlyAssistantPanelProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const contextPayload = useMemo(() => {
    return {
      monthLabel: summary.sales.monthLabel,
      overviewTotals: overview.totals,
      overviewBreakdown: overview.breakdown,
      summary,
    };
  }, [overview, summary]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const recognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (recognitionCtor) {
      try {
        const recognition = new recognitionCtor();
        recognition.lang = 'de-DE';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognitionRef.current = recognition;
        setSpeechSupported(true);
      } catch {
        setSpeechSupported(false);
      }
    }
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const askQuestion = async (question: string) => {
    if (!question.trim()) return;
    const trimmed = question.trim();

    const newMessages = [...messages, { role: 'user', content: trimmed } as AssistantMessage];
    setMessages(newMessages);
    setErrorMessage(null);
    setIsSending(true);

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          context: contextPayload,
          history: newMessages,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'Die KI konnte gerade nicht antworten.');
      }

      const data = await response.json();
      const answer = String(data?.answer ?? '').trim();
      if (!answer) {
        throw new Error('Die KI hat keine Antwort geliefert.');
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unbekannter Fehler.');
    } finally {
      setIsSending(false);
    }
  };

  const startListening = () => {
    if (!speechSupported || isListening || isSending) return;
    const recognition = recognitionRef.current;
    if (!recognition) return;

    setErrorMessage(null);
    setIsListening(true);
    setLastTranscript(null);

    recognition.onresult = async (event: SpeechRecognitionEvent) => {
      const firstResult = Array.from(event.results)[0];
      const firstAlternative = firstResult ? Array.from(firstResult)[0] : undefined;
      const transcript = firstAlternative?.transcript?.trim?.();
      if (transcript) {
        setLastTranscript(transcript);
        await askQuestion(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'aborted') {
        setErrorMessage('Die Spracheingabe wurde abgebrochen. Bitte erneut versuchen.');
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (error) {
      setIsListening(false);
      setErrorMessage(
        error instanceof Error ? error.message : 'Die Spracheingabe konnte nicht gestartet werden.'
      );
    }
  };

  const stopListening = () => {
    if (!isListening) return;
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const handleSpeak = async (text: string) => {
    if (isSpeaking) {
      audioRef.current?.pause();
      audioRef.current = null;
      setIsSpeaking(false);
      return;
    }

    try {
      setIsSpeaking(true);
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'Die Audioausgabe konnte nicht erstellt werden.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (error) {
      setIsSpeaking(false);
      setErrorMessage(
        error instanceof Error ? error.message : 'Die Audioausgabe konnte nicht gestartet werden.'
      );
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-slate-900">KI-Assistent</h3>
        <p className="text-sm text-slate-500">
          Sprich mit der KI über deine Monatszahlen. Tippen ist nicht notwendig.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          disabled={!speechSupported || isSending}
          className={`rounded-md px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
            !speechSupported || isSending
              ? 'bg-emerald-200 cursor-not-allowed'
              : isListening
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {!speechSupported
            ? 'Sprachsteuerung nicht verfügbar'
            : isListening
              ? 'Spracheingabe beenden'
              : 'Gespräch starten'}
        </button>
        {isSending ? (
          <span className="text-xs text-slate-500">KI denkt nach…</span>
        ) : null}
        {lastTranscript ? (
          <span className="text-xs text-slate-500">Letzte Frage: „{lastTranscript}“</span>
        ) : null}
        {errorMessage ? <span className="text-xs text-red-600">{errorMessage}</span> : null}
      </div>

      {messages.length ? (
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-lg border px-4 py-3 text-sm shadow-sm ${
                message.role === 'assistant'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-slate-200 bg-slate-50 text-slate-800'
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {message.role === 'assistant' ? 'KI-Antwort' : 'Du'}
                </span>
                {message.role === 'assistant' ? (
                  <button
                    type="button"
                    onClick={() => handleSpeak(message.content)}
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-600"
                  >
                    {isSpeaking ? 'Vorlesen stoppen' : 'Vorlesen'}
                  </button>
                ) : null}
              </div>
              <p className="whitespace-pre-line leading-relaxed">{message.content}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
          Klicke auf „Gespräch starten“ und sprich – zum Beispiel: „Wie viele Überstunden habe ich?“ oder
          „Erklär mir den Resturlaub“.
        </p>
      )}
    </section>
  );
}
