"use client";
import { DialogCloseButton } from "./DialogCloseButton";

import { useEffect, useRef, useState } from "react";
import {
  requestAssistantPlan,
  type AssistantProvider,
  type GeminiAssistantContext,
  type GeminiPlan,
} from "./cloud-sync";
import type { Language } from "./i18n";
import { createLocalVoicePlan } from "./local-voice-plan";
import { useDialogAccessibility } from "./use-dialog-accessibility";

type SpeechResultEvent = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
};

type SpeechErrorEvent = Event & { error: string };

type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognizerConstructor = {
  new(): SpeechRecognizer;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
};

type LocalVoiceAssistantProps = {
  language: Language;
  context: GeminiAssistantContext;
  neuralAvailable: boolean;
  neuralProvider: AssistantProvider;
  onApply: (plan: GeminiPlan) => Promise<string>;
  onStartControl: () => void;
  onClose: () => void;
};

function speechRecognizerConstructor() {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognizerConstructor;
    webkitSpeechRecognition?: SpeechRecognizerConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function speechErrorMessage(error: string, language: Language) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return language === "en" ? "Allow microphone access to dictate a task." : "Разрешите доступ к микрофону, чтобы продиктовать задачу.";
  }
  if (error === "no-speech") {
    return language === "en" ? "No speech was detected. Please try again." : "Речь не распознана. Попробуйте ещё раз.";
  }
  if (error === "audio-capture") {
    return language === "en" ? "The microphone is unavailable." : "Микрофон недоступен.";
  }
  if (error === "language-not-supported") {
    return language === "en" ? "This device has no speech pack for the selected language." : "На устройстве нет голосового пакета для выбранного языка.";
  }
  return language === "en" ? "Speech recognition could not start. You can type the command instead." : "Не удалось запустить распознавание речи. Команду можно написать вручную.";
}

function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) resolve(fallback);
    }, timeoutMs);
    promise.then((value) => {
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    }).catch(() => {
      settled = true;
      window.clearTimeout(timer);
      resolve(fallback);
    });
  });
}

export function LocalVoiceAssistant({ language, context, neuralAvailable, neuralProvider, onApply, onStartControl, onClose }: LocalVoiceAssistantProps) {
  const [command, setCommand] = useState("");
  const [interim, setInterim] = useState("");
  const [starting, setStarting] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<GeminiPlan | null>(null);
  const [planEngine, setPlanEngine] = useState<"neural" | "local">("local");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recognitionMode, setRecognitionMode] = useState<"device" | "browser" | "text">("text");
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const recognitionStartTimerRef = useRef<number | null>(null);
  const interimRef = useRef("");
  const activeRef = useRef(true);
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);

  useEffect(() => () => {
    activeRef.current = false;
    if (recognitionStartTimerRef.current !== null) window.clearTimeout(recognitionStartTimerRef.current);
    recognizerRef.current?.abort();
  }, []);

  const startListening = async () => {
    if (starting) return;
    setStarting(true);
    setError("");
    setMessage("");
    setPlan(null);
    setInterim("");
    interimRef.current = "";
    const Constructor = speechRecognizerConstructor();
    if (!Constructor) {
      setStarting(false);
      setRecognitionMode("text");
      setError(language === "en" ? "Voice input is not supported in this browser. Type the command below." : "Этот браузер не поддерживает голосовой ввод. Напишите команду ниже.");
      return;
    }

    const locale = language === "en" ? "en-US" : "ru-RU";
    let useDeviceRecognition = false;
    try {
      if (Constructor.available) {
        const availability = await settleWithin(
          Constructor.available({ langs: [locale], processLocally: true }),
          800,
          "unavailable" as const,
        );
        useDeviceRecognition = availability === "available";
      }
      if (!activeRef.current) return;

      const recognizer = new Constructor();
      recognizer.lang = locale;
      recognizer.continuous = false;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      if (useDeviceRecognition && "processLocally" in recognizer) recognizer.processLocally = true;
      recognizer.onstart = () => {
        if (recognitionStartTimerRef.current !== null) window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
        setStarting(false);
        setListening(true);
        setRecognitionMode(useDeviceRecognition ? "device" : "browser");
      };
      recognizer.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = event.results[index][0]?.transcript ?? "";
          if (event.results[index].isFinal) finalText += transcript;
          else interimText += transcript;
        }
        const finalValue = finalText.trim();
        const interimValue = interimText.trim();
        if (finalValue) setCommand((current) => `${current.trim()} ${finalValue}`.trim());
        interimRef.current = interimValue;
        setInterim(interimValue);
      };
      recognizer.onerror = (event) => {
        if (recognitionStartTimerRef.current !== null) window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
        setStarting(false);
        setListening(false);
        setInterim("");
        interimRef.current = "";
        setError(speechErrorMessage(event.error, language));
      };
      recognizer.onend = () => {
        if (recognitionStartTimerRef.current !== null) window.clearTimeout(recognitionStartTimerRef.current);
        recognitionStartTimerRef.current = null;
        const pendingText = interimRef.current.trim();
        if (pendingText) setCommand((current) => `${current.trim()} ${pendingText}`.trim());
        interimRef.current = "";
        setStarting(false);
        setListening(false);
        setInterim("");
      };
      recognizerRef.current = recognizer;
      recognitionStartTimerRef.current = window.setTimeout(() => {
        recognizer.abort();
        recognitionStartTimerRef.current = null;
        setStarting(false);
        setListening(false);
        setRecognitionMode("text");
        setError(speechErrorMessage("start-failed", language));
      }, 8_000);
      recognizer.start();
    } catch (recognitionError) {
      if (recognitionStartTimerRef.current !== null) window.clearTimeout(recognitionStartTimerRef.current);
      recognitionStartTimerRef.current = null;
      setStarting(false);
      setListening(false);
      setInterim("");
      setRecognitionMode("text");
      setError(recognitionError instanceof DOMException && recognitionError.name === "NotAllowedError"
        ? speechErrorMessage("not-allowed", language)
        : speechErrorMessage("start-failed", language));
    }
  };

  const stopListening = () => recognizerRef.current?.stop();

  const preparePlan = async () => {
    if (!command.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (neuralAvailable) {
        try {
          const result = await requestAssistantPlan({
            command: command.trim(),
            audio: null,
            context,
          });
          setPlan(result.plan);
          setPlanEngine("neural");
          setModel(result.model);
          return;
        } catch {
          setMessage(language === "en"
            ? "The neural parser is temporarily unavailable. The preview was prepared on this device."
            : "Нейросетевой разбор временно недоступен. План подготовлен локально на устройстве.");
        }
      }
      setPlan(createLocalVoicePlan(command, context));
      setPlanEngine("local");
      setModel("");
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : (language === "en" ? "Could not understand the command." : "Не удалось разобрать команду."));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      setMessage(await onApply(plan));
      setPlan(null);
      setCommand("");
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : (language === "en" ? "Could not create the task." : "Не удалось создать задачу."));
    } finally {
      setBusy(false);
    }
  };

  const actionCount = plan?.tasks.length ?? 0;
  const neuralProviderName = neuralProvider === "gigachat" ? "GigaChat" : "Gemini";
  const labels = language === "en" ? {
    eyebrow: "GENESIS Voice · free assistant",
    title: "Create tasks by voice",
    close: "Close voice assistant",
    intro: neuralAvailable
      ? `Dictate naturally: ${neuralProviderName} understands dates, projects, task lists, priorities and several tasks in one request.`
      : "Dictate a task, date and time. Separate several tasks with a semicolon.",
    listen: "Dictate a task",
    stop: "Stop listening",
    listening: "Listening… Speak naturally",
    starting: "Preparing the microphone…",
    idle: "Voice recognition runs on your device when available",
    textLabel: "Command",
    placeholder: "For example: create a task call Alex tomorrow at 18:30 #calls",
    privacy: neuralAvailable
      ? `GENESIS does not store an audio recording. Recognized text, available project/list names and linked account addresses are sent to ${neuralProviderName} to prepare the preview; the local parser is used if it is unavailable.`
      : "GENESIS does not send or store an audio recording. Speech-to-text and task parsing happen on your device or in the browser.",
    prepare: "Prepare preview",
    preparing: neuralAvailable ? `Analyzing with ${neuralProviderName}…` : "Preparing preview…",
    preview: "Check before creating",
    understood: "Recognized:",
    tasks: "Tasks",
    edit: "Edit command",
    create: "Create",
    creating: "Creating…",
    local: "on device",
    browser: "browser speech",
    text: "text mode",
    neural: `${neuralProviderName} neural parser`,
    localPlan: "local parser",
  } : {
    eyebrow: "GENESIS Voice · бесплатный помощник",
    title: "Создание задач голосом",
    close: "Закрыть голосовой помощник",
    intro: neuralAvailable
      ? `Говорите естественно: ${neuralProviderName} понимает даты, проекты, списки задач, приоритеты и несколько задач в одной команде.`
      : "Продиктуйте задачу, дату и время. Несколько задач разделяйте точкой с запятой.",
    listen: "Продиктовать задачу",
    stop: "Остановить",
    listening: "Слушаю… Говорите естественно",
    starting: "Подготовка микрофона…",
    idle: "По возможности речь распознаётся прямо на устройстве",
    textLabel: "Команда",
    placeholder: "Например: создай задачу позвонить врачу завтра в 18:30 #звонки",
    privacy: neuralAvailable
      ? `GENESIS не хранит аудиозапись. Для подготовки плана распознанный текст, названия доступных проектов/списков и адреса связанных аккаунтов передаются ${neuralProviderName}; при недоступности используется локальный разбор.`
      : "GENESIS не отправляет и не хранит аудиозапись. Речь преобразуется в текст и разбирается на устройстве или в браузере.",
    prepare: "Подготовить план",
    preparing: neuralAvailable ? `Разбираю с ${neuralProviderName}…` : "Подготавливаю план…",
    preview: "Проверка перед созданием",
    understood: "Распознано:",
    tasks: "Задачи",
    edit: "Изменить команду",
    create: "Создать",
    creating: "Создание…",
    local: "на устройстве",
    browser: "голосовой сервис браузера",
    text: "текстовый режим",
    neural: `нейросеть ${neuralProviderName}`,
    localPlan: "локальный разбор",
  };

  return (
    <div className="modal-backdrop gemini-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section ref={dialogRef} className="gemini-assistant local-voice-assistant" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="local-voice-assistant-title" tabIndex={-1}>
        <header>
          <div className="gemini-mark voice-mark" aria-hidden="true">
            <svg className="voice-microphone-icon" viewBox="0 0 24 24" fill="none" focusable="false">
              <rect className="voice-microphone-capsule" x="8.7" y="2.8" width="6.6" height="11.2" rx="3.3" />
              <path className="voice-microphone-grille" d="M10.55 6.2h2.9M10.55 8.45h2.9" />
              <path className="voice-microphone-capture" d="M5.9 10.4v.9a6.1 6.1 0 0 0 12.2 0v-.9" />
              <path className="voice-microphone-stand" d="M12 17.4v3.35M8.9 20.75h6.2" />
            </svg>
          </div>
          <div>
            <span className="eyebrow">{labels.eyebrow}</span>
            <h2 id="local-voice-assistant-title">{labels.title}</h2>
          </div>
          <DialogCloseButton type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label={labels.close} />
        </header>

        <p className="gemini-intro">{labels.intro}</p>
        <button type="button" className="secondary-button" onClick={onStartControl} disabled={busy || starting}>
          {language === "en" ? "Start background voice control" : "Включить фоновое управление голосом"}
        </button>

        <div className={`gemini-recorder${listening ? " recording" : ""}`}>
          <button type="button" className="gemini-record-button" onClick={() => void (listening ? stopListening() : startListening())} disabled={busy || starting}>
            <span aria-hidden="true">{listening ? "■" : "●"}</span>
            {listening ? labels.stop : labels.listen}
          </button>
          <small>{starting ? labels.starting : listening ? labels.listening : labels.idle} · {labels[recognitionMode === "device" ? "local" : recognitionMode]}</small>
        </div>

        <label className="gemini-command-field">
          <span>{labels.textLabel}</span>
          <textarea
            value={interim ? `${command}${command ? " " : ""}${interim}` : command}
            onChange={(event) => {
              setCommand(event.target.value);
              setInterim("");
              setPlan(null);
            }}
            placeholder={labels.placeholder}
            rows={4}
            maxLength={4000}
            disabled={busy || starting || listening}
          />
        </label>

        <p className="gemini-privacy"><span aria-hidden="true">◇</span> {labels.privacy}</p>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {message ? <p className="form-success" role="status">{message}</p> : null}

        {!plan ? (
          <button type="button" className="gemini-primary" onClick={() => void preparePlan()} disabled={busy || starting || listening || !command.trim()}>
            {busy ? labels.preparing : labels.prepare}
          </button>
        ) : (
          <div className="gemini-plan">
            <div className="gemini-plan-heading">
              <div>
                <span className="eyebrow">{labels.preview}</span>
                <h3 data-no-translate>{plan.summary}</h3>
              </div>
              <small data-no-translate>{planEngine === "neural" ? `${labels.neural}${model ? ` · ${model}` : ""}` : labels.localPlan}</small>
            </div>
            <p className="gemini-understood"><strong>{labels.understood}</strong> <span data-no-translate>{plan.request}</span></p>
            <section>
              <h4>{labels.tasks} · {plan.tasks.length}</h4>
              {plan.tasks.map((task, index) => (
                <article key={`${index}-${task.title}-${task.startDate}`}>
                  <strong data-no-translate>{task.title}</strong>
                  <small data-no-translate>{[
                    task.startDate,
                    task.time,
                    task.project,
                    task.taskList,
                    task.tags.map((tag) => `#${tag}`).join(" "),
                    `P${task.priority}`,
                  ].filter(Boolean).join(" · ")}</small>
                </article>
              ))}
            </section>
            <div className="gemini-plan-actions">
              <button type="button" onClick={() => setPlan(null)} disabled={busy}>{labels.edit}</button>
              <button type="button" className="gemini-primary" onClick={() => void apply()} disabled={busy || !actionCount}>
                {busy ? labels.creating : `${labels.create} · ${actionCount}`}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
