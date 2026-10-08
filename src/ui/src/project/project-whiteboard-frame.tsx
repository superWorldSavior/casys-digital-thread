import { useLayoutEffect, useRef, useState } from "react";
import type { JSX, PointerEvent } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../ui/button.tsx";
import {
  type ProjectWhiteboardHostLease,
  type ProjectWhiteboardRect,
  projectWhiteboardRevealTransform,
  registerProjectWhiteboardHost,
} from "../ui/project-whiteboard-host.ts";
import {
  whiteboardToolbar,
  whiteboardToolbarButton,
} from "../ui/whiteboard.ts";
import {
  panOverviewThreadWhiteboard,
  zoomOverviewThreadWhiteboardAt,
  zoomOverviewThreadWhiteboardByWheel,
} from "./overview-thread-whiteboard-transform.ts";
import {
  loadOverviewThreadWhiteboardTransform,
  saveOverviewThreadWhiteboardTransform,
} from "./overview-thread-whiteboard-persistence.ts";

/** The same Project mounting surface before a recorded graph exists. */
export function ProjectWhiteboardFrame(
  { projectId }: { readonly projectId: string },
): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const lease = useRef<ProjectWhiteboardHostLease>();
  const pan = useRef<{ pointerId: number; x: number; y: number }>();
  const [storage] = useState(() => {
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  });
  const [transform, setTransform] = useState(() =>
    storage
      ? loadOverviewThreadWhiteboardTransform(storage, projectId) ??
        { x: 0, y: 0, k: 1 }
      : { x: 0, y: 0, k: 1 }
  );
  const previousTransform = useRef(transform);
  const [saveFailed, setSaveFailed] = useState(false);
  const [worldSize, setWorldSize] = useState({ width: 1600, height: 1200 });
  const reveal = (rect: ProjectWhiteboardRect) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setTransform(projectWhiteboardRevealTransform({
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }, rect));
  };
  useLayoutEffect(() => {
    const element = hostRef.current;
    const viewport = viewportRef.current;
    if (!element || !viewport) return;
    const registered = registerProjectWhiteboardHost(projectId, {
      element,
      viewport,
      transform,
      worldSize,
      reveal,
    });
    lease.current = registered;
    const observer = new ResizeObserver(() => {
      setWorldSize({
        width: Math.max(1600, viewport.clientWidth * 2),
        height: Math.max(1200, viewport.clientHeight * 2),
      });
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      registered.dispose();
      if (lease.current === registered) lease.current = undefined;
    };
  }, [projectId]);
  useLayoutEffect(() => {
    const element = hostRef.current;
    const viewport = viewportRef.current;
    if (element && viewport) {
      lease.current?.update({
        element,
        viewport,
        transform,
        worldSize,
        reveal,
      });
    }
  }, [projectId, transform, worldSize]);
  useLayoutEffect(() => {
    const previous = previousTransform.current;
    if (
      previous.x === transform.x && previous.y === transform.y &&
      previous.k === transform.k
    ) return;
    const saved = storage !== undefined &&
      saveOverviewThreadWhiteboardTransform(storage, projectId, transform);
    setSaveFailed(!saved);
    if (saved) previousTransform.current = transform;
  }, [projectId, storage, transform]);

  const zoom = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setTransform((current) =>
      zoomOverviewThreadWhiteboardAt(
        current,
        { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
        current.k * factor,
      )
    );
  };
  const finishPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    pan.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return (
    <section
      id="project-thread-whiteboard"
      className="project-thread-board project-whiteboard-empty"
      aria-label="Project whiteboard"
    >
      <div className="overview-thread-hero-immersive">
        {saveFailed && (
          <p className="project-whiteboard-empty-notice" role="alert">
            Whiteboard view could not be saved.
          </p>
        )}
        <div
          className={cn("project-whiteboard-empty-toolbar", whiteboardToolbar)}
        >
          <span className="px-2 text-xs text-muted-foreground">Whiteboard</span>
          <Button
            className={whiteboardToolbarButton()}
            onClick={() => zoom(0.8)}
            aria-label="Zoom out"
          >
            −
          </Button>
          <span className="px-1 font-mono text-xs">
            {Math.round(transform.k * 100)}%
          </span>
          <Button
            className={whiteboardToolbarButton()}
            onClick={() => zoom(1.25)}
            aria-label="Zoom in"
          >
            +
          </Button>
          <Button
            className={whiteboardToolbarButton()}
            onClick={() => setTransform({ x: 0, y: 0, k: 1 })}
          >
            Reset view
          </Button>
        </div>
        <div
          ref={viewportRef}
          className="overview-thread-viewport"
          tabIndex={-1}
          aria-label="Project whiteboard"
          onWheel={(event) => {
            if (
              (event.target as Element).closest(
                "[data-project-whiteboard-host]",
              )
            ) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const delta = event.deltaY * (event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
              ? event.currentTarget.clientHeight
              : 1);
            setTransform((current) =>
              zoomOverviewThreadWhiteboardByWheel(current, {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              }, delta)
            );
          }}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              (event.target as Element).closest(
                "button, [data-project-whiteboard-host]",
              )
            ) return;
            pan.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const previous = pan.current;
            if (!previous || previous.pointerId !== event.pointerId) return;
            const delta = {
              x: event.clientX - previous.x,
              y: event.clientY - previous.y,
            };
            pan.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            };
            setTransform((current) =>
              panOverviewThreadWhiteboard(current, delta)
            );
          }}
          onPointerUp={finishPan}
          onPointerCancel={finishPan}
        >
          <div
            ref={hostRef}
            className="project-whiteboard-host"
            data-project-whiteboard-host={projectId}
            style={{
              width: worldSize.width,
              height: worldSize.height,
              transform:
                `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.k})`,
            }}
          />
        </div>
      </div>
    </section>
  );
}
