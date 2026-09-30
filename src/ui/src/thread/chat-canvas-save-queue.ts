import type { ChatCanvasLayoutDto } from "../../../presentation/desktop/chat/contracts.ts";

/** Keep the latest layout until the host acknowledges it. One save runs at a time. */
export class ChatCanvasSaveQueue {
  #latest?: { readonly version: number; readonly layout: ChatCanvasLayoutDto };
  #savedVersion = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #inFlight?: Promise<boolean>;
  #error?: string;
  readonly #listeners = new Set<(error: string | undefined) => void>();

  constructor(
    private readonly send: (layout: ChatCanvasLayoutDto) => Promise<void>,
    private readonly onError: (message: string) => void,
    private readonly delayMs = 500,
  ) {}

  get layout(): ChatCanvasLayoutDto | undefined {
    return this.#latest?.layout;
  }

  get hasPending(): boolean {
    return this.#latest !== undefined &&
      this.#latest.version > this.#savedVersion;
  }

  get error(): string | undefined {
    return this.#error;
  }

  subscribe(listener: (error: string | undefined) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#error);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  schedule(layout: ChatCanvasLayoutDto): void {
    this.#latest = {
      version: (this.#latest?.version ?? this.#savedVersion) + 1,
      layout,
    };
    this.#error = undefined;
    this.#notify();
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      void this.flush();
    }, this.delayMs);
  }

  async flush(): Promise<boolean> {
    this.#clearTimer();
    if (this.#inFlight !== undefined) {
      const completed = await this.#inFlight;
      return completed && this.flush();
    }
    const latest = this.#latest;
    if (latest === undefined || latest.version <= this.#savedVersion) {
      return true;
    }
    const run = this.send(latest.layout).then(
      () => {
        this.#savedVersion = latest.version;
        this.#error = undefined;
        this.#notify();
        return true;
      },
      (cause: unknown) => {
        this.#error = cause instanceof Error
          ? cause.message
          : "Canvas layout failed to save.";
        this.onError(this.#error);
        this.#notify();
        return false;
      },
    );
    this.#inFlight = run;
    const completed = await run;
    this.#inFlight = undefined;
    return completed && this.flush();
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#error);
  }
}
