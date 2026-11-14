import { ArrowLeftRight, Columns2, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { resolveImageUrl } from "@/services/image-storage";
import { COMPARE_LIBRARY_LIMIT, useCompareStore, type CompareImage, type CompareSide } from "@/stores/use-compare-store";

const DROP_TYPE = "application/x-canvas-compare";

// Full-screen image compare view: slide (split) or side-by-side over the compare library.
export function CanvasImageCompare({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const items = useCompareStore((state) => state.items);
    const mode = useCompareStore((state) => state.mode);
    const setMode = useCompareStore((state) => state.setMode);
    const assignSide = useCompareStore((state) => state.assignSide);
    const swapSides = useCompareStore((state) => state.swapSides);
    const swapWith = useCompareStore((state) => state.swapWith);
    const removeItem = useCompareStore((state) => state.removeItem);
    const clear = useCompareStore((state) => state.clear);
    const [percent, setPercent] = useState(50);
    const [dragOverSide, setDragOverSide] = useState<CompareSide | null>(null);
    const sliderRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{ pointerId: number } | null>(null);
    // Persisted items reference image storage keys; resolve them to fresh URLs per session.
    const [resolved, setResolved] = useState<Record<string, string>>({});

    const storageKeys = items.flatMap((item) => (item.storageKey ? [item.storageKey] : []));
    useEffect(() => {
        let cancelled = false;
        storageKeys.forEach(async (key) => {
            if (resolved[key]) return;
            const url = await resolveImageUrl(key);
            if (!cancelled && url && !resolved[key]) setResolved((current) => ({ ...current, [key]: url }));
        });
        return () => {
            cancelled = true;
        };
    }, [storageKeys.join("|")]);

    const resolveSrc = (item: CompareImage) => (item.storageKey ? resolved[item.storageKey] || "" : item.src || "");

    const left = items.find((item) => item.side === "left") || null;
    const right = items.find((item) => item.side === "right") || null;
    const leftSrc = left ? resolveSrc(left) : "";
    const rightSrc = right ? resolveSrc(right) : "";

    useEffect(() => {
        if (!open) return;
        const handleKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener("keydown", handleKey, true);
        return () => window.removeEventListener("keydown", handleKey, true);
    }, [open, onClose]);

    if (!open) return null;

    const place = (id: string, side: CompareSide) => assignSide(id, side);

    const onSliderPointerDown = (event: React.PointerEvent) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        dragStateRef.current = { pointerId: event.pointerId };
    };
    const onSliderPointerMove = (event: React.PointerEvent) => {
        if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) return;
        const rect = sliderRef.current?.getBoundingClientRect();
        if (!rect || !rect.width) return;
        setPercent(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
    };

    const dropSide = (event: React.DragEvent, container?: HTMLElement) => {
        event.preventDefault();
        const id = event.dataTransfer.getData(DROP_TYPE) || event.dataTransfer.getData("text/plain");
        if (!id) return;
        let side: CompareSide = "left";
        if (container) {
            const rect = container.getBoundingClientRect();
            side = event.clientX - rect.left < rect.width / 2 ? "left" : "right";
        } else {
            side = dragOverSide || "left";
        }
        setDragOverSide(null);
        place(id, side);
    };

    const compareBox = (() => {
        if (!left && !right) {
            return (
                <div className="grid h-full w-full place-items-center text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                    {t("canvas.compare.empty")}
                </div>
            );
        }
        if (mode === "slide" && left && right) {
            return (
                <div
                    ref={sliderRef}
                    className="relative h-full w-full select-none"
                    onDragOver={(event) => {
                        event.preventDefault();
                        const rect = sliderRef.current?.getBoundingClientRect();
                        setDragOverSide(rect && event.clientX - rect.left < rect.width / 2 ? "left" : "right");
                    }}
                    onDragLeave={(event) => {
                        if (event.currentTarget === event.target) setDragOverSide(null);
                    }}
                    onDrop={(event) => dropSide(event, sliderRef.current || undefined)}
                >
                    <ComparePane src={leftSrc} side="left" />
                    <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${percent}%)` }}>
                        <ComparePane src={rightSrc} side="right" />
                    </div>
                    <div className="absolute inset-y-0 z-10 w-0.5 bg-white" style={{ left: `${percent}%` }} />
                    <button
                        type="button"
                        className="absolute top-1/2 z-20 grid size-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-white/40 bg-black/55 text-white transition hover:scale-110 hover:bg-black/75"
                        style={{ left: `${percent}%` }}
                        aria-label={t("canvas.compare.sliderDrag")}
                        onPointerDown={onSliderPointerDown}
                        onPointerMove={onSliderPointerMove}
                        onPointerUp={() => (dragStateRef.current = null)}
                    >
                        <Columns2 className="size-4" />
                    </button>
                    {dragOverSide ? <div className={`pointer-events-none absolute inset-y-0 ${dragOverSide === "left" ? "left-0 right-1/2" : "left-1/2 right-0"} bg-white/10`} /> : null}
                </div>
            );
        }
        return (
            <div className="grid h-full w-full grid-cols-2 grid-rows-[minmax(0,1fr)]" onDragLeave={() => setDragOverSide(null)}>
                {(["left", "right"] as CompareSide[]).map((side) => {
                    const image = side === "left" ? left : right;
                    const src = image ? resolveSrc(image) : "";
                    return (
                        <div
                            key={side}
                            className={`relative overflow-hidden ${dragOverSide === side ? "bg-white/10" : "bg-transparent"}`}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setDragOverSide(side);
                            }}
                            onDrop={(event) => dropSide(event)}
                        >
                            {image ? (
                                src ? (
                                    <img src={src} alt={image.title || ""} draggable={false} className="absolute inset-0 size-full object-contain" />
                                ) : (
                                    <span className="absolute inset-0 grid place-items-center animate-pulse text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                                        {t("canvas.compare.loading")}
                                    </span>
                                )
                            ) : (
                                <span className="grid h-full place-items-center text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                                    {t(side === "left" ? "canvas.compare.dropLeft" : "canvas.compare.dropRight")}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    })();

    return createPortal(
        <div className="fixed inset-0 z-[2000] flex flex-col overflow-hidden bg-black/95 text-white" data-canvas-image-compare>
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
                <div className="flex min-w-0 items-baseline gap-3">
                    <span className="text-sm font-semibold">{t("canvas.compare.title")}</span>
                    <span className="text-xs text-white/55">
                        {items.length} / {COMPARE_LIBRARY_LIMIT} · {t("canvas.compare.libraryHint")}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <div className="flex overflow-hidden rounded-lg border border-white/20">
                        {(["slide", "side"] as const).map((value) => (
                            <button
                                key={value}
                                type="button"
                                className={`h-9 px-3 text-xs transition ${mode === value ? "bg-white/20 font-medium" : "bg-white/5 hover:bg-white/10"}`}
                                onClick={() => setMode(value)}
                            >
                                {t(value === "slide" ? "canvas.compare.modeSlide" : "canvas.compare.modeSide")}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="grid size-9 place-items-center rounded-lg bg-white/10 transition hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10"
                        disabled={!left || !right}
                        onClick={swapSides}
                        aria-label={t("canvas.compare.swap")}
                        title={t("canvas.compare.swap")}
                    >
                        <ArrowLeftRight className="size-4" />
                    </button>
                    <button
                        type="button"
                        className="grid size-9 place-items-center rounded-lg bg-white/10 transition hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10"
                        disabled={percent === 50}
                        onClick={() => setPercent(50)}
                        aria-label={t("canvas.compare.resetSlider")}
                        title={t("canvas.compare.resetSlider")}
                    >
                        <RotateCcw className="size-4" />
                    </button>
                    <button type="button" className="flex h-9 items-center gap-2 rounded-md bg-white/10 px-2.5 text-xs transition hover:bg-white/20" onClick={onClose}>
                        <kbd className="font-mono text-[11px] text-white/65">Esc</kbd>
                        <X className="size-4" />
                    </button>
                </div>
            </div>
            <div className="min-h-0 flex-1 px-2 pb-2">
                <div className="flex h-full w-full items-center justify-center">{compareBox}</div>
            </div>
            <div className="shrink-0 px-6 pb-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-3">
                        <span className="text-sm font-semibold">{t("canvas.compare.library")}</span>
                        <span className="truncate text-xs text-white/55">{t("canvas.compare.sideHint")}</span>
                    </div>
                    <button type="button" className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-xs transition hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10" disabled={!items.length} onClick={clear}>
                        {t("canvas.compare.clear")}
                    </button>
                </div>
                <div className="overflow-x-auto pb-1 thin-scrollbar">
                    <div className="mx-auto flex w-fit gap-2">
                        {items.map((item) => (
                            <CompareThumb key={item.id} item={item} src={resolveSrc(item)} onPlace={place} onRemove={removeItem} onSwapWith={(sourceId, targetId) => swapWith(sourceId, targetId)} />
                        ))}
                        {!items.length ? <div className="grid w-full place-items-center px-10 text-xs text-white/45">{t("canvas.compare.libraryEmpty")}</div> : null}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function ComparePane({ src, side }: { src: string; side: CompareSide }) {
    return <img src={src} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" data-compare-side={side} />;
}

function CompareThumb({
    item,
    src,
    onPlace,
    onRemove,
    onSwapWith,
}: {
    item: CompareImage;
    src: string;
    onPlace: (id: string, side: CompareSide) => void;
    onRemove: (id: string) => void;
    onSwapWith: (sourceId: string, targetId: string) => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            className="group relative w-[104px] shrink-0 overflow-hidden rounded-lg border border-white/25 bg-white/5"
            draggable
            onDragStart={(event) => {
                event.dataTransfer.setData(DROP_TYPE, item.id);
                event.dataTransfer.setData("text/plain", item.id);
                event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const sourceId = event.dataTransfer.getData(DROP_TYPE) || event.dataTransfer.getData("text/plain");
                if (sourceId && sourceId !== item.id) onSwapWith(sourceId, item.id);
            }}
        >
            <img src={src} alt={item.title || ""} draggable={false} className="h-16 w-full object-cover" />
            <div className="grid grid-cols-2 divide-x divide-white/15 border-t border-white/15">
                {(["left", "right"] as CompareSide[]).map((side) => (
                    <button
                        key={side}
                        type="button"
                        className={`h-7 text-xs transition hover:bg-white/15 ${item.side === side ? "bg-white/25 font-semibold" : "text-white/60"}`}
                        onClick={() => onPlace(item.id, side)}
                        title={t(side === "left" ? "canvas.compare.setLeft" : "canvas.compare.setRight")}
                    >
                        {t(side === "left" ? "canvas.compare.sideLeft" : "canvas.compare.sideRight")}
                    </button>
                ))}
            </div>
            <button
                type="button"
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white/80 opacity-0 transition hover:bg-black/85 hover:text-white group-hover:opacity-100"
                onClick={() => onRemove(item.id)}
                aria-label={t("common.delete")}
                title={t("common.delete")}
            >
                <Trash2 className="size-3" />
            </button>
        </div>
    );
}
