"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "./i18n";

type SpeechEvent = Event & { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; processLocally?: boolean;
  onresult: ((event: SpeechEvent) => void) | null; onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null; start: () => void; abort: () => void;
};
type RecognitionConstructor = { new(): Recognition; available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string> };

export function WebVoiceControl({ language, onCommand, onStop }: {
  language: Language;
  onCommand: (command: string) => Promise<string>;
  onStop: () => void;
}) {
  const [status, setStatus] = useState(language === "en" ? "Starting microphone…" : "Включаю микрофон…");
  const [message, setMessage] = useState("");
  const [heard, setHeard] = useState("");
  const busyRef = useRef(false);
  const handlerRef = useRef(onCommand);
  useEffect(() => { handlerRef.current = onCommand; }, [onCommand]);

  useEffect(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      queueMicrotask(() => setStatus(language === "en" ? "Voice control is unavailable in this browser." : "Управление голосом недоступно в этом браузере."));
      return;
    }
    let active = true;
    let recognizer: Recognition | null = null;
    let restartTimer: number | null = null;
    const locale = language === "en" ? "en-US" : "ru-RU";
    const start = async () => {
      try {
        const local = Constructor.available
          ? await Promise.race([Constructor.available({ langs: [locale], processLocally: true }), new Promise<string>((resolve) => window.setTimeout(() => resolve("unavailable"), 800))]) === "available"
          : false;
        if (!active) return;
        recognizer = new Constructor();
        recognizer.lang = locale;
        recognizer.continuous = true;
        recognizer.interimResults = false;
        recognizer.maxAlternatives = 1;
        if (local && "processLocally" in recognizer) recognizer.processLocally = true;
        recognizer.onresult = (event) => {
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            if (!event.results[index].isFinal) continue;
            const command = event.results[index][0]?.transcript?.trim();
            if (!command || busyRef.current) continue;
            busyRef.current = true;
            setHeard(command);
            setStatus(language === "en" ? "Working…" : "Выполняю…");
            void handlerRef.current(command).then(setMessage).catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : language === "en" ? "Could not perform the command." : "Не удалось выполнить команду.");
            }).finally(() => {
              busyRef.current = false;
              if (active) setStatus(language === "en" ? "Listening" : "Слушаю");
            });
          }
        };
        recognizer.onerror = (event) => {
          if (!active) return;
          if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
            active = false;
            setStatus(language === "en" ? "Microphone access is unavailable." : "Нет доступа к микрофону.");
          } else if (event.error !== "no-speech" && event.error !== "aborted") {
            setMessage(language === "en" ? "Speech was not recognized. Try again." : "Речь не распознана. Попробуйте ещё раз.");
          }
        };
        recognizer.onend = () => {
          if (active) restartTimer = window.setTimeout(() => {
            try { recognizer?.start(); } catch { setStatus(language === "en" ? "Could not restart the microphone." : "Не удалось повторно включить микрофон."); }
          }, 350);
        };
        recognizer.start();
        setStatus(language === "en" ? "Listening" : "Слушаю");
      } catch {
        if (active) setStatus(language === "en" ? "Could not start the microphone." : "Не удалось включить микрофон.");
      }
    };
    void start();
    return () => {
      active = false;
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      recognizer?.abort();
    };
  }, [language]);

  return <aside aria-label={language === "en" ? "Background voice control" : "Фоновое управление голосом"} style={{ position: "fixed", insetInline: "max(12px, calc((100vw - 720px) / 2))", bottom: "max(12px, env(safe-area-inset-bottom))", zIndex: 1000, padding: "12px 16px", borderRadius: 16, border: "1px solid var(--border, #947651)", background: "var(--surface, #fffaf0)", color: "var(--ink, #29231b)", boxShadow: "0 8px 28px #0003", display: "flex", alignItems: "center", gap: 12 }}>
    <span aria-hidden="true">🎙️</span>
    <div style={{ minWidth: 0, flex: 1 }}>
      <strong>{language === "en" ? "Voice control" : "Управление голосом"} · {status}</strong>
      {heard ? <div data-no-translate style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{heard}</div> : null}
      {message ? <small role="status" style={{ display: "block" }}>{message}</small> : null}
    </div>
    <button type="button" className="secondary-button" onClick={onStop}>{language === "en" ? "Stop" : "Выключить"}</button>
  </aside>;
}
