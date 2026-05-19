"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFPageSize, VisibleSignaturePlacement } from "@/lib/pdfSigner";

type Props = {
  pageSize: PDFPageSize | null;
  placement: VisibleSignaturePlacement | null;
  imageUrl: string | null;
  imageAspectRatio: number | null;
  onChange: (placement: VisibleSignaturePlacement) => void;
  onInteract?: () => void;
};

type InteractionMode = "drag" | "resize";

type InteractionState = {
  mode: InteractionMode;
  startClientX: number;
  startClientY: number;
  startPlacement: VisibleSignaturePlacement;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getDefaultRatio(aspectRatio: number | null) {
  if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return 2.8;
  }
  return aspectRatio;
}

export default function SignaturePlacementEditor({
  pageSize,
  placement,
  imageUrl,
  imageAspectRatio,
  onChange,
  onInteract
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setContainerWidth(element.getBoundingClientRect().width);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pageSize]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || !pageSize || !containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const scale = rect.width / pageSize.width;
      if (!scale) {
        return;
      }

      const deltaX = (event.clientX - interaction.startClientX) / scale;
      const deltaY = (event.clientY - interaction.startClientY) / scale;
      const start = interaction.startPlacement;
      const ratio = getDefaultRatio(imageAspectRatio);
      const minWidth = Math.min(pageSize.width, Math.max(72, pageSize.width * 0.12));
      const minHeight = minWidth / ratio;

      if (interaction.mode === "drag") {
        const nextWidth = clamp(start.width, minWidth, pageSize.width);
        const nextHeight = clamp(start.height, minHeight, pageSize.height);
        const nextX = clamp(start.x + deltaX, 0, Math.max(0, pageSize.width - nextWidth));
        const nextY = clamp(start.y + deltaY, 0, Math.max(0, pageSize.height - nextHeight));
        onChange({
          ...start,
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight
        });
        return;
      }

      const maxWidthByBounds = Math.min(pageSize.width - start.x, (pageSize.height - start.y) * ratio);
      const nextWidth = clamp(start.width + deltaX, minWidth, maxWidthByBounds);
      const nextHeight = nextWidth / ratio;
      onChange({
        ...start,
        width: nextWidth,
        height: nextHeight
      });
    };

    const handleUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [imageAspectRatio, onChange, pageSize]);

  if (!pageSize) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
        Upload a PDF first to place the visible signature.
      </div>
    );
  }

  const scale = containerWidth > 0 ? containerWidth / pageSize.width : 1;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Visible signature placement</p>
          <p className="mt-1 text-xs text-slate-500">
            Drag the image to move it. Drag the corner to resize. First page only.
          </p>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
          Page {Math.round(pageSize.width)} x {Math.round(pageSize.height)} pt
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl border border-slate-300 bg-gradient-to-b from-white to-slate-50"
        style={{ aspectRatio: `${pageSize.width} / ${pageSize.height}` }}
      >
        <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,rgba(148,163,184,0.8)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.8)_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs text-slate-500 shadow-sm">
            PDF page preview
          </div>
        </div>

        {placement && imageUrl ? (
          <div
            onPointerDown={(event) => {
              if (!pageSize) {
                return;
              }
              onInteract?.();
              interactionRef.current = {
                mode: "drag",
                startClientX: event.clientX,
                startClientY: event.clientY,
                startPlacement: placement
              };
              (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
            }}
            className="group absolute overflow-hidden rounded-xl border-2 border-sky-500 bg-white shadow-[0_12px_30px_rgba(14,165,233,0.18)] outline-none"
            style={{
              left: placement.x * scale,
              top: placement.y * scale,
              width: placement.width * scale,
              height: placement.height * scale,
              touchAction: "none"
            }}
            aria-label="Visible signature placement"
            title="Drag to move. Resize from the bottom-right corner."
            >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Signature placeholder"
              className="h-full w-full select-none object-contain"
              draggable={false}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-sky-600/90 px-2 py-1 text-left text-[11px] font-medium text-white">
              Drag to move
            </div>
            <button
              type="button"
              aria-label="Resize visible signature"
              onPointerDown={(event) => {
                if (!pageSize) {
                  return;
                }
                event.stopPropagation();
                onInteract?.();
                interactionRef.current = {
                  mode: "resize",
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  startPlacement: placement
                };
                (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
              }}
              className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-center justify-center rounded-tl-md bg-sky-600 text-white shadow-sm"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 15h6v-6" />
                <path d="M15 15 9 9" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/85 p-4 text-sm text-slate-600">
              Upload a PNG/JPG signature image to place it here.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
