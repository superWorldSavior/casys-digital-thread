export interface ProjectWhiteboardHost {
  readonly element: HTMLElement;
  readonly viewport: HTMLElement;
  readonly transform: {
    readonly x: number;
    readonly y: number;
    readonly k: number;
  };
  readonly worldSize: { readonly width: number; readonly height: number };
  readonly reveal?: (rect: ProjectWhiteboardRect) => void;
}

export interface ProjectWhiteboardRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ProjectWhiteboardHostLease {
  update(host: ProjectWhiteboardHost): void;
  dispose(): void;
}

type HostListener = (host: ProjectWhiteboardHost | undefined) => void;
const hosts = new Map<string, { owner: symbol; host: ProjectWhiteboardHost }>();
const listeners = new Map<string, Set<HostListener>>();
const requests = new Map<string, Set<() => void>>();
const pendingFocus = new Set<string>();

function notify(projectId: string): void {
  const host = projectWhiteboardHost(projectId);
  for (const listener of listeners.get(projectId) ?? []) listener(host);
}

function focus(host: ProjectWhiteboardHost): void {
  host.viewport.scrollIntoView({ block: "nearest", inline: "nearest" });
  host.viewport.focus({ preventScroll: true });
}

/** Geometry and a mount point only; the owning sibling keeps its runtime. */
export function registerProjectWhiteboardHost(
  projectId: string,
  host: ProjectWhiteboardHost,
): ProjectWhiteboardHostLease {
  const owner = Symbol(projectId);
  hosts.set(projectId, { owner, host });
  notify(projectId);
  if (pendingFocus.delete(projectId)) focus(host);
  return {
    update(next) {
      if (hosts.get(projectId)?.owner !== owner) return;
      hosts.set(projectId, { owner, host: next });
      notify(projectId);
    },
    dispose() {
      if (hosts.get(projectId)?.owner !== owner) return;
      hosts.delete(projectId);
      notify(projectId);
    },
  };
}

export function projectWhiteboardHost(
  projectId: string,
): ProjectWhiteboardHost | undefined {
  return hosts.get(projectId)?.host;
}

export function subscribeProjectWhiteboardHost(
  projectId: string,
  listener: HostListener,
): () => void {
  let group = listeners.get(projectId);
  if (!group) listeners.set(projectId, group = new Set());
  group.add(listener);
  listener(projectWhiteboardHost(projectId));
  return () => {
    group.delete(listener);
    if (group.size === 0 && listeners.get(projectId) === group) {
      listeners.delete(projectId);
    }
  };
}

/** Project navigation subscribes; this request never crosses a server boundary. */
export function subscribeProjectWhiteboardRequest(
  projectId: string,
  listener: () => void,
): () => void {
  let group = requests.get(projectId);
  if (!group) requests.set(projectId, group = new Set());
  group.add(listener);
  return () => {
    group.delete(listener);
    if (group.size === 0 && requests.get(projectId) === group) {
      requests.delete(projectId);
    }
  };
}

export function requestProjectWhiteboard(projectId: string): void {
  const group = requests.get(projectId);
  if (!group?.size) return;
  pendingFocus.add(projectId);
  for (const listener of group) listener();
  const host = projectWhiteboardHost(projectId);
  if (host && pendingFocus.delete(projectId)) focus(host);
}

export function projectWhiteboardRevealTransform(
  viewport: { readonly width: number; readonly height: number },
  rect: ProjectWhiteboardRect,
): { x: number; y: number; k: number } {
  const k = Math.max(
    0.35,
    Math.min(
      1,
      viewport.width * 0.9 / rect.width,
      viewport.height * 0.9 / rect.height,
    ),
  );
  return {
    x: viewport.width / 2 - (rect.x + rect.width / 2) * k,
    y: viewport.height / 2 - (rect.y + rect.height / 2) * k,
    k,
  };
}
