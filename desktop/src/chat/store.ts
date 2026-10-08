import type { StoredConversation } from "./store-types.ts";
export type {
  StoredConversation,
  StoredToolResult,
  StoredWorkArtifact,
} from "./store-types.ts";
import {
  ARTIFACT_FILE_SUFFIX,
  artifactFileName,
  CHAT_STORE_SCHEMA,
  CHAT_TRANSCRIPT_SCHEMA,
  CONVERSATION_ID_PATTERN,
  isArtifactSha,
  readConversationIndex,
  readTranscriptData,
  referencedArtifactDigests,
} from "./store-codec.ts";

/** Bounded retention backing saved work; undefined means unbounded. */
export interface ChatStoreRetention {
  readonly days: number;
  readonly maxConversations: number;
}

export interface ChatConversationStore {
  load(): Promise<readonly StoredConversation[]>;
  save(conversations: readonly StoredConversation[]): Promise<void>;
  /** Retain exact artifact bytes keyed by hex digest. */
  saveArtifact(sha256: string, bytes: Uint8Array): Promise<void>;
  /** Load retained bytes, or undefined when never saved or pruned. */
  loadArtifact(sha256: string): Promise<Uint8Array | undefined>;
  /** Retention policy backing saved work; undefined when unbounded. */
  retention(): ChatStoreRetention | undefined;
}

export class MemoryChatConversationStore implements ChatConversationStore {
  #value: readonly StoredConversation[] = [];
  readonly #artifacts = new Map<string, Uint8Array>();

  load(): Promise<readonly StoredConversation[]> {
    return Promise.resolve(structuredClone(this.#value));
  }

  save(conversations: readonly StoredConversation[]): Promise<void> {
    this.#value = structuredClone(conversations);
    const referenced = referencedArtifactDigests(this.#value);
    for (const sha256 of [...this.#artifacts.keys()]) {
      if (!referenced.has(sha256)) this.#artifacts.delete(sha256);
    }
    return Promise.resolve();
  }

  saveArtifact(sha256: string, bytes: Uint8Array): Promise<void> {
    if (!isArtifactSha(sha256)) {
      return Promise.reject(new TypeError("artifact digest is invalid"));
    }
    this.#artifacts.set(sha256, Uint8Array.from(bytes));
    return Promise.resolve();
  }

  loadArtifact(sha256: string): Promise<Uint8Array | undefined> {
    if (!isArtifactSha(sha256)) return Promise.resolve(undefined);
    const bytes = this.#artifacts.get(sha256);
    return Promise.resolve(bytes === undefined ? undefined : Uint8Array.from(bytes));
  }

  retention(): ChatStoreRetention | undefined {
    return undefined;
  }
}

export interface FileChatConversationStoreOptions {
  readonly root: string;
  readonly now?: () => Date;
  readonly retentionDays?: number;
  readonly maxConversations?: number;
  readonly maxMessagesPerConversation?: number;
  /** Post-commit artifact cleanup port, injectable for failure tests. */
  readonly removeArtifactFile?: (path: string) => Promise<void>;
}

/**
 * Desktop chat metadata and transcripts live below a dedicated product-data
 * directory. They are never written into Thread/CAS state.
 */
export class FileChatConversationStore implements ChatConversationStore {
  readonly #root: string;
  readonly #now: () => Date;
  readonly #retentionMs: number;
  readonly #maxConversations: number;
  readonly #maxMessages: number;
  readonly #removeArtifactFile: (path: string) => Promise<void>;

  constructor(options: FileChatConversationStoreOptions) {
    this.#root = options.root;
    this.#now = options.now ?? (() => new Date());
    this.#retentionMs = (options.retentionDays ?? 30) * 86_400_000;
    this.#maxConversations = options.maxConversations ?? 50;
    this.#maxMessages = options.maxMessagesPerConversation ?? 400;
    this.#removeArtifactFile = options.removeArtifactFile ??
      ((path) => Deno.remove(path));
  }

  async load(): Promise<readonly StoredConversation[]> {
    let index: ReturnType<typeof readConversationIndex>;
    try {
      index = readConversationIndex(
        JSON.parse(await Deno.readTextFile(this.#indexPath())),
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const conversations: StoredConversation[] = [];
    for (const metadata of index.conversations) {
      if (Date.parse(metadata.updatedAt) < cutoff) continue;
      try {
        const transcript = readTranscriptData(
          JSON.parse(await Deno.readTextFile(this.#transcriptPath(metadata.id))),
          metadata.id,
        );
        conversations.push(Object.freeze({
          ...metadata,
          status: metadata.status === "running" || metadata.status === "queued"
            ? "idle"
            : metadata.status,
          messages: Object.freeze(transcript.messages.slice(-this.#maxMessages)),
        }));
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    return Object.freeze(
      conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, this.#maxConversations),
    );
  }

  async save(conversations: readonly StoredConversation[]): Promise<void> {
    await Deno.mkdir(`${this.#root}/transcripts`, { recursive: true, mode: 0o700 });
    await Deno.mkdir(`${this.#root}/artifacts`, { recursive: true, mode: 0o700 });
    const cutoff = this.#now().getTime() - this.#retentionMs;
    const retained = [...conversations]
      .filter((entry) => Date.parse(entry.updatedAt) >= cutoff)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, this.#maxConversations);
    for (const entry of retained) {
      await atomicWriteJson(this.#transcriptPath(entry.id), {
        schemaVersion: CHAT_TRANSCRIPT_SCHEMA,
        conversationId: entry.id,
        messages: entry.messages.slice(-this.#maxMessages),
      });
    }
    const retainedFiles = new Set(retained.map((entry) => `${entry.id}.json`));
    for await (const entry of Deno.readDir(`${this.#root}/transcripts`)) {
      if (
        entry.isFile && transcriptFileName(entry.name) &&
        !retainedFiles.has(entry.name)
      ) await Deno.remove(`${this.#root}/transcripts/${entry.name}`);
    }
    await atomicWriteJson(this.#indexPath(), {
      schemaVersion: CHAT_STORE_SCHEMA,
      conversations: retained.map(({ messages: _messages, ...metadata }) => metadata),
    });
    // Message pruning never drops artifact bytes: only bytes unreferenced
    // by every retained conversation prune, on conversation retention.
    try {
      await this.#pruneArtifacts(referencedArtifactDigests(retained));
    } catch {
      // The index already committed. A failed cleanup cannot turn this save
      // into a reported failure; the next save will retry unreferenced bytes.
      console.warn("Chat artifact cleanup failed after commit; retrying on next save.");
    }
  }

  async saveArtifact(sha256: string, bytes: Uint8Array): Promise<void> {
    await Deno.mkdir(`${this.#root}/artifacts`, { recursive: true, mode: 0o700 });
    const temporary = `${this.#artifactPath(sha256)}.tmp`;
    await Deno.writeFile(temporary, bytes, { mode: 0o600 });
    await Deno.rename(temporary, this.#artifactPath(sha256));
  }

  async loadArtifact(sha256: string): Promise<Uint8Array | undefined> {
    if (!isArtifactSha(sha256)) return undefined;
    try {
      return await Deno.readFile(this.#artifactPath(sha256));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  retention(): ChatStoreRetention | undefined {
    return {
      days: this.#retentionMs / 86_400_000,
      maxConversations: this.#maxConversations,
    };
  }

  async #pruneArtifacts(referenced: ReadonlySet<string>): Promise<void> {
    for await (const entry of Deno.readDir(`${this.#root}/artifacts`)) {
      if (!entry.isFile || !entry.name.endsWith(ARTIFACT_FILE_SUFFIX)) continue;
      const sha256 = entry.name.slice(0, -ARTIFACT_FILE_SUFFIX.length);
      if (!isArtifactSha(sha256) || referenced.has(sha256)) continue;
      await this.#removeArtifactFile(`${this.#root}/artifacts/${entry.name}`);
    }
  }

  #indexPath(): string {
    return `${this.#root}/conversations.json`;
  }

  #artifactPath(sha256: string): string {
    return `${this.#root}/artifacts/${artifactFileName(sha256)}`;
  }

  #transcriptPath(id: string): string {
    if (!CONVERSATION_ID_PATTERN.test(id)) {
      throw new TypeError("conversation id is invalid");
    }
    return `${this.#root}/transcripts/${id}.json`;
  }
}

function transcriptFileName(name: string): boolean {
  return name.endsWith(".json") &&
    CONVERSATION_ID_PATTERN.test(name.slice(0, -".json".length));
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await Deno.writeTextFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await Deno.rename(temporary, path);
}
