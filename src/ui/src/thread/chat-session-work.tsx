import { useState } from "react";
import type { JSX } from "react";
import { Button } from "../ui/button.tsx";
import type {
  ChatCommandResponse,
  ChatConversationDto,
  ChatRetentionDto,
  ChatToolViewerDto,
  DesktopChatBindingCommandRequest,
} from "../../../presentation/desktop/chat/contracts.ts";
import { DESKTOP_CHAT_PROTOCOL } from "../../../presentation/desktop/chat/contracts.ts";
import type { ChatViewerDispatch } from "./chat-viewer-panel.tsx";

export interface ChatSessionWorkListProps {
  readonly conversation: ChatConversationDto;
  readonly retention: ChatRetentionDto | undefined;
  readonly sendMessage: (text: string) => void;
  readonly dispatch: ChatViewerDispatch | undefined;
  readonly command: (
    request: DesktopChatBindingCommandRequest,
  ) => Promise<ChatCommandResponse | undefined>;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return new Date(time).toLocaleString();
}

/**
 * Per-session saved-work list (#51): one row per result version with its
 * revision, outcome, and retained exports. Hashes and protocol detail stay
 * in inspection; opening and exporting stay on the per-message viewer.
 */
export function ChatSessionWorkList({
  conversation,
  retention,
  sendMessage,
  dispatch,
  command,
}: ChatSessionWorkListProps): JSX.Element {
  const versions = [...conversation.viewers].reverse();
  return (
    <section
      className="desktop-chat-session-work"
      aria-label="Saved session work"
    >
      <div className="desktop-chat-project-line">
        <span>Saved work</span>
        <strong>Session work — not Thread evidence</strong>
      </div>
      <p className="desktop-chat-viewer-status">
        {retention === undefined
          ? "Kept for this session."
          : `Kept about ${retention.days} days · at most ${retention.maxConversations} conversations.`}
        {retention?.maxVersions !== undefined &&
          ` At most ${retention.maxVersions} tool versions per conversation; older versions retire with a transcript notice.`}
        {" "}
        Trimming messages never deletes saved bytes; dropping a whole
        conversation deletes its bytes with it.
      </p>
      {versions.length === 0 && (
        <p className="desktop-chat-viewer-status">
          No tool results yet. Saved versions will list here.
        </p>
      )}
      <ol>
        {versions.map((viewer) => (
          <WorkVersionRow
            key={viewer.viewerId}
            viewer={viewer}
            conversationId={conversation.id}
            sendMessage={sendMessage}
            dispatch={dispatch}
            command={command}
          />
        ))}
      </ol>
    </section>
  );
}

function WorkVersionRow({
  viewer,
  conversationId,
  sendMessage,
  dispatch,
  command,
}: {
  readonly viewer: ChatToolViewerDto;
  readonly conversationId: string;
  readonly sendMessage: (text: string) => void;
  readonly dispatch: ChatViewerDispatch | undefined;
  readonly command: ChatSessionWorkListProps["command"];
}): JSX.Element {
  const archive = viewer.archive;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const run = async (task: () => Promise<string>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      setNotice(await task());
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };
  const exportSource = (): Promise<void> =>
    run(async () => {
      if (dispatch === undefined) {
        throw new Error("File export is unavailable.");
      }
      const response = await command({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: `ui:${crypto.randomUUID()}`,
        command: "viewer.archive-read",
        conversationId,
        viewerId: viewer.viewerId,
      });
      const capture = response?.viewerCapture;
      if (!response?.ok || capture?.viewerId !== viewer.viewerId) {
        throw new Error(response?.error ?? "Saved source is unavailable.");
      }
      const script = capture.toolInput.script;
      const source = typeof script === "string"
        ? script
        : JSON.stringify(capture.toolInput, null, 2);
      const tag = archive === undefined ? "source" : `v${archive.revision}`;
      const fileName = typeof script === "string"
        ? `${viewer.tool}-${tag}.py`
        : `${viewer.tool}-${tag}-input.json`;
      const saved = await dispatch.saveFile(
        fileName,
        base64FromBytes(new TextEncoder().encode(source)),
      );
      return `Saved ${saved.path} (${saved.bytes} bytes).`;
    });
  const exportArtifact = (uri: string, fileName: string): Promise<void> =>
    run(async () => {
      if (dispatch === undefined) {
        throw new Error("File export is unavailable.");
      }
      const resource = await dispatch.readViewerResource(
        conversationId,
        viewer.viewerId,
        uri,
      );
      const saved = await dispatch.saveFile(fileName, resource.data);
      return `Saved ${saved.path} (${saved.bytes} bytes, ${resource.source} bytes).`;
    });
  const label = archive === undefined
    ? `${viewer.tool} · unsaved`
    : `v${archive.revision} · ${viewer.tool} · ${
      formatDate(archive.capturedAt)
    }`;
  return (
    <li className="desktop-chat-work-version">
      <div className="desktop-chat-project-line">
        <span>{label}</span>
        {archive?.failed === true && <strong>failed</strong>}
      </div>
      {archive === undefined && (
        <p className="desktop-chat-viewer-status">
          Captured before saving existed. Re-run the tool to save this result.
        </p>
      )}
      {archive !== undefined && dispatch !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void exportSource()}
        >
          Export source
        </Button>
      )}
      {archive !== undefined && archive.artifacts.length === 0 && (
        <p className="desktop-chat-viewer-status">
          No export files in this result. The exact result data stays saved with
          the conversation.
        </p>
      )}
      {archive !== undefined && archive.artifacts.length > 0 && (
        <ul>
          {archive.artifacts.map((artifact) => (
            <li key={`${artifact.uri}:${artifact.sha256}`}>
              <span>
                {artifact.fileName} · {formatBytes(artifact.bytes)} ·{" "}
                {artifact.state}
                {artifact.state === "missing" && artifact.reason !== undefined
                  ? ` — ${artifact.reason}`
                  : ""}
              </span>
              {dispatch !== undefined && artifact.state === "saved" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void exportArtifact(artifact.uri, artifact.fileName)}
                >
                  Export file
                </Button>
              )}
              {artifact.state === "missing" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    sendMessage(
                      `Regenerate the saved result v${archive.revision} (${viewer.tool}) from its saved source; its retained ${artifact.fileName} bytes are missing (${
                        artifact.reason ?? "unknown cause"
                      }).`,
                    )}
                >
                  Regenerate with the agent
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice !== undefined && (
        <p className="desktop-chat-viewer-status" role="status">{notice}</p>
      )}
      {archive !== undefined && (
        <details>
          <summary>Inspection</summary>
          <dl>
            <dt>Server</dt>
            <dd>{archive.server}</dd>
            <dt>Result digest</dt>
            <dd>{archive.resultDigest}</dd>
            <dt>Tool call</dt>
            <dd>{viewer.toolCallId}</dd>
            <dt>App</dt>
            <dd>{viewer.appUri}</dd>
            {archive.artifacts.map((artifact) => (
              <div key={artifact.sha256}>
                <dt>{artifact.fileName}</dt>
                <dd>
                  {artifact.uri} · sha256 {artifact.sha256}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}
