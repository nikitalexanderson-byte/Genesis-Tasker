export type DreamRecognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: {results: ArrayLike<{isFinal: boolean; 0: {transcript: string}}>}) => void) | null;
  onerror: ((event: {error: string}) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
export type DreamRecognitionConstructor = new () => DreamRecognition;
type Callbacks = {text: (value: string, confirmed: boolean) => void; partial: (value: string) => void;
  listening: (value: boolean) => void; failure: () => void};

/** Each recognition cycle owns its callbacks. Repeated finals and late events cannot duplicate text. */
export class DreamDictation {
  private recognition: DreamRecognition | null = null;
  private wanted = false;
  private partial = '';
  private silence = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly Constructor: DreamRecognitionConstructor;
  private readonly locale: string;
  private readonly callbacks: Callbacks;
  constructor(Constructor: DreamRecognitionConstructor, locale: string, callbacks: Callbacks) {
    this.Constructor = Constructor; this.locale = locale; this.callbacks = callbacks;
  }

  start() { this.wanted = true; this.silence = 0; this.openCycle(); }

  /** User stop gives the engine a bounded chance to replace the visible hypothesis with its final. */
  stop() {
    this.wanted = false; clearTimeout(this.restartTimer);
    if (!this.recognition) { this.finish(); return; }
    this.finishTimer = setTimeout(() => this.finish(), 1500);
    try { this.recognition.stop(); } catch { this.finish(); }
  }

  /** Close/save can preserve the visible hypothesis synchronously, then detach all callbacks. */
  cancel(): string {
    const value = this.partial;
    this.partial = ''; this.wanted = false;
    clearTimeout(this.restartTimer); clearTimeout(this.finishTimer);
    this.detach(); this.callbacks.partial(''); this.callbacks.listening(false);
    return value;
  }

  private detach() {
    const old = this.recognition; this.recognition = null;
    if (old) { old.onresult = null; old.onerror = null; old.onend = null; try { old.abort(); } catch { /* Already closed. */ } }
  }

  private finish() {
    const remainder = this.partial;
    this.cancel();
    if (remainder.trim()) this.callbacks.text(remainder, false);
  }

  private openCycle() {
    if (!this.wanted) return;
    this.detach();
    let recognition: DreamRecognition;
    try { recognition = new this.Constructor(); }
    catch { this.finish(); this.callbacks.failure(); return; }
    this.recognition = recognition;
    recognition.lang = this.locale; recognition.continuous = true;
    recognition.interimResults = true; recognition.maxAlternatives = 1;
    const committed = new Set<number>();
    let heard = false;
    const active = () => this.recognition === recognition;
    recognition.onresult = event => {
      if (!active()) return;
      const phrases: string[] = [], partial: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index], text = result[0]?.transcript?.trim() ?? '';
        if (result.isFinal) {
          if (!committed.has(index)) { committed.add(index); if (text) phrases.push(text); }
        } else if (text) partial.push(text);
      }
      if (phrases.length || partial.length) { heard = true; this.silence = 0; }
      this.partial = partial.join(' '); this.callbacks.partial(this.partial);
      if (phrases.length) this.callbacks.text(phrases.join(' '), true);
    };
    recognition.onend = () => {
      if (!active()) return;
      const remainder = this.partial; this.partial = ''; this.callbacks.partial('');
      this.detach();
      if (remainder.trim()) this.callbacks.text(remainder, false);
      if (this.wanted && (heard || ++this.silence < 2)) {
        this.restartTimer = setTimeout(() => this.openCycle(), 150);
      } else this.finish();
    };
    recognition.onerror = event => {
      if (!active()) return;
      if (event.error === 'no-speech') { recognition.onend?.(); return; }
      const userStopped = !this.wanted;
      this.finish(); if (!userStopped || event.error !== 'aborted') this.callbacks.failure();
    };
    try { recognition.start(); this.callbacks.listening(true); }
    catch { this.finish(); this.callbacks.failure(); }
  }
}
