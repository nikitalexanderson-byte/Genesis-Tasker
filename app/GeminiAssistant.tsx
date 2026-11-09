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
import { useDialogAccessibility } from "./use-dialog-accessibility";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_RECORDING_MS = 60_000;

type GeminiAssistantProps = {
  language: Language;
  context: GeminiAssistantContext;
  provider: Exclude<AssistantProvider, "local">;
  onApply: (plan: GeminiPlan) => Promise<string>;
  onStartControl: () => void;
  onClose: () => void;
};

function preferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function blobToBase64(blob: Blob, language: Language) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(language === "en" ? "Could not read the recording." : "Не удалось прочитать запись."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error(language === "en" ? "Could not prepare the recording." : "Не удалось подготовить запись."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function assistantError(error: unknown, language: Language, provider: Exclude<AssistantProvider, "local">) {
  const message = error instanceof Error ? error.message : "";
  const providerName = provider === "gigachat" ? "GigaChat" : "Gemini";
  if (message === "ASSISTANT_NOT_CONFIGURED" || message === "GEMINI_NOT_CONFIGURED" || message === "GIGACHAT_NOT_CONFIGURED") {
    return language === "en"
      ? `${providerName} is not configured on the GENESIS server yet.`
      : `${providerName} пока не настроен на сервере GENESIS.`;
  }
  if (message === "GEMINI_RATE_LIMIT" || message === "GIGACHAT_RATE_LIMIT") {
    return language === "en"
      ? "Too many requests. Please try again in a few minutes."
      : "Слишком много запросов. Повторите через несколько минут.";
  }
  if (message === "GEMINI_REGION_UNAVAILABLE") {
    return language === "en"
      ? "Gemini does not accept requests from the current GENESIS server region. Configure a supported HTTPS Gemini endpoint on the server."
      : "Gemini не принимает запросы из региона сервера GENESIS. Настройте на сервере поддерживаемый HTTPS-endpoint Gemini.";
  }
  if (message === "GEMINI_KEY_INVALID") {
    return language === "en"
      ? "The Gemini API key is invalid or does not have access to the selected model."
      : "Ключ Gemini недействителен или не имеет доступа к выбранной модели.";
  }
  if (message === "GIGACHAT_KEY_INVALID") {
    return language === "en"
      ? "The GigaChat Authorization Key is invalid or does not have access to the selected model."
      : "Authorization Key GigaChat недействителен или не имеет доступа к выбранной модели.";
  }
  if (message === "GIGACHAT_CERTIFICATE_ERROR") {
    return language === "en"
      ? "The server does not trust the GigaChat certificate. Configure the Russian CA bundle path once on the server."
      : "Сервер не доверяет сертификату GigaChat. Один раз укажите путь к российскому CA-bundle в настройках сервера.";
  }
  return message || (language === "en" ? `${providerName} could not prepare the plan.` : `${providerName} не смог подготовить план.`);
}

export function GeminiAssistant({ language, context, provider, onApply, onStartControl, onClose }: GeminiAssistantProps) {
  const [command, setCommand] = useState("");
  const [audio, setAudio] = useState<{ data: string; mimeType: string; bytes: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<GeminiPlan | null>(null);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);
  const providerName = provider === "gigachat" ? "GigaChat" : "Gemini";
  const labels = language === "en" ? {
    eyebrow: `GENESIS Voice · ${providerName}`,
    title: "Create tasks by voice",
    close: "Close voice assistant",
    intro: `Speak or type which projects, Google Tasks lists, and tasks to create. ${providerName} will show the complete plan before saving.`,
    stopRecording: "Stop recording",
    recordAgain: "Record again",
    record: "Record a voice command",
    recording: "Recording · 60 seconds maximum",
    recordingReady: (kilobytes: number) => `Recording ready · ${kilobytes} KB`,
    microphoneHint: "The microphone turns on only after you press the button",
    command: "Text command",
    placeholder: "For example: create a task call the doctor tomorrow at 18:00 in the Health project",
    privacy: provider === "gigachat"
      ? "After you click Prepare plan, the recording and context are sent to GigaChat. GENESIS does not store the recording and requests its deletion from GigaChat file storage immediately after parsing."
      : "The recording, command text, item names, and connected account addresses are sent to Google Gemini only after you click Prepare plan. GENESIS does not store them.",
    preparing: `${providerName} is preparing the plan…`,
    prepare: "Prepare plan",
    review: "Review before creation",
    defaultSummary: `${providerName} prepared a plan`,
    understood: "Understood:",
    projects: "Projects",
    taskLists: "Google Tasks lists",
    tasks: "Tasks",
    empty: "No creation actions were found in the command. Clarify the wording and try again.",
    edit: "Edit command",
    creating: "Creating…",
    createAll: (count: number) => `Create all · ${count}`,
  } : {
    eyebrow: `GENESIS Voice · ${providerName}`,
    title: "Создание задач голосом",
    close: "Закрыть голосовой помощник",
    intro: `Продиктуйте или напишите, какие проекты, списки Google Tasks и задачи нужно создать. Перед сохранением ${providerName} покажет полный план.`,
    stopRecording: "Остановить запись",
    recordAgain: "Записать заново",
    record: "Записать голосовую команду",
    recording: "Идёт запись · максимум 60 секунд",
    recordingReady: (kilobytes: number) => `Запись готова · ${kilobytes} КБ`,
    microphoneHint: "Микрофон включается только после нажатия",
    command: "Команда текстом",
    placeholder: "Например: создай задачу позвонить врачу завтра в 18:00 в проекте Здоровье",
    privacy: provider === "gigachat"
      ? "После нажатия «Подготовить план» запись и контекст отправляются в GigaChat; GENESIS не хранит запись и запрашивает её удаление из файлового хранилища GigaChat сразу после разбора."
      : "Запись, текст команды, названия элементов и адреса подключённых аккаунтов отправляются в Google Gemini только после нажатия «Подготовить план». GENESIS их не сохраняет.",
    preparing: `${providerName} составляет план…`,
    prepare: "Подготовить план",
    review: "Проверка перед созданием",
    defaultSummary: `${providerName} подготовил план`,
    understood: "Распознано:",
    projects: "Проекты",
    taskLists: "Списки Google Tasks",
    tasks: "Задачи",
    empty: "В команде не найдено действий для создания. Уточните формулировку и попробуйте ещё раз.",
    edit: "Изменить команду",
    creating: "Создание…",
    createAll: (count: number) => `Создать всё · ${count}`,
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
  };

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
  }, []);

  const startRecording = async () => {
    setError("");
    setMessage("");
    setPlan(null);
    setAudio(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(language === "en" ? "Voice recording is not supported in this browser." : "Этот браузер не поддерживает запись голоса.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError(language === "en" ? "Voice recording failed." : "Не удалось записать голос.");
        setRecording(false);
        stopStream();
      };
      recorder.onstop = () => {
        const recording = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        setRecording(false);
        stopStream();
        if (!recording.size) {
          setError(language === "en" ? "The voice recording is empty." : "Запись голоса оказалась пустой.");
          return;
        }
        if (recording.size > MAX_AUDIO_BYTES) {
          setError(language === "en" ? "The recording is larger than 4 MB." : "Запись превышает 4 МБ.");
          return;
        }
        void blobToBase64(recording, language)
          .then((data) => setAudio({ data, mimeType: recording.type || "audio/webm", bytes: recording.size }))
          .catch((readError) => setError(assistantError(readError, language, provider)));
      };
      recorder.start(250);
      setRecording(true);
      stopTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, MAX_RECORDING_MS);
    } catch (recordError) {
      stopStream();
      setError(recordError instanceof DOMException && recordError.name === "NotAllowedError"
        ? (language === "en" ? "Allow microphone access to record a command." : "Разрешите доступ к микрофону, чтобы записать команду.")
        : (language === "en" ? "Could not access the microphone." : "Не удалось получить доступ к микрофону."));
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const analyze = async () => {
    if (recording) {
      setError(language === "en" ? "Stop the recording before analysis." : "Остановите запись перед анализом.");
      return;
    }
    if (!command.trim() && !audio) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestAssistantPlan({
        command: command.trim(),
        audio: audio ? { data: audio.data, mimeType: audio.mimeType } : null,
        context,
      });
      setPlan(result.plan);
      setModel(result.model);
    } catch (requestError) {
      setError(assistantError(requestError, language, provider));
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
      setAudio(null);
    } catch (applyError) {
      setError(assistantError(applyError, language, provider));
    } finally {
      setBusy(false);
    }
  };

  const actionCount = plan ? plan.projects.length + plan.taskLists.length + plan.tasks.length : 0;

  return (
    <div className="modal-backdrop gemini-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section ref={dialogRef} className="gemini-assistant" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="gemini-assistant-title" tabIndex={-1}>
        <header>
          <div className="gemini-mark" aria-hidden="true">✦</div>
          <div>
            <span className="eyebrow">{labels.eyebrow}</span>
            <h2 id="gemini-assistant-title">{labels.title}</h2>
          </div>
          <DialogCloseButton type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label={labels.close} />
        </header>

        <p className="gemini-intro">{labels.intro}</p>
        <button type="button" className="secondary-button" onClick={onStartControl} disabled={busy || recording}>
          {language === "en" ? "Start background voice control" : "Включить фоновое управление голосом"}
        </button>

        <div className={`gemini-recorder${recording ? " recording" : ""}`}>
          <button type="button" className="gemini-record-button" onClick={() => void (recording ? stopRecording() : startRecording())} disabled={busy}>
            <span aria-hidden="true">{recording ? "■" : "●"}</span>
            {recording ? labels.stopRecording : audio ? labels.recordAgain : labels.record}
          </button>
          <small>{recording
            ? labels.recording
            : audio
              ? labels.recordingReady(Math.max(1, Math.round(audio.bytes / 1024)))
              : labels.microphoneHint}</small>
        </div>

        <label className="gemini-command-field">
          <span>{labels.command}</span>
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={labels.placeholder}
            rows={4}
            maxLength={4000}
            disabled={busy}
          />
        </label>

        <p className="gemini-privacy"><span aria-hidden="true">◇</span> {labels.privacy}</p>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {message ? <p className="form-success" role="status">{message}</p> : null}

        {!plan ? (
          <button type="button" className="gemini-primary" onClick={() => void analyze()} disabled={busy || recording || (!command.trim() && !audio)}>
            {busy ? labels.preparing : labels.prepare}
          </button>
        ) : (
          <div className="gemini-plan">
            <div className="gemini-plan-heading">
              <div>
                <span className="eyebrow">{labels.review}</span>
                <h3 data-no-translate>{plan.summary || labels.defaultSummary}</h3>
              </div>
              {model ? <small>{model}</small> : null}
            </div>
            {plan.request ? <p className="gemini-understood"><strong>{labels.understood}</strong> <span data-no-translate>{plan.request}</span></p> : null}

            {plan.projects.length ? (
              <section>
                <h4>{labels.projects} · {plan.projects.length}</h4>
                {plan.projects.map((project, index) => (
                  <article key={`project-${index}-${project.title}`}>
                    <strong data-no-translate>{project.title}</strong>
                    {project.description ? <p data-no-translate>{project.description}</p> : null}
                    <small data-no-translate>{[project.category, project.parentProject, ...project.tags.map((tag) => `#${tag}`)].filter(Boolean).join(" · ")}</small>
                  </article>
                ))}
              </section>
            ) : null}

            {plan.taskLists.length ? (
              <section>
                <h4>{labels.taskLists} · {plan.taskLists.length}</h4>
                {plan.taskLists.map((taskList, index) => (
                  <article key={`list-${index}-${taskList.title}`}>
                    <strong data-no-translate>{taskList.title}</strong>
                    <small data-no-translate>{[taskList.project, taskList.accountEmail].filter(Boolean).join(" · ")}</small>
                  </article>
                ))}
              </section>
            ) : null}

            {plan.tasks.length ? (
              <section>
                <h4>{labels.tasks} · {plan.tasks.length}</h4>
                {plan.tasks.map((task, index) => (
                  <article key={`task-${index}-${task.title}`}>
                    <strong data-no-translate>{task.title}</strong>
                    {task.description ? <p data-no-translate>{task.description}</p> : null}
                    <small data-no-translate>{[`${task.startDate} — ${task.dueDate}`, task.time, task.project, task.taskList, `P${task.priority}`].filter(Boolean).join(" · ")}</small>
                  </article>
                ))}
              </section>
            ) : null}

            {!actionCount ? <p className="gemini-empty">{labels.empty}</p> : null}

            <div className="gemini-plan-actions">
              <button type="button" onClick={() => setPlan(null)} disabled={busy}>{labels.edit}</button>
              <button type="button" className="gemini-primary" onClick={() => void apply()} disabled={busy || !actionCount}>
                {busy ? labels.creating : labels.createAll(actionCount)}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
