export const GENESIS_THEME = Object.freeze({
  STANDART: "standart",
  STANDART_DARK: "standart-dark",
  EXPERIMENTAL: "experimental",
  EXPERIMENTAL_DARK: "experimental-dark",
} as const);

export type GenesisTheme = (typeof GENESIS_THEME)[keyof typeof GENESIS_THEME];
export type ThemeControllerStatus =
  | "signed-out"
  | "loading"
  | "ready"
  | "saving"
  | "unavailable"
  | "load-error"
  | "error";

export type ThemeControllerState = Readonly<{
  accountId: string | null;
  theme: GenesisTheme;
  savedTheme: GenesisTheme;
  status: ThemeControllerStatus;
  pending: boolean;
  available: boolean;
  error: "conflict" | "save-failed" | "load-failed" | null;
}>;

export type ThemePreferenceRecord = {
  theme: GenesisTheme | null | undefined;
  revision: number | null | undefined;
};

export type ThemePreferenceAdapter = {
  read: (input: { accountId: string; signal: AbortSignal; fresh?: boolean }) => Promise<ThemePreferenceRecord>;
  write: (input: {
    accountId: string;
    theme: GenesisTheme;
    expectedRevision: number | null;
    signal: AbortSignal;
  }) => Promise<ThemePreferenceRecord>;
};

type ThemeSession = {
  id: string;
  abort: AbortController;
  saved: GenesisTheme;
  desired: GenesisTheme;
  revision: number | null;
  ready: boolean;
  flushing: boolean;
  requestNumber: number;
};

export type GenesisThemeController = Readonly<{
  getState: () => ThemeControllerState;
  subscribe: (listener: (state: ThemeControllerState) => void) => () => void;
  bindAccount: (
    accountId: string | null,
    options?: { verifiedInitialPreference?: { accountId: string; theme: unknown } },
  ) => Promise<ThemeControllerState>;
  setTheme: (theme: GenesisTheme) => ThemeControllerState;
  retry: () => ThemeControllerState;
  setAvailable: (available: boolean) => void;
  destroy: () => void;
}>;

export const GENESIS_THEME_LABEL: Readonly<Record<GenesisTheme, string>> = Object.freeze({
  standart: "Standart",
  "standart-dark": "Standart · Dark",
  experimental: "Experimental",
  "experimental-dark": "Experimental · Dark",
});

export const GENESIS_THEME_ATTRIBUTE = "data-genesis-theme";

export function normalizeGenesisTheme(value: unknown): GenesisTheme {
  if (value === GENESIS_THEME.STANDART_DARK) return GENESIS_THEME.STANDART_DARK;
  if (value === GENESIS_THEME.EXPERIMENTAL_DARK) return GENESIS_THEME.EXPERIMENTAL_DARK;
  return value === GENESIS_THEME.EXPERIMENTAL
    ? GENESIS_THEME.EXPERIMENTAL
    : GENESIS_THEME.STANDART;
}

export function withExperimentalTheme(theme: GenesisTheme, enabled: boolean): GenesisTheme {
  const dark = theme.endsWith("-dark");
  return enabled
    ? dark ? GENESIS_THEME.EXPERIMENTAL_DARK : GENESIS_THEME.EXPERIMENTAL
    : dark ? GENESIS_THEME.STANDART_DARK : GENESIS_THEME.STANDART;
}

export function withThemeColorMode(theme: GenesisTheme, dark: boolean): GenesisTheme {
  return theme.startsWith("experimental")
    ? dark ? GENESIS_THEME.EXPERIMENTAL_DARK : GENESIS_THEME.EXPERIMENTAL
    : dark ? GENESIS_THEME.STANDART_DARK : GENESIS_THEME.STANDART;
}

export class ThemeConflictError extends Error {
  constructor(message = "Theme preference revision conflict") {
    super(message);
    this.name = "ThemeConflictError";
  }
}

export function createGenesisThemeController({
  root,
  adapter,
  enabled = true,
  onSubscriberError = () => undefined,
}: {
  root: Pick<HTMLElement, "setAttribute">;
  adapter: ThemePreferenceAdapter;
  enabled?: boolean;
  onSubscriberError?: (error: unknown) => void;
}): GenesisThemeController {
  if (!root || typeof root.setAttribute !== "function") throw new TypeError("A DOM root is required");
  if (!adapter || typeof adapter.read !== "function" || typeof adapter.write !== "function") {
    throw new TypeError("An account theme adapter is required");
  }

  const subscribers = new Set<(state: ThemeControllerState) => void>();
  let session: ThemeSession | null = null;
  let destroyed = false;
  let allowed = Boolean(enabled);
  let state: ThemeControllerState = Object.freeze({
    accountId: null,
    theme: GENESIS_THEME.STANDART,
    savedTheme: GENESIS_THEME.STANDART,
    status: "signed-out",
    pending: false,
    available: allowed,
    error: null,
  });

  const snapshot = () => state;
  const replaceState = (next: Omit<ThemeControllerState, never>) => {
    state = Object.freeze(next);
  };
  const paint = () => root.setAttribute(
    GENESIS_THEME_ATTRIBUTE,
    allowed ? normalizeGenesisTheme(state.theme) : GENESIS_THEME.STANDART,
  );
  const emit = () => {
    paint();
    for (const subscriber of subscribers) {
      try {
        subscriber(snapshot());
      } catch (error) {
        onSubscriberError(error);
      }
    }
  };
  const isCurrent = (candidate: ThemeSession) => !destroyed
    && candidate === session
    && !candidate.abort.signal.aborted;
  const assertAlive = () => {
    if (destroyed) throw new Error("Theme controller is destroyed");
  };
  const cancelSession = () => {
    session?.abort.abort();
    session = null;
  };

  const flush = async (currentSession: ThemeSession) => {
    if (currentSession.flushing || !isCurrent(currentSession) || !currentSession.ready || !allowed) return;
    currentSession.flushing = true;
    let conflictRetries = 0;
    try {
      while (isCurrent(currentSession) && allowed && currentSession.desired !== currentSession.saved) {
        const requested = currentSession.desired;
        const requestNumber = currentSession.requestNumber;
        replaceState({ ...state, status: "saving", pending: true, error: null });
        emit();
        try {
          const response = await adapter.write({
            accountId: currentSession.id,
            theme: requested,
            expectedRevision: currentSession.revision,
            signal: currentSession.abort.signal,
          });
          if (!isCurrent(currentSession)) return;
          if (
            normalizeGenesisTheme(response?.theme) !== requested
            || response?.revision === undefined
            || response?.revision === null
          ) {
            throw new Error("Theme adapter did not acknowledge the requested value and revision");
          }
          currentSession.saved = requested;
          currentSession.revision = response.revision;
          replaceState({ ...state, savedTheme: currentSession.saved });
        } catch (error) {
          if (!isCurrent(currentSession)) return;
          if (currentSession.requestNumber !== requestNumber && !(error instanceof ThemeConflictError)) continue;
          if (error instanceof ThemeConflictError && conflictRetries < 2) {
            try {
              const response = await adapter.read({
                accountId: currentSession.id,
                signal: currentSession.abort.signal,
                fresh: true,
              });
              if (!isCurrent(currentSession)) return;
              if (response?.revision === undefined || response?.revision === null) {
                throw new Error("Theme adapter did not return a current revision");
              }
              currentSession.saved = normalizeGenesisTheme(response.theme);
              currentSession.revision = Math.max(0, Number(response.revision));
              replaceState({ ...state, savedTheme: currentSession.saved, error: null });
              conflictRetries += 1;
              continue;
            } catch {
              if (!isCurrent(currentSession)) return;
            }
          }
          replaceState({
            ...state,
            theme: currentSession.desired,
            savedTheme: currentSession.saved,
            status: "error",
            pending: false,
            error: error instanceof ThemeConflictError ? "conflict" : "save-failed",
          });
          emit();
          return;
        }
      }
      if (isCurrent(currentSession)) {
        replaceState({
          ...state,
          theme: allowed ? currentSession.desired : GENESIS_THEME.STANDART,
          savedTheme: currentSession.saved,
          pending: false,
          status: allowed ? "ready" : "unavailable",
          error: null,
        });
        emit();
      }
    } finally {
      currentSession.flushing = false;
    }
  };

  emit();

  return Object.freeze({
    getState: snapshot,
    subscribe(listener) {
      assertAlive();
      if (typeof listener !== "function") throw new TypeError("Theme listener must be a function");
      subscribers.add(listener);
      listener(snapshot());
      return () => subscribers.delete(listener);
    },
    async bindAccount(accountId, { verifiedInitialPreference } = {}) {
      assertAlive();
      cancelSession();
      if (!accountId) {
        replaceState({
          accountId: null,
          theme: GENESIS_THEME.STANDART,
          savedTheme: GENESIS_THEME.STANDART,
          status: "signed-out",
          pending: false,
          available: allowed,
          error: null,
        });
        emit();
        return snapshot();
      }
      if (typeof accountId !== "string") throw new TypeError("Opaque account ID must be a string");
      const initial = verifiedInitialPreference?.accountId === accountId
        ? normalizeGenesisTheme(verifiedInitialPreference.theme)
        : GENESIS_THEME.STANDART;
      const currentSession: ThemeSession = {
        id: accountId,
        abort: new AbortController(),
        saved: initial,
        desired: initial,
        revision: null,
        ready: false,
        flushing: false,
        requestNumber: 0,
      };
      session = currentSession;
      replaceState({
        accountId,
        theme: allowed ? initial : GENESIS_THEME.STANDART,
        savedTheme: initial,
        status: "loading",
        pending: true,
        available: allowed,
        error: null,
      });
      emit();
      try {
        const response = await adapter.read({ accountId, signal: currentSession.abort.signal });
        if (!isCurrent(currentSession)) return snapshot();
        currentSession.saved = normalizeGenesisTheme(response?.theme);
        currentSession.desired = currentSession.saved;
        currentSession.revision = typeof response?.revision === "number" ? response.revision : 0;
        currentSession.ready = true;
        replaceState({
          ...state,
          theme: allowed ? currentSession.saved : GENESIS_THEME.STANDART,
          savedTheme: currentSession.saved,
          status: allowed ? "ready" : "unavailable",
          pending: false,
          error: null,
        });
        emit();
      } catch {
        if (!isCurrent(currentSession)) return snapshot();
        replaceState({
          ...state,
          theme: allowed ? initial : GENESIS_THEME.STANDART,
          status: "load-error",
          pending: false,
          error: "load-failed",
        });
        emit();
      }
      return snapshot();
    },
    setTheme(value) {
      assertAlive();
      if (!Object.values(GENESIS_THEME).includes(value)) {
        throw new TypeError("Unknown GENESIS theme");
      }
      if (!allowed) throw new Error("Experimental theme is unavailable in this build");
      const currentSession = session;
      if (!currentSession || !currentSession.ready) throw new Error("Account theme preference is not ready");
      currentSession.requestNumber += 1;
      currentSession.desired = value;
      replaceState({
        ...state,
        theme: value,
        error: null,
        status: currentSession.desired !== currentSession.saved || currentSession.flushing ? "saving" : "ready",
        pending: currentSession.desired !== currentSession.saved || currentSession.flushing,
      });
      emit();
      void flush(currentSession);
      return snapshot();
    },
    retry() {
      assertAlive();
      const currentSession = session;
      if (currentSession?.ready && allowed && currentSession.desired !== currentSession.saved) {
        void flush(currentSession);
      }
      return snapshot();
    },
    setAvailable(value) {
      assertAlive();
      allowed = Boolean(value);
      replaceState({ ...state, available: allowed });
      if (!allowed) {
        replaceState({ ...state, theme: GENESIS_THEME.STANDART, status: "unavailable" });
      } else if (session?.ready) {
        replaceState({ ...state, theme: session.desired, status: session.flushing ? "saving" : "ready" });
        void flush(session);
      }
      emit();
    },
    destroy() {
      if (destroyed) return;
      cancelSession();
      destroyed = true;
      subscribers.clear();
      root.setAttribute(GENESIS_THEME_ATTRIBUTE, GENESIS_THEME.STANDART);
    },
  });
}
