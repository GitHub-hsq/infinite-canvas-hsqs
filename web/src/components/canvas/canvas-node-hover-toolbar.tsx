import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Modal, Segmented, Tooltip } from "antd";
import { Columns2, Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, LayoutGrid, MessageSquare, Minus, Music2, PanelTop, Plus, RefreshCw, Settings2, Trash2, Ungroup, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import { ImageToolSettingsModal, type ImageToolbarSettingsTool } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    batchExpanded?: boolean;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onSetCanvasCover: (node: CanvasNodeData) => void;
    onEditImage: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    onAddToCompare?: (node: CanvasNodeData) => void;
    compareActive?: boolean;
    onOrganize?: (node: CanvasNodeData) => void;
    onUngroup?: (node: CanvasNodeData) => void;
    extraTools?: CanvasNodeToolbarItem[];
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    batchExpanded = false,
    onKeep,
    onLeave,
    onInfo,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onSetCanvasCover,
    onEditImage,
    onMaskEdit,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onViewImage,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onDelete,
    onAddToCompare,
    compareActive = false,
    onOrganize,
    onUngroup,
    extraTools = [],
}: CanvasNodeHoverToolbarProps) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [showImageToolLabels, setShowImageToolLabels] = useState(false);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftShowImageToolLabels, setDraftShowImageToolLabels] = useState(false);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const { message } = App.useApp();
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(config.ids);
            setShowImageToolLabels(config.showLabels);
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setImageToolSettingsOpen(false);
    }, [node?.id]);

    if (!node) return null;

    const activeNode = node;
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    // The toolbar's `top` is its bottom edge because the element translates upward by 100%.
    // Keep that edge three screen pixels above the filename, whose local top is 28px above the card.
    // An expanded batch stacks extra rows of cards above the node (4 per row, 18px gap), so lift the toolbar above them.
    const batchCount = batchExpanded ? node.metadata?.images?.length || node.metadata?.texts?.length || 0 : 0;
    const batchRowsAbove = batchCount > 1 ? Math.ceil(batchCount / Math.min(batchCount, 4)) - 1 : 0;
    const top = viewport.y + (node.position.y - batchRowsAbove * (node.height + 18) - 28) * viewport.k - 3;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canRetry = node.metadata?.status === "error" && !(isVideo && Boolean(node.metadata?.videoTaskId) && !hasVideo);
    const canQueryVideoTask = isVideo && Boolean(node.metadata?.videoTaskId) && !hasVideo && node.metadata?.status !== "loading";
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning(t("canvas.nodeToolbar.noPrompt"));
            return;
        }
        copyText(prompt, t("common.promptCopied"));
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onEditImage, onMaskEdit, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openImageToolSettings() {
        onKeep(activeNode.id);
        setDraftImageToolIds(quickImageToolIds);
        setDraftShowImageToolLabels(showImageToolLabels);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: t("canvas.nodeToolbar.infoTitle"), label: t("canvas.nodeToolbar.info"), icon: <Info className="size-4" />, onClick: () => onInfo(node) },
        ...(hasImage ? [{ id: "setCanvasCover", title: t("canvas.nodeToolbar.setCanvasCoverTitle"), label: t("canvas.nodeToolbar.setCanvasCover"), icon: <PanelTop className="size-4" />, onClick: () => onSetCanvasCover(node) }] : []),
        ...(node.type === CanvasNodeType.Group && onOrganize ? [{ id: "organize", title: t("canvas.nodeToolbar.organizeTitle"), label: t("canvas.nodeToolbar.organize"), icon: <LayoutGrid className="size-4" />, onClick: () => onOrganize(node) }] : []),
        ...(node.type === CanvasNodeType.Group && onUngroup ? [{ id: "ungroup", title: t("canvas.nodeToolbar.ungroupTitle"), label: t("canvas.nodeToolbar.ungroup"), icon: <Ungroup className="size-4" />, onClick: () => onUngroup(node) }] : []),
        { id: "delete", title: t("canvas.nodeToolbar.removeTitle"), label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canQueryVideoTask ? [{ id: "queryVideoTask", title: t("canvas.nodeToolbar.queryVideoTaskTitle"), label: t("canvas.nodeToolbar.queryVideoTask"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(canRetry ? [{ id: "retry", title: t("canvas.nodeToolbar.retryTitle"), label: t("canvas.node.retry"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || hasAudio || isText ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"), label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(isVideo ? [{ id: "edit", title: t("common.edit"), label: t("common.edit"), icon: <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig ? [{ id: "config", title: t("canvas.configNode.title"), label: t("canvas.configNode.title"), icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: t("canvas.nodeToolbar.decreaseFont"), label: t("canvas.nodeToolbar.zoomOut"), icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: t("canvas.nodeToolbar.increaseFont"), label: t("canvas.nodeToolbar.zoomIn"), icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: t("canvas.nodeToolbar.uploadImage"), label: t("canvas.nodeToolbar.uploadImage"), icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), label: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), label: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const imageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools];
    const imageToolbarToolById = new Map(imageToolbarTools.map((tool) => [tool.id, tool]));
    const toolbarTools = hasImage ? quickImageToolIds.flatMap((id) => imageToolbarToolById.get(id) || []) : [...baseToolbarTools, ...nodeToolbarTools, ...extraTools];
    const selectableImageToolbarTools = imageToolbarTools.filter((tool) => tool.id !== "retry") as ImageToolbarSettingsTool[];
    // The compare toggle is always rendered (never filtered by the saved quick-tool list) so it survives reloads.
    const compareTool =
        isImage && hasImage && onAddToCompare
            ? {
                  id: "compare",
                  title: t(compareActive ? "canvas.nodeToolbar.compareRemoveTitle" : "canvas.nodeToolbar.compareTitle"),
                  label: t(compareActive ? "canvas.nodeToolbar.compareRemove" : "canvas.nodeToolbar.compare"),
                  icon: (
                      <span className="relative inline-flex">
                          <Columns2 className="size-4" />
                          <span
                              className={`absolute -right-1.5 -top-1.5 grid size-3.5 place-items-center rounded-full text-[10px] font-bold leading-none ${
                                  compareActive ? "bg-red-500 text-white" : "bg-stone-300 text-stone-700 dark:bg-stone-600 dark:text-stone-200"
                              }`}
                          >
                              {compareActive ? "−" : "+"}
                          </span>
                      </span>
                  ),
                  onClick: () => onAddToCompare(node),
              }
            : null;

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => (visible ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id)));
    };

    const saveImageToolSettings = () => {
        const config = { version: 2, ids: draftImageToolIds, showLabels: draftShowImageToolLabels };
        setQuickImageToolIds(config.ids);
        setShowImageToolLabels(config.showLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    return (
        <>
            <div
                className="absolute z-[70] flex h-11 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-full border px-1.5 text-[15px] shadow-[0_8px_28px_rgba(15,23,42,.16)]"
                data-node-toolbar={node.id}
                style={{ left, top, background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {toolbarTools.map((tool) => (
                    <ToolbarAction key={tool.id} {...tool} showLabel={isImage ? showImageToolLabels : true} />
                ))}
                {compareTool ? <ToolbarAction key="compare" {...compareTool} showLabel={isImage ? showImageToolLabels : true} /> : null}
                {hasImage ? <ToolbarAction id="more" title={t("canvas.imageTools.configure")} label={t("canvas.imageTools.more")} icon={<Ellipsis className="size-4" />} active={imageToolSettingsOpen} onClick={openImageToolSettings} showLabel={showImageToolLabels} /> : null}
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowImageToolLabels}
                    onToggle={setDraftImageToolVisible}
                    onReorder={setDraftImageToolIds}
                    onShowLabelsChange={setDraftShowImageToolLabels}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t, i18n } = useTranslation();
    const [view, setView] = useState<"info" | "json">("info");
    const isImageNode = node?.type === CanvasNodeType.Image;
    const primaryImage = isImageNode ? node?.metadata?.images?.find((image) => image.id === node?.metadata?.primaryImageId) || node?.metadata?.images?.[0] : undefined;
    const actualWidth = isImageNode ? primaryImage?.naturalWidth || node?.metadata?.naturalWidth : undefined;
    const actualHeight = isImageNode ? primaryImage?.naturalHeight || node?.metadata?.naturalHeight : undefined;
    const response = isImageNode ? (primaryImage ? primaryImage.response : node?.metadata?.response) : undefined;
    const fallbackImageBytes = isImageNode && node?.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const imageBytes = isImageNode ? primaryImage?.bytes || node?.metadata?.bytes || fallbackImageBytes : 0;
    const responseUsage = response?.usage
        ? Object.entries(response.usage)
              .map(([key, value]) => `${key}: ${value.toLocaleString(i18n.language)}`)
              .join(" · ")
        : "";
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.images?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>{t("canvas.nodeToolbar.nodeInfo")}</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: t("canvas.nodeToolbar.info"), value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] select-text text-sm" data-canvas-shortcuts-ignore>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label={t("canvas.nodeToolbar.name")} value={node.title || t("canvas.node.untitled")} />
                            <InfoRow label={t("canvas.nodeToolbar.type")} value={node.type === CanvasNodeType.Group ? t("canvas.node.group") : node.type === CanvasNodeType.Config ? t("canvas.configNode.title") : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType) ? t(`assets.kinds.${node.type}`) : getNodeDefinition(node.type)?.title || node.type} />
                            <InfoRow label={t("canvas.nodeToolbar.size")} value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.position")} value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.status")} value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label={t("canvas.nodeToolbar.imageGroup")} value={t("canvas.configNode.images", { count: batchCount })} /> : null}
                            {node.metadata?.prompt ? <InfoRow label={t("canvas.configNode.prompt")} value={node.metadata.prompt} /> : null}
                            {node.metadata?.videoTaskId ? <InfoRow label={t("canvas.nodeToolbar.videoTaskId")} value={node.metadata.videoTaskId} /> : null}
                            {actualWidth && actualHeight ? <InfoRow label={t("canvas.nodeToolbar.outputResolution")} value={`${actualWidth} x ${actualHeight}`} /> : null}
                            {imageBytes ? <InfoRow label={t("canvas.nodeToolbar.imageSize")} value={formatBytes(imageBytes)} /> : null}
                            {response?.quality ? <InfoRow label={t("canvas.nodeToolbar.responseQuality")} value={response.quality} /> : null}
                            {response?.size ? <InfoRow label={t("canvas.nodeToolbar.responseSize")} value={response.size} /> : null}
                            {response?.model ? <InfoRow label={t("canvas.nodeToolbar.responseModel")} value={response.model} /> : null}
                            {response?.id ? <InfoRow label={t("canvas.nodeToolbar.responseId")} value={response.id} /> : null}
                            {response?.created !== undefined ? <InfoRow label={t("canvas.nodeToolbar.responseCreated")} value={formatResponseCreated(response.created, i18n.language)} /> : null}
                            {response?.finishReason ? <InfoRow label={t("canvas.nodeToolbar.finishReason")} value={response.finishReason} /> : null}
                            {response?.revisedPrompt ? <InfoRow label={t("canvas.nodeToolbar.revisedPrompt")} value={response.revisedPrompt} /> : null}
                            {responseUsage ? <InfoRow label={t("canvas.nodeToolbar.responseUsage")} value={responseUsage} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ title, label, icon, onClick, showLabel, active = false, danger = false }: ToolbarTool & { showLabel: boolean }) {
    const hasText = showLabel && Boolean(label);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#292524" styles={{ root: { color: "#ffffff", fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-11 items-center whitespace-nowrap p-0" style={{ color: danger ? "#ef4444" : theme.node.text }} onClick={onClick} aria-label={title}>
                <span className={`flex h-9 items-center ${hasText ? "gap-2 px-2.5" : "justify-center px-2.5"} rounded-full transition`} style={{ background: active ? theme.toolbar.activeBg : undefined }} onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)} onMouseLeave={(event) => (event.currentTarget.style.background = active ? theme.toolbar.activeBg : "transparent")}>
                    {icon}
                    {hasText ? <span>{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}

function formatResponseCreated(value: number | string, locale: string) {
    if (typeof value !== "number") return value;
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(locale);
}
