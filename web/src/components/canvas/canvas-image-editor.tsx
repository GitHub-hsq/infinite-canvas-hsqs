import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { App, Button, Input, InputNumber, Select, Slider, Switch, Tooltip, type InputRef } from "antd";
import {
    ArrowUpRight,
    Brush,
    Check,
    Crop,
    Eraser,
    FileArchive,
    FlipHorizontal2,
    FlipVertical2,
    Grid3X3,
    MousePointer2,
    Redo2,
    RotateCcw,
    RotateCw,
    Save,
    Square,
    Trash2,
    Type,
    Undo2,
    X,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
    cropEditorSnapshot,
    EDITOR_COMPRESS_TARGET_BYTES,
    editorObjectBounds,
    exportEditorBlob,
    exportEditorCompressedBlob,
    flipEditorSnapshot,
    hitEditorObject,
    identityEditorMatrix,
    renderEditorScene,
    rotateEditorSnapshot,
    translateEditorObject,
    type EditorObject,
    type EditorPoint,
    type EditorRectValue,
    type EditorSnapshot,
} from "@/components/canvas/canvas-image-editor-utils";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type EditorTool = "select" | "brush" | "erase" | "arrow" | "rect" | "text" | "mosaic" | "crop";
type CropHandle = "move" | "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

type DrawingState =
    | { kind: "object"; pointerId: number }
    | { kind: "move"; pointerId: number; start: EditorPoint; base: EditorSnapshot; object: EditorObject }
    | { kind: "crop"; pointerId: number; start: EditorPoint };

type BrushPreview = { x: number; y: number; adjusting: boolean };

const colors = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#000000"];
const cropHandles: Exclude<CropHandle, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const defaultToolWidths = { brush: 4, erase: 30, arrow: 6, rect: 3 };

export default function CanvasImageEditor({ dataUrl, title, open, onClose, onSave }: { dataUrl: string; title: string; open: boolean; onClose: () => void; onSave: (blob: Blob, label?: string) => Promise<void> }) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const snapshotRef = useRef<EditorSnapshot | null>(null);
    const historyRef = useRef<EditorSnapshot[]>([]);
    const redoRef = useRef<EditorSnapshot[]>([]);
    const drawingRef = useRef<DrawingState | null>(null);
    const cropDragRef = useRef<{ pointerId: number; handle: CropHandle; start: EditorPoint; crop: EditorRectValue } | null>(null);
    const brushAdjustRef = useRef<{ pointerId: number; anchorX: number; anchorY: number; deltaX: number; deltaY: number; width: number; softness: number } | null>(null);
    const selectedSettingBaseRef = useRef<EditorSnapshot | null>(null);
    const confirmingCloseRef = useRef(false);
    const textInputRef = useRef<InputRef>(null);
    const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
    const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(null);
    const [draft, setDraft] = useState<EditorObject | null>(null);
    const [tool, setTool] = useState<EditorTool>("select");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [crop, setCrop] = useState<EditorRectValue | null>(null);
    const [cropRatio, setCropRatio] = useState("free");
    const [customRatio, setCustomRatio] = useState({ width: 5, height: 4 });
    const [textEdit, setTextEdit] = useState<{ x: number; y: number; clientX: number; clientY: number; value: string; editingId?: string } | null>(null);
    const [brushPreview, setBrushPreview] = useState<BrushPreview | null>(null);
    const [color, setColor] = useState(colors[0]);
    const [width, setWidth] = useState(defaultToolWidths.brush);
    const [toolWidths, setToolWidths] = useState(defaultToolWidths);
    const [softness, setSoftness] = useState(0);
    const [fill, setFill] = useState(false);
    const [textSize, setTextSize] = useState(14);
    const [historySize, setHistorySize] = useState(0);
    const [redoSize, setRedoSize] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const viewport = useImageEditorViewport(snapshot ? { width: snapshot.width, height: snapshot.height } : null, open);

    const replaceSnapshot = useCallback((next: EditorSnapshot) => {
        snapshotRef.current = next;
        setSnapshot(next);
    }, []);

    const recordChange = useCallback(
        (next: EditorSnapshot, previous = snapshotRef.current) => {
            if (!previous) return;
            historyRef.current = [...historyRef.current.slice(-39), previous];
            redoRef.current = [];
            replaceSnapshot(next);
            setHistorySize(historyRef.current.length);
            setRedoSize(0);
            setDirty(true);
        },
        [replaceSnapshot],
    );

    useEffect(() => {
        if (!open || !dataUrl) return;
        let active = true;
        const image = new Image();
        image.onload = () => {
            if (!active) return;
            const initial: EditorSnapshot = { width: image.naturalWidth, height: image.naturalHeight, matrix: identityEditorMatrix, objects: [] };
            historyRef.current = [];
            redoRef.current = [];
            snapshotRef.current = initial;
            setSourceImage(image);
            setSnapshot(initial);
            setDraft(null);
            setSelectedId(null);
            setCrop(null);
            setCropRatio("free");
            setTextEdit(null);
            setBrushPreview(null);
            setTool("select");
            setWidth(defaultToolWidths.brush);
            setToolWidths(defaultToolWidths);
            setTextSize(14);
            setHistorySize(0);
            setRedoSize(0);
            setDirty(false);
            brushAdjustRef.current = null;
            selectedSettingBaseRef.current = null;
        };
        image.onerror = () => active && message.error(t("canvas.editors.imageEditorLoadFailed"));
        image.src = dataUrl;
        return () => {
            active = false;
        };
    }, [dataUrl, message, open, t]);

    useLayoutEffect(() => {
        if (!textEdit) return;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        textInputRef.current?.input?.focus({ preventScroll: true });
        window.scrollTo(scrollX, scrollY);
    }, [textEdit?.editingId, textEdit?.clientX, textEdit?.clientY]);

    useEffect(() => {
        if (!open) return;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const previousOverflow = document.documentElement.style.overflow;
        const previousBodyOverflow = document.body.style.overflow;
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        window.scrollTo(scrollX, scrollY);
        return () => {
            document.documentElement.style.overflow = previousOverflow;
            document.body.style.overflow = previousBodyOverflow;
            window.scrollTo(scrollX, scrollY);
        };
    }, [open]);

    const previewScale = viewport.imageScale / Math.max(viewport.zoom, 0.001);
    const previewWidth = snapshot ? Math.max(1, Math.round(snapshot.width * previewScale * Math.min(window.devicePixelRatio || 1, 2))) : 1;
    const previewHeight = snapshot ? Math.max(1, Math.round(snapshot.height * previewScale * Math.min(window.devicePixelRatio || 1, 2))) : 1;

    useLayoutEffect(() => {
        if (!sourceImage || !snapshot || !canvasRef.current) return;
        renderEditorScene(canvasRef.current, sourceImage, snapshot, draft, selectedId, theme.canvas.selectionStroke, textEdit?.editingId);
    }, [draft, previewHeight, previewWidth, selectedId, snapshot, sourceImage, textEdit?.editingId, theme.canvas.selectionStroke]);

    const undo = useCallback(() => {
        const previous = historyRef.current.pop();
        const current = snapshotRef.current;
        if (!previous || !current) return;
        redoRef.current.push(current);
        replaceSnapshot(previous);
        setSelectedId(null);
        setCrop(null);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        setDirty(historyRef.current.length > 0);
    }, [replaceSnapshot]);

    const redo = useCallback(() => {
        const next = redoRef.current.pop();
        const current = snapshotRef.current;
        if (!next || !current) return;
        historyRef.current.push(current);
        replaceSnapshot(next);
        setSelectedId(null);
        setCrop(null);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        setDirty(true);
    }, [replaceSnapshot]);

    const removeSelected = useCallback(() => {
        const current = snapshotRef.current;
        if (!current || !selectedId) return;
        recordChange({ ...current, objects: current.objects.filter((object) => object.id !== selectedId) });
        setSelectedId(null);
    }, [recordChange, selectedId]);

    const syncControlsFromObject = useCallback(
        (object: EditorObject) => {
            const imageScale = Math.max(viewport.imageScale, 0.001);
            if (object.type !== "erase" && object.type !== "mosaic") setColor(object.color);
            if (object.type === "brush" || object.type === "erase") {
                const range = toolWidthRange(object.type);
                setWidth(clamp(Math.round(object.width * imageScale), range.min, range.max));
                setSoftness(Math.round(object.softness * 100));
            } else if (object.type === "arrow") setWidth(clamp(Math.round(object.width * imageScale), 4, 16));
            else if (object.type === "rect") {
                setWidth(clamp(Math.round(object.strokeWidth * imageScale), 1, 10));
                setFill(object.fill);
            } else if (object.type === "text") setTextSize(clamp(Math.round(object.size * imageScale), 6, 64));
        },
        [viewport.imageScale],
    );

    const selectObject = useCallback(
        (object: EditorObject | undefined) => {
            selectedSettingBaseRef.current = null;
            setSelectedId(object?.id || null);
            if (object) syncControlsFromObject(object);
        },
        [syncControlsFromObject],
    );

    const updateSelectedLive = useCallback(
        (update: (object: EditorObject) => EditorObject) => {
            const current = snapshotRef.current;
            if (!current || !selectedId) return;
            selectedSettingBaseRef.current ||= current;
            replaceSnapshot({ ...current, objects: current.objects.map((object) => (object.id === selectedId ? update(object) : object)) });
        },
        [replaceSnapshot, selectedId],
    );

    const commitSelectedSetting = useCallback(() => {
        const previous = selectedSettingBaseRef.current;
        const current = snapshotRef.current;
        selectedSettingBaseRef.current = null;
        if (previous && current && previous !== current) recordChange(current, previous);
    }, [recordChange]);

    const changeSelectedOnce = useCallback(
        (update: (object: EditorObject) => EditorObject) => {
            const current = snapshotRef.current;
            if (!current || !selectedId) return;
            recordChange({ ...current, objects: current.objects.map((object) => (object.id === selectedId ? update(object) : object)) });
        },
        [recordChange, selectedId],
    );

    const requestClose = useCallback(() => {
        if (confirmingCloseRef.current) return;
        if (!dirty) return onClose();
        confirmingCloseRef.current = true;
        modal.confirm({
            zIndex: 1300,
            title: t("canvas.editors.discardTitle"),
            content: t("canvas.editors.discardDescription"),
            okText: t("canvas.editors.discard"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: onClose,
            afterClose: () => {
                confirmingCloseRef.current = false;
            },
        });
    }, [dirty, modal, onClose, t]);

    const save = useCallback(async () => {
        if (!sourceImage || !snapshotRef.current || saving) return;
        setSaving(true);
        try {
            const output = crop ? cropEditorSnapshot(snapshotRef.current, crop) : snapshotRef.current;
            await onSave(await exportEditorBlob(sourceImage, output));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.editors.imageEditorSaveFailed"));
        } finally {
            setSaving(false);
        }
    }, [crop, message, onSave, saving, sourceImage, t]);

    // Re-encode the same composite at the highest quality that fits the byte target; the untouched original stays on its own node.
    const saveCompressed = useCallback(async () => {
        if (!sourceImage || !snapshotRef.current || saving) return;
        setSaving(true);
        try {
            const originalBytes = dataUrl.includes(",") ? Math.round(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4) : Number.POSITIVE_INFINITY;
            if (originalBytes <= EDITOR_COMPRESS_TARGET_BYTES) {
                message.info(t("canvas.editors.alreadyWithinTarget"));
                return;
            }
            const output = crop ? cropEditorSnapshot(snapshotRef.current, crop) : snapshotRef.current;
            const result = await exportEditorCompressedBlob(sourceImage, output);
            if (result.blob.size >= originalBytes) {
                message.info(t("canvas.editors.compressNoGain"));
                return;
            }
            const toMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
            message.success(t("canvas.editors.compressedDone", { before: toMb(originalBytes), after: toMb(result.blob.size), format: result.format, quality: result.quality }));
            await onSave(result.blob, t("canvas.editors.compressedImage"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.editors.compressFailed"));
        } finally {
            setSaving(false);
        }
    }, [crop, dataUrl, message, onSave, saving, sourceImage, t]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const editingText = Boolean(target?.closest("input,textarea,[contenteditable='true']"));
            if (event.key === "Escape") {
                if (confirmingCloseRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (textEdit) setTextEdit(null);
                else if (crop) {
                    setCrop(null);
                    setTool("select");
                } else if (selectedId) setSelectedId(null);
                else requestClose();
                return;
            }
            if (editingText) return;
            if (event.key === "Enter" && crop) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                applyCrop();
                return;
            }
            const key = event.key.toLowerCase();
            const modifier = (event.metaKey || event.ctrlKey) && !event.altKey;
            const isUndo = modifier && !event.shiftKey && key === "z";
            const isRedo = modifier && ((event.shiftKey && key === "z") || key === "y");
            const isSave = modifier && key === "s";
            if (isUndo || isRedo || isSave || ((event.key === "Delete" || event.key === "Backspace") && selectedId)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (isUndo) undo();
                else if (isRedo) redo();
                else if (isSave) void save();
                else removeSelected();
                return;
            }
            if (key === "[" || key === "]") {
                event.preventDefault();
                event.stopPropagation();
                const selected = snapshotRef.current?.objects.find((object) => object.id === selectedId);
                if (selected?.type === "text") {
                    const nextSize = clamp(textSize + (key === "]" ? 1 : -1), 6, 64);
                    setTextSize(nextSize);
                    changeSelectedOnce((object) => (object.type === "text" ? { ...object, size: nextSize / Math.max(viewport.imageScale, 0.001) } : object));
                    return;
                }
                const range = toolWidthRange(selected?.type || tool);
                const nextWidth = clamp(width + (key === "]" ? 1 : -1), range.min, range.max);
                setWidth(nextWidth);
                if (!selected && isWidthTool(tool)) setToolWidths((current) => ({ ...current, [tool]: nextWidth }));
                if (selectedId) changeSelectedOnce((object) => setEditorObjectWidth(object, nextWidth, viewport.imageScale));
                return;
            }
            const nextTool = ({ v: "select", b: "brush", e: "erase", a: "arrow", u: "rect", t: "text", m: "mosaic", c: "crop" } as Partial<Record<string, EditorTool>>)[key];
            if (!nextTool) return;
            event.preventDefault();
            event.stopPropagation();
            chooseTool(nextTool);
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [changeSelectedOnce, crop, open, redo, removeSelected, requestClose, save, selectedId, textEdit, textSize, undo, viewport.imageScale, width]);

    useEffect(() => {
        if (!open) return;
        const releasePointerLockAdjustment = () => {
            if (document.pointerLockElement || !brushAdjustRef.current) return;
            brushAdjustRef.current = null;
            commitSelectedSetting();
            setBrushPreview(null);
        };
        document.addEventListener("pointerlockchange", releasePointerLockAdjustment);
        return () => document.removeEventListener("pointerlockchange", releasePointerLockAdjustment);
    }, [commitSelectedSetting, open]);

    const chooseTool = (nextTool: EditorTool) => {
        if (nextTool !== "brush" && nextTool !== "erase") setBrushPreview(null);
        brushAdjustRef.current = null;
        drawingRef.current = null;
        if (document.pointerLockElement) document.exitPointerLock();
        setTool(nextTool);
        setDraft(null);
        setTextEdit(null);
        if (nextTool !== "select") setSelectedId(null);
        if (isWidthTool(nextTool)) setWidth(toolWidths[nextTool]);
        if (nextTool === "text") setTextSize(14);
        if (nextTool === "crop" && snapshotRef.current) {
            const current = snapshotRef.current;
            setCrop({ x: 0, y: 0, width: current.width, height: current.height });
        } else setCrop(null);
    };

    const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): EditorPoint => {
        const rect = event.currentTarget.getBoundingClientRect();
        const current = snapshotRef.current!;
        return { x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * current.width, y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * current.height };
    };

    const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const current = snapshotRef.current;
        if (!current || !viewport.imageScale || viewport.spacePressed) return;
        const selectedForAdjust = current.objects.find((object) => object.id === selectedId);
        if (event.button === 2 && (event.altKey || event.ctrlKey) && (isWidthTool(tool) || isWidthTool(selectedForAdjust?.type || "select"))) {
            event.preventDefault();
            event.stopPropagation();
            brushAdjustRef.current = { pointerId: event.pointerId, anchorX: event.clientX, anchorY: event.clientY, deltaX: 0, deltaY: 0, width, softness };
            void event.currentTarget.requestPointerLock?.();
            setBrushPreview({ x: event.clientX, y: event.clientY, adjusting: true });
            return;
        }
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const point = canvasPoint(event);
        if (event.altKey) {
            const sampled = sampleCanvasColor(event.currentTarget, event.clientX, event.clientY);
            if (sampled) {
                setColor(sampled);
                message.success(t("canvas.editors.colorSampled", { color: sampled }));
            }
            return;
        }
        if (tool === "select" || event.ctrlKey || event.metaKey) {
            const tolerance = 8 / Math.max(viewport.imageScale, 0.01);
            const object = [...current.objects].reverse().find((candidate) => hitEditorObject(candidate, point, tolerance));
            selectObject(object);
            if (!object) return;
            drawingRef.current = { kind: "move", pointerId: event.pointerId, start: point, base: current, object };
        } else if (tool === "text") {
            setTextEdit({ ...point, clientX: event.clientX, clientY: event.clientY, value: "" });
            return;
        } else if (tool === "crop") {
            drawingRef.current = { kind: "crop", pointerId: event.pointerId, start: point };
            setCrop({ ...point, width: 1, height: 1 });
        } else {
            const id = crypto.randomUUID();
            const imageScale = Math.max(viewport.imageScale, 0.001);
            const objectWidth = width / imageScale;
            const next: EditorObject =
                tool === "brush" || tool === "erase"
                    ? { id, type: tool, points: [point, point], color, width: objectWidth, softness: softness / 100 }
                    : tool === "arrow"
                      ? { id, type: "arrow", start: point, end: point, color, width: objectWidth }
                      : tool === "rect"
                        ? { id, type: "rect", ...point, width: 0, height: 0, color, strokeWidth: objectWidth, fill }
                        : { id, type: "mosaic", ...point, width: 0, height: 0, block: Math.max(current.width, current.height) / 90 };
            setDraft(next);
            drawingRef.current = { kind: "object", pointerId: event.pointerId };
        }
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.pointerId === event.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            brushAdjust.deltaX += event.movementX;
            brushAdjust.deltaY += event.movementY;
            const selected = snapshotRef.current?.objects.find((object) => object.id === selectedId);
            const range = toolWidthRange(selected?.type || tool);
            const nextWidth = clamp(Math.round(brushAdjust.width + brushAdjust.deltaX * 0.5), range.min, range.max);
            const nextSoftness = clamp(Math.round(brushAdjust.softness - brushAdjust.deltaY * 0.5), 0, 100);
            setWidth(nextWidth);
            setSoftness(nextSoftness);
            setBrushPreview({ x: brushAdjust.anchorX, y: brushAdjust.anchorY, adjusting: true });
            if (!selected && isWidthTool(tool)) setToolWidths((current) => ({ ...current, [tool]: nextWidth }));
            if (selectedId) {
                if (selected?.type === "text") {
                    const nextSize = clamp(Math.round(10 + nextWidth * 1.5), 6, 64);
                    setTextSize(nextSize);
                    updateSelectedLive((object) => (object.type === "text" ? { ...object, size: nextSize / Math.max(viewport.imageScale, 0.001) } : object));
                } else updateSelectedLive((object) => setEditorObjectBrush(object, nextWidth, nextSoftness, viewport.imageScale));
            }
            return;
        }
        if ((tool === "brush" || tool === "erase") && !event.altKey) setBrushPreview({ x: event.clientX, y: event.clientY, adjusting: false });
        const drawing = drawingRef.current;
        const current = snapshotRef.current;
        if (!drawing || !current || drawing.pointerId !== event.pointerId) return;
        event.preventDefault();
        const point = canvasPoint(event);
        if (drawing.kind === "move") {
            const dx = point.x - drawing.start.x;
            const dy = point.y - drawing.start.y;
            replaceSnapshot({ ...drawing.base, objects: drawing.base.objects.map((object) => (object.id === drawing.object.id ? translateEditorObject(drawing.object, dx, dy) : object)) });
        } else if (drawing.kind === "crop") {
            setCrop(createCropFromDrag(drawing.start, point, resolveCropRatio(cropRatio, customRatio), current));
        } else if (draft) {
            setDraft((value) => {
                if (!value) return value;
                if (value.type === "brush" || value.type === "erase") return { ...value, points: [...value.points, point] };
                if (value.type === "arrow") return { ...value, end: point };
                return { ...value, width: point.x - value.x, height: point.y - value.y };
            });
        }
    };

    const stopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (brushAdjustRef.current?.pointerId === event.pointerId) {
            brushAdjustRef.current = null;
            if (document.pointerLockElement) document.exitPointerLock();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            commitSelectedSetting();
            setBrushPreview(null);
            return;
        }
        const drawing = drawingRef.current;
        if (!drawing || drawing.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drawingRef.current = null;
        if (drawing.kind === "move") {
            const current = snapshotRef.current;
            if (current && current !== drawing.base) recordChange(current, drawing.base);
        } else if (drawing.kind === "object" && draft && snapshotRef.current) {
            const bounds = editorObjectBounds(draft);
            const tinyArrow = draft.type === "arrow" && Math.abs(draft.end.x - draft.start.x) + Math.abs(draft.end.y - draft.start.y) < 4 / Math.max(viewport.imageScale, 0.001);
            if (!tinyArrow && ((draft.type === "brush" || draft.type === "erase") || (bounds.width >= 2 && bounds.height >= 2))) recordChange({ ...snapshotRef.current, objects: [...snapshotRef.current.objects, normalizeObject(draft)] });
            setDraft(null);
        }
    };

    const commitText = () => {
        const current = snapshotRef.current;
        const value = textEdit?.value.trim();
        if (current && textEdit?.editingId) {
            const original = current.objects.find((object) => object.id === textEdit.editingId);
            if (original?.type === "text" && value !== original.text) {
                recordChange({ ...current, objects: value ? current.objects.map((object) => (object.id === original.id ? { ...original, text: value } : object)) : current.objects.filter((object) => object.id !== original.id) });
            }
        } else if (current && textEdit && value) {
            const size = textSize / Math.max(viewport.imageScale, 0.001);
            const object: EditorObject = { id: crypto.randomUUID(), type: "text", x: textEdit.x, y: textEdit.y + size, text: value, color, size };
            recordChange({ ...current, objects: [...current.objects, object] });
        }
        setTextEdit(null);
    };

    const editExistingText = (event: ReactMouseEvent<HTMLCanvasElement>) => {
        const current = snapshotRef.current;
        if (!current || tool === "crop" || event.altKey) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const point = { x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * current.width, y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * current.height };
        const tolerance = 8 / Math.max(viewport.imageScale, 0.01);
        const object = [...current.objects].reverse().find((candidate) => candidate.type === "text" && hitEditorObject(candidate, point, tolerance));
        if (object?.type !== "text") return;
        event.preventDefault();
        event.stopPropagation();
        syncControlsFromObject(object);
        setSelectedId(null);
        setTextEdit({ x: object.x, y: object.y - object.size, clientX: event.clientX, clientY: event.clientY, value: object.text, editingId: object.id });
    };

    const applyCrop = () => {
        const current = snapshotRef.current;
        if (!current || !crop) return;
        recordChange(cropEditorSnapshot(current, crop));
        setCrop(null);
        setTool("select");
    };

    const startCropDrag = (handle: CropHandle, event: ReactPointerEvent<HTMLElement>) => {
        if (!crop || !snapshotRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const current = snapshotRef.current;
        const point = { x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * current.width, y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * current.height };
        cropDragRef.current = { pointerId: event.pointerId, handle, start: point, crop };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveCropDrag = (event: ReactPointerEvent<HTMLElement>) => {
        const drag = cropDragRef.current;
        const current = snapshotRef.current;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!drag || !current || !rect || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const point = { x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * current.width, y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * current.height };
        const dx = point.x - drag.start.x;
        const dy = point.y - drag.start.y;
        setCrop(resizeCrop(drag.crop, drag.handle, dx, dy, current, resolveCropRatio(cropRatio, customRatio)));
    };

    const stopCropDrag = (event: ReactPointerEvent<HTMLElement>) => {
        if (cropDragRef.current?.pointerId !== event.pointerId) return;
        cropDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const transform = (action: "left" | "right" | "horizontal" | "vertical") => {
        const current = snapshotRef.current;
        if (!current) return;
        recordChange(action === "left" ? rotateEditorSnapshot(current, false) : action === "right" ? rotateEditorSnapshot(current, true) : flipEditorSnapshot(current, action === "horizontal"));
        setSelectedId(null);
        setCrop(null);
        setTool("select");
    };

    const clearEdits = () => {
        const current = snapshotRef.current;
        if (!current || !sourceImage) return;
        const initial: EditorSnapshot = { width: sourceImage.naturalWidth, height: sourceImage.naturalHeight, matrix: identityEditorMatrix, objects: [] };
        if (dirty) recordChange(initial, current);
        else replaceSnapshot(initial);
        setDraft(null);
        setSelectedId(null);
        setCrop(null);
        setTextEdit(null);
        setBrushPreview(null);
        setTool("select");
        setWidth(defaultToolWidths.brush);
        setToolWidths(defaultToolWidths);
        setSoftness(0);
        setFill(false);
        setTextSize(14);
        brushAdjustRef.current = null;
        selectedSettingBaseRef.current = null;
        if (document.pointerLockElement) document.exitPointerLock();
    };

    const selectedObject = snapshot?.objects.find((object) => object.id === selectedId);
    const settingsType = selectedObject?.type || tool;
    const changeColor = (value: string) => {
        setColor(value);
        if (selectedObject && selectedObject.type !== "erase" && selectedObject.type !== "mosaic") changeSelectedOnce((object) => (object.type === "erase" || object.type === "mosaic" ? object : { ...object, color: value }));
    };
    const changeWidth = (value: number) => {
        setWidth(value);
        if (!selectedObject && isWidthTool(tool)) setToolWidths((current) => ({ ...current, [tool]: value }));
        if (selectedObject) updateSelectedLive((object) => setEditorObjectWidth(object, value, viewport.imageScale));
    };
    const changeSoftness = (value: number) => {
        setSoftness(value);
        if (selectedObject) updateSelectedLive((object) => setEditorObjectBrush(object, width, value, viewport.imageScale));
    };
    const changeTextSize = (value: number) => {
        setTextSize(value);
        if (selectedObject) updateSelectedLive((object) => (object.type === "text" ? { ...object, size: value / Math.max(viewport.imageScale, 0.001) } : object));
    };
    const changeFill = (value: boolean) => {
        setFill(value);
        if (selectedObject?.type === "rect") changeSelectedOnce((object) => (object.type === "rect" ? { ...object, fill: value } : object));
    };
    const changeCustomRatio = (dimension: "width" | "height", value: number | null) => {
        const next = { ...customRatio, [dimension]: Number(value) || 1 };
        setCustomRatio(next);
        if (crop && snapshotRef.current) setCrop(fitCropRatio(crop, resolveCropRatio("custom", next), snapshotRef.current));
    };
    const changeCropPixels = (nextWidth: number, nextHeight: number) => {
        if (!crop || !snapshotRef.current) return;
        const widthValue = Math.max(1, Math.round(nextWidth));
        const heightValue = Math.max(1, Math.round(nextHeight));
        setCustomRatio({ width: widthValue, height: heightValue });
        setCropRatio("custom");
        setCrop(setCropPixelSize(crop, snapshotRef.current, widthValue, heightValue));
    };

    if (!open) return null;

    const toolItems: Array<{ id: EditorTool; label: string; shortcut: string; icon: typeof MousePointer2 }> = [
        { id: "select", label: t("canvas.editors.selectTool"), shortcut: "V", icon: MousePointer2 },
        { id: "brush", label: t("canvas.editors.brush"), shortcut: "B", icon: Brush },
        { id: "erase", label: t("canvas.editors.erase"), shortcut: "E", icon: Eraser },
        { id: "arrow", label: t("canvas.editors.arrowTool"), shortcut: "A", icon: ArrowUpRight },
        { id: "rect", label: t("canvas.editors.rectTool"), shortcut: "U", icon: Square },
        { id: "text", label: t("canvas.editors.textTool"), shortcut: "T", icon: Type },
        { id: "mosaic", label: t("canvas.editors.mosaicTool"), shortcut: "M", icon: Grid3X3 },
        { id: "crop", label: t("canvas.editors.cropTool"), shortcut: "C", icon: Crop },
    ];
    const settingsTool = toolItems.find((item) => item.id === settingsType);

    return createPortal(
        <div className="fixed inset-0 z-[1200] flex flex-col" style={{ background: theme.canvas.background, color: theme.node.text }} data-canvas-no-zoom>
            <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{t("canvas.editors.imageEditorTitle", { name: title })}</div>
                    <div className="text-[11px] opacity-55">{snapshot ? `${Math.round(snapshot.width)} x ${Math.round(snapshot.height)} px${dirty ? ` · ${t("canvas.editors.unsaved")}` : ""}` : t("canvas.editors.loading")}</div>
                </div>
                <ToolbarButton label={t("canvas.editors.undoEdit")} disabled={!historySize} icon={<Undo2 />} onClick={undo} />
                <ToolbarButton label={t("canvas.editors.redoEdit")} disabled={!redoSize} icon={<Redo2 />} onClick={redo} />
                <div className="mx-1 h-5 w-px" style={{ background: theme.toolbar.border }} />
                <ToolbarButton label={t("canvas.editors.rotateLeft")} icon={<RotateCcw />} onClick={() => transform("left")} />
                <ToolbarButton label={t("canvas.editors.rotateRight")} icon={<RotateCw />} onClick={() => transform("right")} />
                <ToolbarButton label={t("canvas.editors.flipHorizontal")} icon={<FlipHorizontal2 />} onClick={() => transform("horizontal")} />
                <ToolbarButton label={t("canvas.editors.flipVertical")} icon={<FlipVertical2 />} onClick={() => transform("vertical")} />
                <ToolbarButton label={t("canvas.editors.clearEdits")} disabled={!dirty && !crop && !draft && !textEdit} icon={<Trash2 />} onClick={clearEdits} />
                <div className="mx-1 h-5 w-px" style={{ background: theme.toolbar.border }} />
                <ToolbarButton label={t("canvas.editors.zoomOut")} disabled={!viewport.canZoomOut} icon={<ZoomOut />} onClick={viewport.zoomOut} />
                <button type="button" className="min-w-12 text-center text-xs font-medium tabular-nums opacity-70" onClick={viewport.resetZoom}>{Math.round(viewport.zoom * 100)}%</button>
                <ToolbarButton label={t("canvas.editors.zoomIn")} disabled={!viewport.canZoomIn} icon={<ZoomIn />} onClick={viewport.zoomIn} />
                <ToolbarButton label={t("canvas.editors.compressSave")} disabled={saving} icon={<FileArchive />} onClick={() => void saveCompressed()} />
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>{t("canvas.editors.saveNewNode")}</Button>
                <Tooltip title={`${t("common.close")} · Esc`}><Button type="text" icon={<X className="size-5" />} aria-label={t("common.close")} onClick={requestClose} /></Tooltip>
            </header>
            {brushPreview ? <BrushCursor preview={brushPreview} width={width} softness={softness} /> : null}
            {textEdit ? (
                <div
                    className="fixed z-[1240]"
                    style={{ position: "fixed", left: clamp(textEdit.clientX, 82, Math.max(82, window.innerWidth - 572)), top: clamp(textEdit.clientY, 58, Math.max(58, window.innerHeight - 48)), width: 280, maxWidth: "calc(100vw - 370px)" }}
                >
                    <Input
                        ref={textInputRef}
                        className="w-full"
                        style={{ fontSize: textSize }}
                        value={textEdit.value}
                        placeholder={t("canvas.editors.textPlaceholder")}
                        onChange={(event) => setTextEdit({ ...textEdit, value: event.target.value })}
                        onBlur={commitText}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                event.currentTarget.blur();
                            }
                        }}
                    />
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1">
                <aside className="flex w-[74px] shrink-0 flex-col items-center gap-1 border-r py-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    {toolItems.map((item) => {
                        const Icon = item.icon;
                        const active = tool === item.id;
                        return (
                            <Tooltip key={item.id} placement="right" title={`${item.label} (${item.shortcut})`}>
                                <button
                                    type="button"
                                    className="flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] transition"
                                    style={{ background: active ? theme.toolbar.activeBg : "transparent", color: active ? theme.toolbar.activeText : theme.toolbar.item }}
                                    onClick={() => chooseTool(item.id)}
                                >
                                    <Icon className="size-[18px]" />
                                    <span>{item.label}</span>
                                </button>
                            </Tooltip>
                        );
                    })}
                </aside>

                <main
                    ref={viewport.viewportRef}
                    {...viewport.panHandlers}
                    className={`relative min-w-0 flex-1 bg-[radial-gradient(circle,rgba(120,113,108,.22)_1px,transparent_1px)] [background-size:18px_18px] ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                >
                    <div className="relative" style={viewport.contentStyle}>
                        <div ref={viewport.stageRef} className="absolute isolate overflow-hidden bg-transparent [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                            <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                <canvas
                                    ref={canvasRef}
                                    width={previewWidth}
                                    height={previewHeight}
                                    className={`block size-full touch-none ${tool === "brush" || tool === "erase" || brushAdjustRef.current ? "cursor-none" : tool === "select" ? "cursor-default" : tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
                                    onPointerDown={startDrawing}
                                    onPointerMove={moveDrawing}
                                    onPointerUp={stopDrawing}
                                    onPointerCancel={stopDrawing}
                                    onDoubleClick={editExistingText}
                                    onPointerEnter={(event) => {
                                        if (tool === "brush" || tool === "erase") setBrushPreview({ x: event.clientX, y: event.clientY, adjusting: false });
                                    }}
                                    onPointerLeave={() => {
                                        if (!drawingRef.current && !brushAdjustRef.current) setBrushPreview(null);
                                    }}
                                    onContextMenu={(event) => event.preventDefault()}
                                />
                                {crop && snapshot ? (
                                    <div className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,.56),0_0_0_1px_rgba(0,0,0,.45)]" style={cropStyle(crop, snapshot)} onPointerDown={(event) => startCropDrag("move", event)} onPointerMove={moveCropDrag} onPointerUp={stopCropDrag} onPointerCancel={stopCropDrag}>
                                        <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
                                        <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
                                        <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
                                        <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
                                        <span className="pointer-events-none absolute left-1.5 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">{Math.round(crop.width)} x {Math.round(crop.height)}</span>
                                        {cropHandles.map((handle) => <button key={handle} type="button" className="absolute size-3 rounded-full border border-black bg-white" style={cropHandleStyle(handle)} aria-label={t("canvas.editors.adjustCrop")} onPointerDown={(event) => startCropDrag(handle, event)} onPointerMove={moveCropDrag} onPointerUp={stopCropDrag} onPointerCancel={stopCropDrag} />)}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </main>

                <aside className="w-[272px] shrink-0 overflow-y-auto border-l px-4 py-5" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <span>{selectedObject ? t("canvas.editors.selectedAnnotation") : settingsTool?.label}</span>
                        {settingsTool ? <kbd className="rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none opacity-60" style={{ borderColor: theme.toolbar.border }}>{settingsTool.shortcut}</kbd> : null}
                    </div>
                    <div className="mt-1 text-xs leading-5 opacity-55">{selectedObject ? t("canvas.editors.selectedHint") : t(tool === "crop" ? "canvas.editors.imageCropHint" : `canvas.editors.${tool}Hint`)}</div>
                    <div className="mt-6 space-y-5">
                        {settingsType !== "select" && settingsType !== "erase" && settingsType !== "mosaic" && settingsType !== "crop" ? <ColorControl color={color} activeColor={theme.canvas.selectionStroke} onChange={changeColor} /> : null}
                        {settingsType === "brush" || settingsType === "erase" || settingsType === "arrow" || settingsType === "rect" ? <SliderControl label={t("canvas.editors.strokeWidth")} value={width} {...toolWidthRange(settingsType)} suffix="px" onChange={changeWidth} onChangeComplete={selectedObject ? commitSelectedSetting : undefined} /> : null}
                        {settingsType === "brush" || settingsType === "erase" ? <SliderControl label={t("canvas.editors.softness")} value={softness} min={0} max={100} suffix="%" onChange={changeSoftness} onChangeComplete={selectedObject ? commitSelectedSetting : undefined} /> : null}
                        {settingsType === "rect" ? <div className="flex items-center justify-between text-sm"><span>{t("canvas.editors.fillShape")}</span><Switch size="small" checked={fill} onChange={changeFill} /></div> : null}
                        {settingsType === "text" ? <SliderControl label={t("canvas.editors.textSize")} value={textSize} min={6} max={64} suffix="px" onChange={changeTextSize} onChangeComplete={selectedObject ? commitSelectedSetting : undefined} /> : null}
                        {!selectedObject && tool === "crop" ? (
                            <>
                                <div className="space-y-2">
                                    <div className="text-xs font-medium opacity-65">{t("canvas.editors.cropRatio")}</div>
                                    <Select
                                        className="w-full"
                                        getPopupContainer={() => document.body}
                                        styles={{ popup: { root: { zIndex: 1400 } } }}
                                        value={cropRatio}
                                        options={[{ label: t("canvas.editors.free"), value: "free" }, ...["1:1", "2:3", "3:4", "16:9", "9:16"].map((value) => ({ label: value, value })), { label: t("canvas.editors.customRatio"), value: "custom" }]}
                                        onChange={(next) => {
                                            setCropRatio(next);
                                            if (crop && snapshotRef.current) setCrop(fitCropRatio(crop, resolveCropRatio(next, customRatio), snapshotRef.current));
                                        }}
                                    />
                                    {cropRatio === "custom" ? <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><InputNumber min={1} max={99999} value={customRatio.width} onChange={(value) => changeCustomRatio("width", value)} /><span>:</span><InputNumber min={1} max={99999} value={customRatio.height} onChange={(value) => changeCustomRatio("height", value)} /></div> : null}
                                </div>
                                {crop && snapshot ? (
                                    <div className="space-y-2">
                                        <div className="text-xs font-medium opacity-65">{t("canvas.editors.cropPixels")}</div>
                                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                            <InputNumber min={1} max={Math.round(snapshot.width)} value={Math.round(crop.width)} onChange={(value) => changeCropPixels(Number(value) || 1, crop.height)} />
                                            <span>×</span>
                                            <InputNumber min={1} max={Math.round(snapshot.height)} value={Math.round(crop.height)} onChange={(value) => changeCropPixels(crop.width, Number(value) || 1)} />
                                        </div>
                                    </div>
                                ) : null}
                                <div className="flex gap-2"><Button block icon={<X className="size-4" />} onClick={() => { setCrop(null); setTool("select"); }}>{t("common.cancel")}</Button><Button block type="primary" icon={<Check className="size-4" />} disabled={!crop} onClick={applyCrop}>{t("canvas.editors.applyCrop")}</Button></div>
                            </>
                        ) : null}
                        {selectedObject ? <Button danger block type="text" icon={<Trash2 className="size-4" />} onClick={removeSelected}>{t("canvas.editors.deleteAnnotation")}</Button> : null}
                    </div>
                </aside>
            </div>
        </div>,
        document.body,
    );
}

function ToolbarButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
    return <Tooltip title={label}><Button type="text" icon={<span className="[&>svg]:size-4">{icon}</span>} disabled={disabled} aria-label={label} onClick={onClick} /></Tooltip>;
}

function BrushCursor({ preview, width, softness }: { preview: BrushPreview; width: number; softness: number }) {
    const { t } = useTranslation();
    const size = Math.max(4, width);
    const core = Math.max(2, size * (1 - softness / 100));
    return (
        <div className="pointer-events-none fixed z-[1220]" style={{ left: preview.x, top: preview.y, transform: "translate(-50%, -50%)" }}>
            <div className="relative rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.8)]" style={{ width: size, height: size }}>
                {softness > 2 ? <div className="absolute left-1/2 top-1/2 rounded-full border border-dashed border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,.45)]" style={{ width: core, height: core, transform: "translate(-50%, -50%)" }} /> : null}
                <span className="absolute left-1/2 top-1/2 h-3 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,.65)]" style={{ transform: "translate(-50%, -50%)" }} />
                <span className="absolute left-1/2 top-1/2 h-px w-3 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.65)]" style={{ transform: "translate(-50%, -50%)" }} />
            </div>
            {preview.adjusting ? <div className="absolute left-1/2 top-0 mt-[-34px] -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-1 text-xs font-medium text-white">{t("canvas.editors.brushAdjustValue", { size: width, softness })}</div> : null}
        </div>
    );
}

function SliderControl({ label, value, min, max, suffix, onChange, onChangeComplete }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void; onChangeComplete?: () => void }) {
    return <div><div className="flex items-center justify-between text-xs font-medium"><span className="opacity-65">{label}</span><span className="tabular-nums">{value}{suffix}</span></div><Slider min={min} max={max} value={value} onChange={onChange} onChangeComplete={onChangeComplete} /></div>;
}

function ColorControl({ color, activeColor, onChange }: { color: string; activeColor: string; onChange: (color: string) => void }) {
    const { t } = useTranslation();
    const [red, green, blue] = hexToRgb(color);
    const hsv = rgbToHsv(red, green, blue);
    const [hexDraft, setHexDraft] = useState(color.replace(/^#/, "").toUpperCase());
    useEffect(() => setHexDraft(color.replace(/^#/, "").toUpperCase()), [color]);
    const commitHex = () => {
        const normalized = normalizeHexColor(hexDraft);
        if (normalized) onChange(normalized);
        else setHexDraft(color.replace(/^#/, "").toUpperCase());
    };
    return (
        <div className="space-y-3">
            <div className="text-xs font-medium opacity-65">{t("canvas.editors.color")}</div>
            <div className="flex items-center gap-2">{colors.map((value) => <button key={value} type="button" className="size-6 rounded-full border-2 shadow-sm" style={{ background: value, borderColor: color === value ? activeColor : "rgba(120,113,108,.35)" }} aria-label={value} onClick={() => onChange(value)} />)}</div>
            <ColorPlane hue={hsv.h} saturation={hsv.s} value={hsv.v} onChange={(saturation, value) => onChange(hsvToHex(hsv.h, saturation, value))} />
            <div className="flex items-center gap-3">
                <span className="size-9 shrink-0 rounded-full border shadow-sm" style={{ background: color }} />
                <input type="range" min={0} max={360} value={Math.round(hsv.h)} className="h-3 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,.5)]" onChange={(event) => onChange(hsvToHex(Number(event.target.value), hsv.s, hsv.v))} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
                {[red, green, blue].map((value, index) => (
                    <label key={index} className="min-w-0 space-y-1 text-center text-[10px] font-medium opacity-75">
                        <InputNumber className="w-full min-w-0 [&_.ant-input-number-input-wrap]:min-w-0 [&_input]:min-w-0" style={{ minWidth: 0, width: "100%" }} min={0} max={255} value={value} controls={false} onChange={(next) => onChange(rgbToHex(index === 0 ? Number(next) : red, index === 1 ? Number(next) : green, index === 2 ? Number(next) : blue))} />
                        <span>{["R", "G", "B"][index]}</span>
                    </label>
                ))}
            </div>
            <Input value={hexDraft} maxLength={6} prefix="#" aria-label={t("canvas.editors.hexColor")} onChange={(event) => setHexDraft(event.target.value.replace(/^#/, "").toUpperCase())} onBlur={commitHex} onPressEnter={(event) => event.currentTarget.blur()} />
        </div>
    );
}

function ColorPlane({ hue, saturation, value, onChange }: { hue: number; saturation: number; value: number; onChange: (saturation: number, value: number) => void }) {
    const update = (element: HTMLDivElement, clientX: number, clientY: number) => {
        const rect = element.getBoundingClientRect();
        onChange(clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1), clamp(1 - (clientY - rect.top) / Math.max(1, rect.height), 0, 1));
    };
    return (
        <div
            className="relative h-36 cursor-crosshair overflow-hidden rounded-md border"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))` }}
            onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                update(event.currentTarget, event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event.currentTarget, event.clientX, event.clientY);
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        >
            <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.65)]" style={{ left: `${saturation * 100}%`, top: `${(1 - value) * 100}%` }} />
        </div>
    );
}

function isWidthTool(tool: EditorTool | EditorObject["type"]): tool is "brush" | "erase" | "arrow" | "rect" {
    return tool === "brush" || tool === "erase" || tool === "arrow" || tool === "rect";
}

function toolWidthRange(tool: EditorTool | EditorObject["type"]) {
    if (tool === "erase") return { min: 1, max: 150 };
    if (tool === "arrow") return { min: 4, max: 16 };
    if (tool === "rect") return { min: 1, max: 10 };
    return { min: 1, max: 80 };
}

function hexToRgb(value: string) {
    const hex = value.replace("#", "").padEnd(6, "0").slice(0, 6);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] as const;
}

function rgbToHex(red: number, green: number, blue: number) {
    return `#${[red, green, blue].map((value) => clamp(Number.isFinite(value) ? Math.round(value) : 0, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function normalizeHexColor(value: string) {
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) return `#${hex.split("").map((part) => part + part).join("")}`.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`.toLowerCase();
    return null;
}

function rgbToHsv(red: number, green: number, blue: number) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta) hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
    return { h: hue < 0 ? hue + 360 : hue, s: max ? delta / max : 0, v: max };
}

function hsvToHex(hue: number, saturation: number, value: number) {
    const chroma = value * saturation;
    const segment = hue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    const [red, green, blue] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const match = value - chroma;
    return rgbToHex((red + match) * 255, (green + match) * 255, (blue + match) * 255);
}

function normalizeObject(object: EditorObject): EditorObject {
    if (object.type === "rect" || object.type === "mosaic") {
        const rect = normalizeRect(object);
        return { ...object, ...rect };
    }
    return object;
}

function rectFromPoints(start: EditorPoint, end: EditorPoint): EditorRectValue {
    return normalizeRect({ x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y });
}

function normalizeRect(rect: EditorRectValue): EditorRectValue {
    return { x: rect.width < 0 ? rect.x + rect.width : rect.x, y: rect.height < 0 ? rect.y + rect.height : rect.y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

function resolveCropRatio(value: string, custom: { width: number; height: number }) {
    if (value === "free") return null;
    if (value === "custom") return custom.width / Math.max(1, custom.height);
    const [width, height] = value.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

function setCropPixelSize(crop: EditorRectValue, image: { width: number; height: number }, width: number, height: number) {
    const nextWidth = Math.min(image.width, Math.max(1, Math.round(width)));
    const nextHeight = Math.min(image.height, Math.max(1, Math.round(height)));
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    return {
        x: Math.max(0, Math.min(centerX - nextWidth / 2, image.width - nextWidth)),
        y: Math.max(0, Math.min(centerY - nextHeight / 2, image.height - nextHeight)),
        width: nextWidth,
        height: nextHeight,
    };
}

function setEditorObjectWidth(object: EditorObject, visualWidth: number, imageScale: number): EditorObject {
    const width = visualWidth / Math.max(imageScale, 0.001);
    if (object.type === "brush" || object.type === "erase" || object.type === "arrow") return { ...object, width };
    if (object.type === "rect") return { ...object, strokeWidth: width };
    return object;
}

function setEditorObjectBrush(object: EditorObject, visualWidth: number, softness: number, imageScale: number): EditorObject {
    const next = setEditorObjectWidth(object, visualWidth, imageScale);
    return next.type === "brush" || next.type === "erase" ? { ...next, softness: softness / 100 } : next;
}

function sampleCanvasColor(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const x = clamp(Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width), 0, canvas.width - 1);
    const y = clamp(Math.floor(((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height), 0, canvas.height - 1);
    try {
        const [red, green, blue] = canvas.getContext("2d")?.getImageData(x, y, 1, 1).data || [];
        if (red === undefined || green === undefined || blue === undefined) return null;
        return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    } catch {
        return null;
    }
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function fitCropRatio(rect: EditorRectValue, ratio: number | null, image: { width: number; height: number }) {
    let next = normalizeRect(rect);
    if (ratio) {
        if (next.width / Math.max(1, next.height) > ratio) next.width = next.height * ratio;
        else next.height = next.width / ratio;
    }
    next.width = Math.max(1, Math.min(next.width, image.width));
    next.height = Math.max(1, Math.min(next.height, image.height));
    next.x = Math.max(0, Math.min(next.x, image.width - next.width));
    next.y = Math.max(0, Math.min(next.y, image.height - next.height));
    return next;
}

function createCropFromDrag(start: EditorPoint, current: EditorPoint, ratio: number | null, image: { width: number; height: number }) {
    const directionX = current.x >= start.x ? 1 : -1;
    const directionY = current.y >= start.y ? 1 : -1;
    let width = Math.abs(current.x - start.x);
    let height = Math.abs(current.y - start.y);
    const boundWidth = directionX > 0 ? image.width - start.x : start.x;
    const boundHeight = directionY > 0 ? image.height - start.y : start.y;
    if (ratio) {
        if (!height || width / height > ratio) height = width / ratio;
        else width = height * ratio;
        if (width > boundWidth) {
            width = boundWidth;
            height = width / ratio;
        }
        if (height > boundHeight) {
            height = boundHeight;
            width = height * ratio;
        }
    } else {
        width = Math.min(width, boundWidth);
        height = Math.min(height, boundHeight);
    }
    return rectFromPoints(start, { x: start.x + directionX * Math.max(1, width), y: start.y + directionY * Math.max(1, height) });
}

function resizeCrop(crop: EditorRectValue, handle: CropHandle, dx: number, dy: number, image: { width: number; height: number }, ratio: number | null) {
    if (handle === "move") return { ...crop, x: Math.max(0, Math.min(crop.x + dx, image.width - crop.width)), y: Math.max(0, Math.min(crop.y + dy, image.height - crop.height)) };
    const right = crop.x + crop.width;
    const bottom = crop.y + crop.height;
    if (handle.length === 2) {
        const anchorX = handle.includes("w") ? right : crop.x;
        const anchorY = handle.includes("n") ? bottom : crop.y;
        const currentX = (handle.includes("w") ? crop.x : right) + dx;
        const currentY = (handle.includes("n") ? crop.y : bottom) + dy;
        const directionX = currentX >= anchorX ? 1 : -1;
        const directionY = currentY >= anchorY ? 1 : -1;
        let width = Math.abs(currentX - anchorX);
        let height = Math.abs(currentY - anchorY);
        const boundWidth = directionX > 0 ? image.width - anchorX : anchorX;
        const boundHeight = directionY > 0 ? image.height - anchorY : anchorY;
        if (ratio) {
            if (!height || width / height > ratio) height = width / ratio;
            else width = height * ratio;
            if (width > boundWidth) {
                width = boundWidth;
                height = width / ratio;
            }
            if (height > boundHeight) {
                height = boundHeight;
                width = height * ratio;
            }
        } else {
            width = Math.min(width, boundWidth);
            height = Math.min(height, boundHeight);
        }
        return rectFromPoints({ x: anchorX, y: anchorY }, { x: anchorX + directionX * Math.max(1, width), y: anchorY + directionY * Math.max(1, height) });
    }
    if (handle === "w" || handle === "e") {
        const anchorX = handle === "w" ? right : crop.x;
        const currentX = clamp((handle === "w" ? crop.x : right) + dx, 0, image.width);
        const directionX = currentX >= anchorX ? 1 : -1;
        let width = Math.abs(currentX - anchorX);
        if (!ratio) return rectFromPoints({ x: anchorX, y: crop.y }, { x: anchorX + directionX * Math.max(1, width), y: bottom });
        const centerY = crop.y + crop.height / 2;
        const maxHeight = 2 * Math.min(centerY, image.height - centerY);
        let height = width / ratio;
        if (height > maxHeight) {
            height = maxHeight;
            width = height * ratio;
        }
        return rectFromPoints({ x: anchorX, y: centerY - height / 2 }, { x: anchorX + directionX * Math.max(1, width), y: centerY + height / 2 });
    }
    const anchorY = handle === "n" ? bottom : crop.y;
    const currentY = clamp((handle === "n" ? crop.y : bottom) + dy, 0, image.height);
    const directionY = currentY >= anchorY ? 1 : -1;
    let height = Math.abs(currentY - anchorY);
    if (!ratio) return rectFromPoints({ x: crop.x, y: anchorY }, { x: right, y: anchorY + directionY * Math.max(1, height) });
    const centerX = crop.x + crop.width / 2;
    const maxWidth = 2 * Math.min(centerX, image.width - centerX);
    let width = height * ratio;
    if (width > maxWidth) {
        width = maxWidth;
        height = width / ratio;
    }
    return rectFromPoints({ x: centerX - width / 2, y: anchorY }, { x: centerX + width / 2, y: anchorY + directionY * Math.max(1, height) });
}

function cropStyle(crop: EditorRectValue, image: { width: number; height: number }) {
    return { left: `${(crop.x / image.width) * 100}%`, top: `${(crop.y / image.height) * 100}%`, width: `${(crop.width / image.width) * 100}%`, height: `${(crop.height / image.height) * 100}%` };
}

function cropHandleStyle(handle: Exclude<CropHandle, "move">) {
    return { top: handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)", left: handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)", cursor: `${handle}-resize` };
}

