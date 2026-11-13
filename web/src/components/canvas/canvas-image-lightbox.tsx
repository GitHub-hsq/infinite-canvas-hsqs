import { Maximize, Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

type LightboxView = { scale: number; x: number; y: number };

function zoomView(view: LightboxView, requestedScale: number, anchor: { x: number; y: number }, center: { x: number; y: number }): LightboxView {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale));
    const ratio = scale / view.scale;
    return {
        scale,
        x: view.x + (1 - ratio) * (anchor.x - center.x - view.x),
        y: view.y + (1 - ratio) * (anchor.y - center.y - view.y),
    };
}

// Full-screen image viewer: no modal frame, wheel to zoom, drag to pan, double-click to reset.
export function CanvasImageLightbox({ src, title, open, onClose }: { src: string; title: string; open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const overlayRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
    const [view, setView] = useState<LightboxView>({ scale: 1, x: 0, y: 0 });

    useEffect(() => {
        if (!open) return;
        setView({ scale: 1, x: 0, y: 0 });
    }, [open, src]);

    useEffect(() => {
        if (!open) return;
        const overlay = overlayRef.current;
        if (!overlay) return;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = overlay.getBoundingClientRect();
            const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            const zoomingIn = event.deltaY < 0;
            const anchor = zoomingIn ? { x: event.clientX, y: event.clientY } : center;
            setView((current) => zoomView(current, current.scale * (zoomingIn ? 1.12 : 1 / 1.12), anchor, center));
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onClose();
        };
        overlay.addEventListener("wheel", handleWheel, { passive: false });
        window.addEventListener("keydown", handleKey, true);
        return () => {
            overlay.removeEventListener("wheel", handleWheel);
            window.removeEventListener("keydown", handleKey, true);
        };
    }, [open, onClose]);

    if (!open || !src) return null;

    const reset = () => {
        setView({ scale: 1, x: 0, y: 0 });
    };

    const zoomFromCenter = (factor: number) => {
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return;
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        setView((current) => zoomView(current, current.scale * factor, center, center));
    };

    return createPortal(
        <div
            ref={overlayRef}
            data-canvas-image-lightbox
            className="fixed inset-0 z-[2000] flex select-none items-center justify-center overflow-hidden bg-black"
            onMouseDown={(event) => {
                if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
                dragRef.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
            }}
            onMouseMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                setView((current) => ({ ...current, x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y }));
            }}
            onMouseUp={() => (dragRef.current = null)}
            onMouseLeave={() => (dragRef.current = null)}
            onDoubleClick={reset}
        >
            <img
                src={src}
                alt={title}
                draggable={false}
                className="pointer-events-none h-screen w-screen object-contain"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "center center" }}
            />
            <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 text-white">
                <span className="min-w-0 truncate text-sm font-medium">{title}</span>
                <button type="button" className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-white/10 px-2.5 text-xs transition hover:bg-white/20" onClick={onClose} aria-label={t("canvas.lightbox.close") }>
                    <kbd className="font-mono text-[11px] text-white/65">Esc</kbd>
                    <span>{t("canvas.lightbox.exit")}</span>
                    <X className="size-4" />
                </button>
            </div>
            <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-2 text-white">
                <button type="button" className="grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" onClick={() => zoomFromCenter(1 / 1.2)} aria-label="Zoom out">
                    <Minus className="size-4" />
                </button>
                <span className="min-w-14 text-center text-sm tabular-nums">{Math.round(view.scale * 100)}%</span>
                <button type="button" className="grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" onClick={() => zoomFromCenter(1.2)} aria-label="Zoom in">
                    <Plus className="size-4" />
                </button>
                <button type="button" className="ml-2 grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" onClick={reset} aria-label="Reset">
                    <Maximize className="size-4" />
                </button>
            </div>
        </div>,
        document.body,
    );
}
