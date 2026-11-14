import { X } from "lucide-react";
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
// Multi-image nodes also get a thumbnail strip; A/D (or ←/→) switches between images.
export function CanvasImageLightbox({ src, title, open, onClose, images, index, onIndexChange }: { src: string; title: string; open: boolean; onClose: () => void; images?: Array<{ src: string; width?: number; height?: number }>; index?: number; onIndexChange?: (index: number) => void }) {
    const { t } = useTranslation();
    const overlayRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
    const [view, setView] = useState<LightboxView>({ scale: 1, x: 0, y: 0 });
    const multi = Boolean(images && images.length > 1 && onIndexChange);
    const switchTo = (next: number) => onIndexChange?.(next);
    const total = images?.length || 0;
    const current = multi ? Math.min(Math.max(index || 0, 0), total - 1) : 0;

    useEffect(() => {
        if (!open) return;
        // Opening resets the view; switching images keeps the current zoom and pan so compare views stay stable.
        setView({ scale: 1, x: 0, y: 0 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

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
            setView((current) => {
                const next = zoomView(current, current.scale * (zoomingIn ? 1.12 : 1 / 1.12), anchor, center);
                // Below 100% the contained image is smaller than the screen, so it always sits perfectly centered.
                return next.scale <= 1 ? { scale: next.scale, x: 0, y: 0 } : next;
            });
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                onClose();
                return;
            }
            if (!multi) return;
            const key = event.key.toLowerCase();
            const isPrev = key === "a" || event.key === "ArrowLeft";
            const isNext = key === "d" || event.key === "ArrowRight";
            if (isPrev && current > 0) {
                event.preventDefault();
                event.stopImmediatePropagation();
                switchTo(current - 1);
            }
            if (isNext && current < total - 1) {
                event.preventDefault();
                event.stopImmediatePropagation();
                switchTo(current + 1);
            }
        };
        overlay.addEventListener("wheel", handleWheel, { passive: false });
        window.addEventListener("keydown", handleKey, true);
        return () => {
            overlay.removeEventListener("wheel", handleWheel);
            window.removeEventListener("keydown", handleKey, true);
        };
    }, [open, onClose, multi, current, total, onIndexChange]);

    if (!open || !src) return null;

    const reset = () => {
        setView({ scale: 1, x: 0, y: 0 });
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
            <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 py-3 text-white">
                <span className="min-w-0 truncate text-sm font-medium">
                    {title}
                    {multi ? <span className="ml-2 tabular-nums text-white/70">{current + 1} / {total}</span> : null}
                </span>
                <button type="button" className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-white/10 px-2.5 text-xs transition hover:bg-white/20" onClick={onClose} aria-label={t("canvas.lightbox.close") }>
                    <kbd className="font-mono text-[11px] text-white/65">Esc</kbd>
                    <span>{t("canvas.lightbox.exit")}</span>
                    <X className="size-4" />
                </button>
            </div>
            {multi ? (
                <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2 overflow-x-auto px-4 thin-scrollbar">
                    {images!.map((image, imageIndex) => (
                        <button
                            key={imageIndex}
                            type="button"
                            className={`h-[84px] shrink-0 overflow-hidden rounded-xl border transition ${imageIndex === current ? "border-white opacity-100" : "border-white/25 opacity-60 hover:opacity-100"}`}
                            style={image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}`, maxWidth: 210, minWidth: 54 } : undefined}
                            onClick={() => switchTo(imageIndex)}
                            aria-label={`${imageIndex + 1} / ${total}`}
                        >
                            <img src={image.src} alt="" draggable={false} className="size-full rounded-xl object-cover" />
                        </button>
                    ))}
                </div>
            ) : null}
        </div>,
        document.body,
    );
}
