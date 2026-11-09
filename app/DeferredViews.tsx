"use client";
import { Component, lazy, type ReactNode, type ErrorInfo } from "react";
import { translateText } from "./i18n";
import { importWithRecovery, isModuleLoadError } from "./module-recovery";

export const lazyWithRecovery: typeof lazy = load => lazy(() => importWithRecovery(load));

export function DeferredViewFallback({ label }: { label: string }) {
  return <section className="deferred-view-loading" role="status" aria-live="polite"><span aria-hidden="true"><i /></span><strong>{label}</strong></section>;
}

export function DeferredDialogFallback({ label }: { label: string }) {
  return <div className="modal-backdrop deferred-dialog-backdrop" role="status" aria-live="polite"><div><span aria-hidden="true"><i /></span><strong>{label}</strong></div></div>;
}

export function DeferredHabitFallback({ label }: { label: string }) {
  return <section className="deferred-habit-loading" role="status" aria-live="polite"><span aria-hidden="true"><i /></span><strong>{label}</strong></section>;
}

export class ViewErrorBoundary extends Component<{
  children: ReactNode;
  resetKey: string;
}, { hasError: boolean; moduleFailed: boolean }> {
  state = { hasError: false, moduleFailed: false };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, moduleFailed: isModuleLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("GENESIS view rendering failed", error, info);
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, moduleFailed: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <section className="view-error-state" role="alert">
        <span aria-hidden="true">◇</span>
        <div>
          <strong>{translateText("Раздел не удалось отобразить")}</strong>
          <p>{translateText(this.state.moduleFailed
            ? "Не удалось загрузить раздел после повторной попытки. Проверьте соединение. Перед обновлением страницы сохраните открытые черновики."
            : "Остальные разделы продолжают работать. Перед обновлением страницы сохраните открытые черновики.")}</p>
        </div>
        <button type="button" onClick={() => window.location.reload()}>{translateText("Обновить страницу")}</button>
      </section>
    );
  }
}
