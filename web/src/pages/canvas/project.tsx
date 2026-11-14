import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Group, Video } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { createVideoGenerationTask, isVideoTaskFailed, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { ensureImagePreview, uploadImage } from "@/services/image-storage";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { computeMediaSize, inferMediaRatio, inferMediaScale } from "@/lib/media-size";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAddAsset } from "@/hooks/use-add-asset";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { fitImageNodeSize, fitNodeSize, imageNodeSizeFromRatio, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { captureVideoFrame, type VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import { App, Button, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasImageLightbox } from "@/components/canvas/canvas-image-lightbox";
import { CanvasImageCompare } from "@/components/canvas/canvas-image-compare";
import { useCompareStore } from "@/stores/use-compare-store";
import { CanvasSelectionToolbar } from "@/components/canvas/canvas-selection-toolbar";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, assetToInsertPayload, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { assetIdsFromReferenceIds, buildNodeMentionReferences, getNodeReferenceNodes, isCanvasReferenceNode, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { applyNodeConfigPatch, audioMetadata, buildAudioGenerationMetadata, buildImageGenerationMetadata, createCanvasNode, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import {
    applyGroupSelection,
    applyUngroupSelection,
    canGroupSelectedNodes,
    canUngroupSelectedNodes,
    collectGroupMemberNodes,
    findContainingGroupId,
    findGroupDropTarget,
    focusViewportForNode,
    getConnectionTargetAnchor,
    getGroupWrapRect,
    GROUP_WRAP_PADDING,
    GROUP_WRAP_TOP_PADDING,
    nodeBounds,
    normalizeConnection,
    snapNodesIntoGroup,
    tidyNodeLayout,
} from "@/lib/canvas/canvas-node-geometry";
import {
    audioExtension,
    buildAnglePrompt,
    buildGenerationConfig,
    findRetrySourceNode,
    generationReferenceUrls,
    getGenerationCount,
    getInputSummary,
    hasResumableVideoTask,
    hydrateAssistantImages,
    hydrateCanvasImages,
    imageExtension,
    isAudioFile,
    isGenerationCanceled,
    resetInterruptedGeneration,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
} from "@/lib/canvas/canvas-generation-helpers";
import { getNodeDefinition, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { ConnectionCreateMenu, NodeCreateMenu, type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasNodeImage,
    type CanvasNodeText,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

// Register built-in nodes in the shared registry once when the module loads.
registerBuiltinNodes();

const CanvasImageEditor = lazy(() => import("@/components/canvas/canvas-image-editor"));

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

// Stable empty reference array prevents `... || []` from invalidating CanvasNode's React.memo on every render.
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;

// 切断参考连线时，同步从目标节点保存的引用列表里移除该来源，避免参考栏仍显示已切断的项。
function withoutReferenceLink(nodes: CanvasNodeData[], toNodeId: string, fromNodeId: string) {
    const target = nodes.find((node) => node.id === toNodeId);
    if (!target?.metadata?.referenceNodeIds?.includes(fromNodeId)) return nodes;
    return nodes.map((node) =>
        node.id === toNodeId && node.metadata?.referenceNodeIds
            ? { ...node, metadata: { ...node.metadata, referenceNodeIds: node.metadata.referenceNodeIds.filter((id) => id !== fromNodeId) } }
            : node,
    );
}

type GenerationRerun = { nodeId: string; mode: CanvasNodeGenerationMode; prompt: string };

// A clone of a node that is mid-generation must not fake the loading state or share its video task:
// strip the run state so the clone starts clean, and hand back what is needed to run a real generation.
function splitGeneratingClone(metadata: CanvasNodeMetadata | undefined) {
    if (!metadata) return { metadata, rerun: null };
    if (metadata.status !== NODE_STATUS_LOADING) return { metadata: { ...metadata }, rerun: null };
    const { status, startedAt, errorDetails, response, images, primaryImageId, texts, primaryTextId, videoTaskId, videoTaskProvider, content, durationMs, ...rest } = metadata;
    return { metadata: rest as CanvasNodeMetadata, rerun: metadata.generationMode ? { mode: metadata.generationMode, prompt: metadata.prompt || "" } : null };
}
const NODE_STATUS_ERROR = "error" as const;
// Screen pixels per second the canvas pans while WASD is held during a drag.
const KEY_PAN_SPEED = 1200;
const KEY_PAN_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

/** The on-canvas footprint of a node, including the fanned-out cards of an expanded image/text batch. */
function visualNodeRect(node: CanvasNodeData) {
    const count = node.metadata?.images?.length || node.metadata?.texts?.length || 0;
    if (count <= 1) return { x: node.position.x, y: node.position.y, width: node.width, height: node.height };
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    return {
        x: node.position.x,
        y: node.position.y - (rows - 1) * (node.height + 18),
        width: columns * (node.width + 18) - 18,
        height: rows * (node.height + 18) - 18,
    };
}

/** Place a generated child to the right of its source without covering existing nodes or expanded batch cards. */
function findFreeChildPosition(nodes: CanvasNodeData[], sourceNode: CanvasNodeData | undefined, size: { width: number; height: number }, fallback: Position): Position {
    const gap = 96;
    const padding = 24;
    const sourceRect = sourceNode ? visualNodeRect(sourceNode) : null;
    let x = sourceRect ? sourceRect.x + sourceRect.width + gap : fallback.x;
    let y = sourceNode ? sourceNode.position.y + sourceNode.height / 2 - size.height / 2 : fallback.y;
    const overlaps = (px: number, py: number) =>
        nodes.some((node) => {
            if (node.id === sourceNode?.id) return false;
            const rect = visualNodeRect(node);
            return px < rect.x + rect.width + padding && px + size.width + padding > rect.x && py < rect.y + rect.height + padding && py + size.height + padding > rect.y;
        });
    let guard = 0;
    while (overlaps(x, y) && guard < 60) {
        x += size.width + gap;
        guard += 1;
    }
    return { x, y };
}

function applyGeneratedVideo(item: CanvasNodeData, video: UploadedFile, extra: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    const videoSize = fitImageNodeSize(video.width || item.width, video.height || item.height);
    return {
        ...item,
        width: videoSize.width,
        height: videoSize.height,
        position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
        metadata: { ...item.metadata, ...videoMetadata(video), ...extra },
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function measureFocusFrame(container: HTMLDivElement | null, nodeId: string) {
    if (!container) return {};
    const nodeRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.getBoundingClientRect();
    const panelRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] [data-node-panel]`)?.getBoundingClientRect();
    const toolbarRect = document.querySelector<HTMLElement>(`[data-node-toolbar="${nodeId}"]`)?.getBoundingClientRect();
    const dockRect = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")?.getBoundingClientRect();
    const below = nodeRect && panelRect ? panelRect.bottom - nodeRect.bottom : 0;
    const above = nodeRect && toolbarRect ? nodeRect.top - toolbarRect.top : 0;
    return { above, below, bottomInset: dockRect && below > 0 ? Math.max(0, container.getBoundingClientRect().bottom - dockRect.top) : 0 };
}

/**
 * Size for a node created by dragging a connection out of `sourceNode`.
 * A node that already carries a size passes it along; a media node contributes
 * its aspect ratio, kept at the resolution the user already works at.
 */
function inheritNodeSize(sourceNode: CanvasNodeData | undefined, fallbackSize: string) {
    if (!sourceNode) return fallbackSize;
    if (sourceNode.metadata?.size) return sourceNode.metadata.size;

    const primaryImage = sourceNode.metadata?.images?.find((image) => image.id === sourceNode.metadata?.primaryImageId) || sourceNode.metadata?.images?.[0];
    const width = primaryImage?.naturalWidth || sourceNode.metadata?.naturalWidth;
    const height = primaryImage?.naturalHeight || sourceNode.metadata?.naturalHeight;
    if (!width || !height) return fallbackSize;

    return computeMediaSize(inferMediaScale(fallbackSize), inferMediaRatio(`${width}x${height}`));
}

/** Generation settings a node dragged out of `sourceNode` starts with, so it matches the node it came from. */
// A node dragged out of another one inherits that node's generation settings, so re-generating
// continues with the same model and parameters. Irrelevant fields are ignored per generation mode,
// and a model of a different capability falls back to that mode's default during request building.
function inheritGenerationMetadata(sourceNode: CanvasNodeData | undefined, fallbackSize: string) {
    const source = sourceNode?.metadata;
    const metadata: CanvasNodeData["metadata"] = { size: inheritNodeSize(sourceNode, fallbackSize) };
    if (source?.model) metadata.model = source.model;
    if (source?.quality) metadata.quality = source.quality;
    if (source?.count) metadata.count = source.count;
    if (source?.background) metadata.background = source.background;
    if (source?.reasoningEffort) metadata.reasoningEffort = source.reasoningEffort;
    if (source?.textCount) metadata.textCount = source.textCount;
    if (source?.seconds) metadata.seconds = source.seconds;
    if (source?.vquality) metadata.vquality = source.vquality;
    if (source?.generateAudio) metadata.generateAudio = source.generateAudio;
    if (source?.watermark) metadata.watermark = source.watermark;
    if (source?.videoMode) metadata.videoMode = source.videoMode;
    if (source?.audioVoice) metadata.audioVoice = source.audioVoice;
    if (source?.audioFormat) metadata.audioFormat = source.audioFormat;
    if (source?.audioSpeed) metadata.audioSpeed = source.audioSpeed;
    if (source?.audioInstructions) metadata.audioInstructions = source.audioInstructions;
    return metadata;
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    // Subscribe to the registry version so plugin registration changes rerender the canvas.
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const fragmentBootstrap = useAgentStore((state) => state.fragmentBootstrap);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const nodeDraggingRef = useRef(false);
    const pointerClientRef = useRef<Position | null>(null);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        // Keyed by node id so drag frames look positions up in O(1) instead of scanning the array per node.
        initialSelectedNodes: Map<string, { x: number; y: number }>;
        movedIds: Set<string>;
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: new Map(),
        movedIds: new Set(),
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const assets = useAssetStore((state) => state.assets);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const { addAsset } = useAddAsset();
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [canvasTool, setCanvasTool] = useState<"select" | "pan">("select");
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [proximityNodeId, setProximityNodeId] = useState<string | null>(null);
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [editingNodeTitleId, setEditingNodeTitleId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
    const [editNodeId, setEditNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [compareOpen, setCompareOpen] = useState(false);
    const compareItemCount = useCompareStore((state) => state.items.length);
    const compareItems = useCompareStore((state) => state.items);
    const addCompareImage = useCompareStore((state) => state.addItem);
    const removeCompareImage = useCompareStore((state) => state.removeItem);
    const handleAddToCompare = useCallback(
        (node: CanvasNodeData) => {
            // Persist the storage key (survives reloads); src is only a fallback for non-persisted sources.
            const storageKey = node.metadata?.storageKey;
            const src = storageKey ? undefined : node.metadata?.content;
            if (!storageKey && !src) return;
            const existing = compareItems.find((item) => (storageKey ? item.storageKey === storageKey : Boolean(item.src) && item.src === src));
            if (existing) {
                removeCompareImage(existing.id);
                message.success(t("canvas.compare.removed"));
                return;
            }
            const result = addCompareImage({ storageKey, src, title: node.title || t("assets.kinds.image"), width: node.metadata?.naturalWidth, height: node.metadata?.naturalHeight });
            if (result === "duplicate") message.info(t("canvas.compare.duplicate"));
            else if (result === "full") message.warning(t("canvas.compare.full"));
            else message.success(t("canvas.compare.added"));
        },
        [addCompareImage, compareItems, message, removeCompareImage, t],
    );
    const [hoverPreviewNodeId, setHoverPreviewNodeId] = useState<string | null>(null);
    const [previewImageId, setPreviewImageId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [expandedBatchNodeIds, setExpandedBatchNodeIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [isNodeResizing, setIsNodeResizing] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);

    useEffect(() => {
        const openPluginManager = () => setPluginManagerOpen(true);
        window.addEventListener("canvas-open-plugin-manager", openPluginManager);
        return () => window.removeEventListener("canvas-open-plugin-manager", openPluginManager);
    }, []);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const focusAnimRef = useRef<number | null>(null);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const videoPollIdsRef = useRef(new Set<string>());

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const completeVideoNodeTask = useCallback(
        async (
            nodeId: string,
            config: Parameters<typeof buildGenerationConfig>[0],
            prompt: string,
            images: Parameters<typeof createVideoGenerationTask>[2],
            signal: AbortSignal,
            extra: CanvasNodeData["metadata"] = {},
            videos: ReferenceVideo[] = [],
            audios: ReferenceAudio[] = [],
        ) => {
            const task = await createVideoGenerationTask(config, prompt, images, { signal, videos, audios });
            if (task.provider !== "plugin") {
                setNodes((prev) => prev.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, videoTaskId: task.id, videoTaskProvider: task.provider === "gemini" ? "gemini" : "openai", model: config.model } } : item)));
            }
            const video = await storeGeneratedVideo(await waitForVideoGenerationTask(config, task, { signal }));
            setNodes((prev) => prev.map((item) => (item.id === nodeId ? applyGeneratedVideo(item, video, { prompt, model: config.model, ...extra }) : item)));
        },
        [],
    );

    const pollVideoNodeTask = useCallback(
        async (node: CanvasNodeData, silent = false) => {
            const taskId = node.metadata?.videoTaskId;
            if (!taskId || node.metadata?.content || generationRequestsRef.current.has(node.id) || videoPollIdsRef.current.has(node.id)) return;
            videoPollIdsRef.current.add(node.id);
            let controller: AbortController | undefined;
            try {
                const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
                if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                    if (silent) {
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: t("workbench.configFirst") } } : item)));
                        return;
                    }
                    openConfigDialog(true);
                    return;
                }
                setRunningNodeId(node.id);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, startedAt: Date.now(), errorDetails: undefined } } : item)));
                controller = startGenerationRequest(node.id, node.id, node.id);
                const video = await storeGeneratedVideo(
                    await waitForVideoGenerationTask(generationConfig, { id: taskId, provider: node.metadata?.videoTaskProvider === "gemini" ? "gemini" : "openai", model: generationConfig.model }, { signal: controller.signal }),
                );
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? applyGeneratedVideo(item, video, {
                                  prompt: item.metadata?.prompt,
                                  model: generationConfig.model,
                                  size: generationConfig.size,
                                  seconds: generationConfig.videoSeconds,
                                  vquality: generationConfig.vquality,
                                  generateAudio: generationConfig.videoGenerateAudio,
                                  watermark: generationConfig.videoWatermark,
                                  videoMode: generationConfig.videoMode,
                              })
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : errorDetails,
                                      ...(isVideoTaskFailed(error) ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                videoPollIdsRef.current.delete(node.id);
                if (controller) {
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                }
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t],
    );

    const stopGenerationByRunningId = useCallback(
        (runningId: string) => {
            const affectedNodeIds = new Set<string>();
            generationRequestsRef.current.forEach((request) => {
                if (request.runningNodeId !== runningId) return;
                request.controller.abort();
                generationRequestsRef.current.delete(request.targetNodeId);
                affectedNodeIds.add(request.targetNodeId);
                affectedNodeIds.add(request.originNodeId);
            });
            setRunningNodeId((current) => (current === runningId ? null : current));
            if (!affectedNodeIds.size) return;
            setNodes((prev) =>
                prev.map((node) =>
                    affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  status: NODE_STATUS_IDLE,
                                  errorDetails: undefined,
                                  images: node.metadata.images?.map((image) => (image.status === NODE_STATUS_LOADING ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : image)),
                                  texts: node.metadata.texts?.map((text) => (text.status === NODE_STATUS_LOADING ? { ...text, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : text)),
                              },
                          }
                        : node,
                ),
            );
        },
        [t],
    );

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: t("canvas.projectPage.stopTitle"),
                content: t("canvas.projectPage.stopDescription"),
                okText: t("canvas.projectPage.stop"),
                cancelText: t("canvas.projectPage.continue"),
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId, t],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const restore = async () => {
            const hydratedNodes = await hydrateCanvasImages(resetInterruptedGeneration(project.nodes));
            // Repair cards whose ratio drifted from their image (e.g. earlier ratio-clamped pastes left
            // empty bars): resize the card back to the image's own ratio, capped at the default card size.
            const restoredNodes = hydratedNodes.map((node) => {
                if (node.type !== CanvasNodeType.Image || node.metadata?.freeResize || !node.metadata?.naturalWidth || !node.metadata?.naturalHeight) return node;
                const naturalRatio = node.metadata.naturalWidth / node.metadata.naturalHeight;
                const cardRatio = node.width / Math.max(1, node.height);
                if (Math.abs(cardRatio - naturalRatio) / naturalRatio < 0.02) return node;
                const size = fitImageNodeSize(node.metadata.naturalWidth, node.metadata.naturalHeight, node.width * node.height);
                const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                return { ...node, width: size.width, height: size.height, position: { x: center.x - size.width / 2, y: center.y - size.height / 2 } };
            });
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            setNodes(restoredNodes);
            setConnections(project.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
    }, [hydrated, navigate, openProject, projectId]);

    useEffect(() => {
        if (!projectLoaded) return;
        nodesRef.current.filter(hasResumableVideoTask).forEach((node) => void pollVideoNodeTask(node, true));
        // Resume once after the current canvas is restored, not on later config identity changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectLoaded]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl") && !localAgentEnabled && !fragmentBootstrap) openAgentPanel();
    }, [fragmentBootstrap, localAgentEnabled, openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (
            previous?.nodes === next.nodes &&
            previous.connections === next.connections &&
            previous.chatSessions === next.chatSessions &&
            previous.activeChatId === next.activeChatId &&
            previous.backgroundMode === next.backgroundMode &&
            previous.showImageInfo === next.showImageInfo
        )
            return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [projectLoaded]);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    // 外部粘贴落在鼠标当前位置（mousemove 持续记录的指针）；纯键盘触发的粘贴回落到画布中心。
    const pasteDropPosition = useCallback(() => {
        const pointer = pointerClientRef.current;
        return pointer ? screenToCanvas(pointer.x, pointer.y) : getCanvasCenter();
    }, [getCanvasCenter, screenToCanvas]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen || !selectedNodeIdsRef.current.has(nodeId)) return;
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            const validConnections = (current.sourceNodeIds || [current.nodeId]).flatMap((sourceId) => {
                const connection = normalizeConnection(sourceId, targetNodeId, nodesRef.current, current.handleType);
                return connection ? [connection] : [];
            });
            if (!validConnections.length) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            setConnections((prev) => {
                const additions = validConnections.filter((connection) => !prev.some((conn) => conn.fromNodeId === connection.fromNodeId && conn.toNodeId === connection.toNodeId));
                return additions.length ? [...prev, ...additions.map((connection) => ({ id: nanoid(), ...connection }))] : prev;
            });
            setContextMenu(null);
        },
        [message, t],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            // A node dragged out of another one starts with that node's ratio and generation settings,
            // and the empty card is already shaped to that ratio so it does not jump once it generates.
            const sourceNode = nodesRef.current.find((node) => node.id === pending.connection.nodeId);
            const inherited = inheritGenerationMetadata(sourceNode, effectiveConfig.size);
            const inheritsRatio = type === CanvasNodeType.Image || type === CanvasNodeType.Video || type === CanvasNodeType.Config;
            const metadata =
                type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count), ...inherited } : inherited;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const ratioSize = inheritsRatio && type === CanvasNodeType.Image ? imageNodeSizeFromRatio(inherited.size || "") : inheritsRatio ? nodeSizeFromRatio(inherited.size || "", newNode.width, newNode.height) : null;
            if (ratioSize) {
                newNode.width = ratioSize.width;
                newNode.height = ratioSize.height;
            }
            // The drop point is the new card's left-edge midpoint, so the card opens to the right of the pointer.
            newNode.position = { x: pending.position.x, y: pending.position.y - newNode.height / 2 };
            const nextNodes = [...nodesRef.current, newNode];
            const newConnections = (pending.connection.sourceNodeIds || [pending.connection.nodeId]).flatMap((sourceId) => {
                const connection = normalizeConnection(sourceId, newNode.id, nextNodes, pending.connection.handleType);
                return connection ? [{ id: nanoid(), ...connection }] : [];
            });
            if (!newConnections.length) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, ...newConnections]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Config) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting, t],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            const sourceIds = current.sourceNodeIds || [current.nodeId];
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current].reverse().forEach((node) => {
                const anchor = getConnectionTargetAnchor(node, current);
                const dx = world.x - anchor.x;
                const dy = world.y - anchor.y;
                const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                isNearNode = true;
                if (sourceIds.includes(node.id) || !sourceIds.some((sourceId) => normalizeConnection(sourceId, node.id, nodesRef.current, current.handleType))) return;

                const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                if (priority < bestPriority) {
                    bestNodeId = node.id;
                    bestPriority = priority;
                }
            });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const viewBounds = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const left = -viewport.x / viewport.k - padding;
        const top = -viewport.y / viewport.k - padding;
        return { left, top, right: left + width / viewport.k + padding * 2, bottom: top + height / viewport.k + padding * 2 };
        // `nodes` keeps the container rect re-read on node changes, matching the previous behaviour when the container resizes without a size update.
    }, [nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const visibleNodes = useMemo(
        () => nodes.filter((node) => node.position.x + node.width > viewBounds.left && node.position.x < viewBounds.right && node.position.y + node.height > viewBounds.top && node.position.y < viewBounds.bottom),
        [nodes, viewBounds],
    );

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

    // Connections are culled like nodes; a cubic curve stays inside its control-point hull, so endpoint bounds widened by the curvature is a safe test.
    const visibleConnections = useMemo(
        () =>
            connections.flatMap((connection) => {
                const from = nodeById.get(connection.fromNodeId);
                const to = nodeById.get(connection.toNodeId);
                if (!from || !to) return [];
                const startX = from.position.x + from.width;
                const startY = from.position.y + from.height / 2;
                const endX = to.position.x;
                const endY = to.position.y + to.height / 2;
                const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
                const inView = Math.max(startX + curvature, endX) > viewBounds.left && Math.min(startX, endX - curvature) < viewBounds.right && Math.max(startY, endY) > viewBounds.top && Math.min(startY, endY) < viewBounds.bottom;
                return inView ? [{ connection, from, to }] : [];
            }),
        [connections, nodeById, viewBounds],
    );
    // The toolbar follows a single selected node selected by click, creation, marquee, or keyboard.
    // It stays hidden for multi-selection and while isNodeDragging is true.
    const singleSelectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const toolbarNode = (toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null) || (singleSelectedNodeId ? nodeById.get(singleSelectedNodeId) || null : null);
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const editNode = editNodeId ? nodeById.get(editNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const contextMenuNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const previewContent = previewImageId ? previewNode?.metadata?.images?.find((image) => image.id === previewImageId)?.content : previewNode?.metadata?.content;
    // Multi-image nodes browse every completed image in the lightbox via side arrows and the thumbnail strip.
    const previewImages = useMemo(() => {
        const list = (previewNode?.metadata?.images || []).filter((image) => image.content).map((image) => ({ id: image.id, src: image.content, width: image.naturalWidth, height: image.naturalHeight }));
        return list.length > 1 ? list : [];
    }, [previewNode]);
    const previewIndex = previewImages.findIndex((image) => image.src === previewContent);
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const selectedNodes = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.id)), [nodes, selectedNodeIds]);
    const canGroupSelection = canGroupSelectedNodes(selectedNodeIds, nodes);
    const canUngroupSelection = canUngroupSelectedNodes(selectedNodeIds, nodes);
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    // A node with no inbound link is a start node: it offers only the outgoing "+" handle.
    const nodeIdsWithIncoming = useMemo(() => new Set(connections.map((connection) => connection.toNodeId)), [connections]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        const addNode = (nodeId: string) => {
            nodeIds.add(nodeId);
            if (nodeById.get(nodeId)?.type === CanvasNodeType.Group) nodes.forEach((node) => node.metadata?.groupId === nodeId && nodeIds.add(node.id));
        };
        addNode(activeNodeId);
        // Only the hovered node is highlighted; its neighbours stay untouched and just their links stand out.
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections, nodeById, nodes]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections, assets));
        });
        return map;
    }, [assets, connections, nodes]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections, assets)));
        return map;
    }, [assets, connections, nodes]);
    const connectedNodesByNodeId = useMemo(() => {
        const map = new Map<string, CanvasNodeData[]>();
        connections.forEach((connection) => {
            const source = nodeById.get(connection.fromNodeId);
            if (!source || !isCanvasReferenceNode(source, nodes)) return;
            const connected = map.get(connection.toNodeId);
            if (connected) connected.push(source);
            else map.set(connection.toNodeId, [source]);
        });
        nodes.filter((node) => node.metadata?.referenceNodeIds !== undefined || node.metadata?.requestPrompt).forEach((node) => {
            // The reference bar manages connections and saved ids; @ chips live in the prompt text only.
            const references = getNodeReferenceNodes(node.id, nodes, connections, { includeMentions: false });
            if (references.length || node.metadata?.referenceNodeIds !== undefined) map.set(node.id, references);
        });
        return map;
    }, [connections, nodeById, nodes]);
    const { applyAgentOps } = useAgentBridge({
        projectId,
        title: currentProject?.title,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
    });

    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
    });
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // Display-only plugin nodes with hidePanel do not open a panel; custom Panels require autoOpenPanel on creation.
            // Plugin nodes declaring useBuiltinPanel open the built-in generation panel on creation, like image nodes.
            // Built-in image, video, and config nodes retain their existing open-on-create behavior.
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group && type !== CanvasNodeType.Config;
            if (wantsPanel) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    return node;
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setExpandedBatchNodeIds((current) => new Set([...current].filter((nodeId) => !allIds.has(nodeId))));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const groupSelection = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        const members = collectGroupMemberNodes(selectedIds, nodesRef.current);
        if (members.length < 2) return;
        const rect = getGroupWrapRect(members);
        const created = createCanvasNode(CanvasNodeType.Group, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        const result = applyGroupSelection(selectedIds, nodesRef.current, connectionsRef.current, { ...created, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height });
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setToolbarNodeId(result.selectedIds[0] || null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    const ungroupSelection = useCallback((ids?: Set<string>) => {
        const result = applyUngroupSelection(ids || selectedNodeIdsRef.current, nodesRef.current, connectionsRef.current);
        if (!result) return;
        setNodes(result.nodes);
        setConnections(result.connections);
        setSelectedNodeIds(new Set(result.selectedIds));
        setSelectedConnectionId(null);
        setToolbarNodeId(result.selectedIds.length === 1 ? result.selectedIds[0] : null);
        setDialogNodeId(null);
        setContextMenu(null);
    }, []);

    const deleteConnection = useCallback((connectionId: string) => {
        const connection = connectionsRef.current.find((conn) => conn.id === connectionId);
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        if (connection) setNodes((prev) => withoutReferenceLink(prev, connection.toNodeId, connection.fromNodeId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    // Tidy layout for the current selection: each selected group arranges its own members and re-wraps;
    // a loose selection flows into rows anchored at its current bounding box. Nodes are only moved, never resized.
    const organizeSelection = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;
        const members = collectGroupMemberNodes(selectedIds, nodesRef.current);
        if (members.length < 2) return;
        const selectedGroups = nodesRef.current.filter((node) => selectedIds.has(node.id) && node.type === CanvasNodeType.Group);
        if (selectedGroups.length) {
            setNodes((prev) => {
                let next = prev;
                for (const group of selectedGroups) {
                    const groupMembers = members.filter((member) => member.metadata?.groupId === group.id);
                    if (groupMembers.length < 2) continue;
                    const widest = Math.max(...groupMembers.map((member) => member.width));
                    const positions = tidyNodeLayout(groupMembers, Math.max(group.width - GROUP_WRAP_PADDING * 2, widest));
                    const placedById = new Map(
                        groupMembers.map((member) => [
                            member.id,
                            {
                                x: group.position.x + GROUP_WRAP_PADDING + (positions.get(member.id)?.x ?? 0),
                                y: group.position.y + GROUP_WRAP_TOP_PADDING + (positions.get(member.id)?.y ?? 0),
                            },
                        ]),
                    );
                    const placed = groupMembers.map((member) => ({ ...member, position: placedById.get(member.id)! }));
                    const rect = getGroupWrapRect(placed);
                    next = next.map((node) => {
                        const position = placedById.get(node.id);
                        if (position) return { ...node, position };
                        if (node.id === group.id) return { ...node, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height };
                        return node;
                    });
                }
                return next;
            });
            return;
        }
        const bounds = nodeBounds(members);
        const widest = Math.max(...members.map((member) => member.width));
        const positions = tidyNodeLayout(members, Math.max(bounds.right - bounds.left, widest));
        setNodes((prev) =>
            prev.map((node) => {
                const offset = positions.get(node.id);
                return offset ? { ...node, position: { x: bounds.left + offset.x, y: bounds.top + offset.y } } : node;
            }),
        );
    }, []);

    const disconnectNodeReference = useCallback((fromNodeId: string, toNodeId: string) => {
        const target = nodesRef.current.find((node) => node.id === toNodeId);
        if (target?.metadata?.referenceNodeIds !== undefined || target?.metadata?.requestPrompt) {
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === toNodeId
                        ? { ...node, metadata: { ...node.metadata, referenceNodeIds: getNodeReferenceNodes(toNodeId, prev, connectionsRef.current, { includeMentions: false }).map((reference) => reference.id).filter((id) => id !== fromNodeId) } }
                        : node,
                ),
            );
        }
        setConnections((prev) => prev.filter((connection) => connection.fromNodeId !== fromNodeId || connection.toNodeId !== toNodeId));
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        };
        const referenceConnections = connectionsRef.current.filter((connection) => connection.toNodeId === nodeId).map((connection) => ({ ...connection, id: nanoid(), toNodeId: id }));

        setNodes((prev) => [...prev, next]);
        setConnections((prev) => [...prev, ...referenceConnections]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
    }, []);

    const generationRerunQueueRef = useRef<GenerationRerun[]>([]);
    // Re-runs start in a macrotask so the clones are committed and visible in nodesRef when the request reads them.
    const queueGenerationReruns = useCallback((entries: GenerationRerun[]) => {
        if (!entries.length) return;
        generationRerunQueueRef.current.push(...entries);
        setTimeout(() => generationRerunQueueRef.current.splice(0).forEach(({ nodeId, mode, prompt }) => void generateNodeRef.current?.(nodeId, mode, prompt)), 0);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    // Ctrl/Cmd + D clones the selection next to itself without touching the copy/paste clipboard.
    const duplicateSelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return false;
        const sourceNodes = nodesRef.current.filter((node) => selectedIds.has(node.id));
        if (!sourceNodes.length) return false;

        const offset = 32;
        const idMap = new Map<string, string>();
        const reruns: GenerationRerun[] = [];
        const clones = sourceNodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            const { metadata, rerun } = splitGeneratingClone(node.metadata);
            if (rerun) reruns.push({ nodeId: id, mode: rerun.mode, prompt: rerun.prompt });
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: { x: node.position.x + offset, y: node.position.y + offset },
                metadata,
            };
        });

        const duplicated = clones.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId || !idMap.has(groupId)) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        // Keep wiring inside the selection, and keep inbound links from parents outside it so the
        // copy stays fed by the same sources. Outgoing links to outside nodes are not duplicated.
        const clonedConnections = connectionsRef.current.flatMap((connection, index) => {
            const toNodeId = idMap.get(connection.toNodeId);
            if (!toNodeId) return [];
            const fromNodeId = idMap.get(connection.fromNodeId) ?? connection.fromNodeId;
            return [{ ...connection, id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, fromNodeId, toNodeId }];
        });

        setNodes((prev) => [...prev, ...duplicated]);
        setConnections((prev) => [...prev, ...clonedConnections]);
        setSelectedNodeIds(new Set(duplicated.map((node) => node.id)));
        const panelNode = duplicated.find((node) => node.type !== CanvasNodeType.Group && !getNodeDefinition(node.type)?.hidePanel);
        setDialogNodeId(panelNode?.id || null);
        setSelectedConnectionId(null);
        setContextMenu(null);
        queueGenerationReruns(reruns);
        return true;
    }, [queueGenerationReruns]);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        // 粘贴锚点跟随鼠标当前位置（无指针记录时回落画布中心），整组节点以包围盒中心对齐到该点。
        const anchor = pasteDropPosition();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = anchor.x - (bounds.left + bounds.right) / 2;
        const dy = anchor.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const reruns: GenerationRerun[] = [];
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            const { metadata, rerun } = splitGeneratingClone(node.metadata);
            if (rerun) reruns.push({ nodeId: id, mode: rerun.mode, prompt: rerun.prompt });
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata,
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const toNodeId = idMap.get(connection.toNodeId);
            if (!toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId: idMap.get(connection.fromNodeId) ?? connection.fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        queueGenerationReruns(reruns);
        return true;
    }, [pasteDropPosition, queueGenerationReruns]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            setHoverPreviewNodeId(null);
            const target = focusViewportForNode(node, size, measureFocusFrame(containerRef.current, nodeId));
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);

            if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
            const start = { ...viewportRef.current };
            const duration = 450;
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
            let startTime: number | null = null;
            const step = (now: number) => {
                if (startTime === null) startTime = now;
                const progress = Math.min((now - startTime) / duration, 1);
                const t = easeOutCubic(progress);
                setViewport({ x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t, k: start.k + (target.k - start.k) * t });
                focusAnimRef.current = progress < 1 ? requestAnimationFrame(step) : null;
            };
            focusAnimRef.current = requestAnimationFrame(step);
        },
        [size.height, size.width],
    );

    const focusNodeRef = useRef(focusNode);
    useEffect(() => {
        focusNodeRef.current = focusNode;
    }, [focusNode]);

    useEffect(() => () => void (focusAnimRef.current && cancelAnimationFrame(focusAnimRef.current)), []);

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }));
        navigate(`/canvas/${id}`);
    }, [createProject, navigate, t]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error(t("canvas.projectPage.notFound"));
        const hide = message.loading(t("canvas.projectPage.exporting"), 0);
        try {
            await exportCanvasProjects([project], project.title || t("canvas.title"));
            message.success(t("canvas.projectPage.exported"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
        }
    }, [message, projectId, t]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    // Selection-only logic shared by the bubbling drag entry point and outer capture handler.
    // Returns the single target ID after the click, or null for multi-selection or deselection, to sync the toolbar.
    const selectNodeByEvent = useCallback((event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">, nodeId: string) => {
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        const soloId = nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
        setToolbarNodeId(soloId);
        return { nextSelected, soloId };
    }, []);

    // Capture-phase selection lets any inner element, including textarea or iframe, select the node and show its toolbar.
    // It only selects; body onMouseDown still starts dragging, so text selection inside editors does not drag the node.
    // Cache the capture result for the following bubbling drag handler to avoid applying shift-selection twice.
    const pendingSelectionRef = useRef<Set<string> | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            if (event.button !== 0) return;
            setContextMenu(null);
            setHoveredNodeId(null);
            setSelectedConnectionId(null);
            const { nextSelected } = selectNodeByEvent(event, nodeId);
            pendingSelectionRef.current = nextSelected;
        },
        [selectNodeByEvent],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        // Capture already selected the node; this only starts dragging, with a fallback selection if capture did not run.
        const currentNodes = nodesRef.current;
        const nextSelected = pendingSelectionRef.current ?? selectNodeByEvent(event, nodeId).nextSelected;
        pendingSelectionRef.current = null;
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            if (node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        const initialSelectedNodes = new Map(currentNodes.filter((node) => dragIds.has(node.id)).map((node): [string, { x: number; y: number }] => [node.id, { x: node.position.x, y: node.position.y }]));
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes,
            movedIds: new Set(initialSelectedNodes.keys()),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.size === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes.keys().next().value;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;
        const movedIds = dragRef.current.movedIds;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = new Map();
        dragRef.current.movedIds = new Set();
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedDefinition?.hidePanel || clickedNode?.type === CanvasNodeType.Config) {
                // Clicking a config node selects it without expanding its composer below.
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
                if (useConfigStore.getState().config.autoFocusOnSelect) {
                    // Wait for the generation panel to render so centering accounts for it.
                    requestAnimationFrame(() => focusNodeRef.current(clickedNodeId));
                }
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;
            pointerClientRef.current = { x: event.clientX, y: event.clientY };

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                const movedIds = dragRef.current.movedIds;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                // Drop-target detection and node updates both run once per frame; mousemove can fire far more often than the display refreshes.
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    const previewNodes = nodesRef.current.map((node) => {
                        const initial = initialPositions.get(node.id);
                        return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                    });
                    setDropTargetGroupId(findGroupDropTarget(movedIds, previewNodes)?.id || null);
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositions.get(node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current.forEach((node) => {
                const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                if (intersects) nextSelected.add(node.id);
            });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        // Keep the image's own aspect ratio (no letterboxing) and just cap it at the default image card size,
        // so pasted/dropped nodes stay close to the surrounding cards without empty bars.
        const size = fitImageNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitImageNodeSize(video.width || 1280, video.height || 720);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, pasteDropPosition(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || t("canvas.projectPage.clipboardText"),
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [pasteDropPosition, t],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, pasteDropPosition());
            message.success(t("canvas.projectPage.clipboardImageAdded"));
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success(t("canvas.projectPage.clipboardTextAdded"));
    }, [createImageFileNode, createTextNodeFromClipboard, pasteDropPosition, message, t]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const isDeleteKey = event.key === "Delete" || event.key === "Backspace";
            const isVideoTarget = Boolean(target?.closest("[data-canvas-video]"));
            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            // Node duplication remains a canvas shortcut even when the prompt editor currently owns focus.
            // Preventing the browser default here also avoids opening its bookmark dialog.
            if (isModifierShortcut && !event.altKey && key === "d" && selectedNodeIdsRef.current.size) {
                event.preventDefault();
                duplicateSelectedNodes();
                return;
            }

            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement ||
                event.target instanceof HTMLSelectElement ||
                target?.closest("[contenteditable='true'],[data-canvas-shortcuts-ignore]") ||
                (!(isDeleteKey && isVideoTarget) && target?.closest("[data-canvas-no-zoom]"))
            )
                return;

            if (isModifierShortcut && key === "c" && window.getSelection()?.toString()) return;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "g") {
                if (event.shiftKey) {
                    if (canUngroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                        event.preventDefault();
                        ungroupSelection();
                    }
                    return;
                }
                if (canGroupSelectedNodes(selectedNodeIdsRef.current, nodesRef.current)) {
                    event.preventDefault();
                    groupSelection();
                }
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (isDeleteKey) {
                event.preventDefault();
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setPreviewNodeId(null);
                setPreviewImageId(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, duplicateSelectedNodes, groupSelection, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas, ungroupSelection]);

    // Holding WASD while dragging nodes or a connection pans the canvas every frame, so off-screen targets stay reachable.
    // Dragged nodes keep their place under the pointer; a dragged connection re-resolves its endpoint and drop target.
    useEffect(() => {
        const keys = new Set<string>();
        let frame: number | null = null;
        let lastTime = 0;
        const isDragging = () => dragRef.current.isDraggingNode || Boolean(connectingParamsRef.current && !pendingConnectionCreateRef.current);

        const pan = (offsetX: number, offsetY: number) => {
            const currentViewport = viewportRef.current;
            const nextViewport = { ...currentViewport, x: currentViewport.x + offsetX, y: currentViewport.y + offsetY };
            viewportRef.current = nextViewport;
            setViewport(nextViewport);

            if (dragRef.current.isDraggingNode) {
                const worldX = offsetX / currentViewport.k;
                const worldY = offsetY / currentViewport.k;
                const { initialSelectedNodes, movedIds } = dragRef.current;
                initialSelectedNodes.forEach((position, id) => initialSelectedNodes.set(id, { x: position.x - worldX, y: position.y - worldY }));
                dragRef.current.hasMoved = true;
                const shift = (node: CanvasNodeData) => (movedIds.has(node.id) ? { ...node, position: { x: node.position.x - worldX, y: node.position.y - worldY } } : node);
                setDropTargetGroupId(findGroupDropTarget(movedIds, nodesRef.current.map(shift))?.id || null);
                setNodes((prev) => prev.map(shift));
                return;
            }

            const connection = connectingParamsRef.current;
            const pointer = pointerClientRef.current;
            if (!connection || !pointer) return;
            setMouseWorld(screenToCanvas(pointer.x, pointer.y));
            const dropTarget = getConnectionDropTarget(pointer.x, pointer.y, connection);
            connectionTargetNodeIdRef.current = dropTarget.nodeId;
            setConnectionTargetNodeId(dropTarget.nodeId);
        };

        const step = (time: number) => {
            // Cap the frame delta so a stalled frame does not jump the canvas.
            const seconds = Math.min(Math.max(time - lastTime, 0), 50) / 1000;
            lastTime = time;
            if (!keys.size || !isDragging()) {
                frame = null;
                return;
            }
            const distance = KEY_PAN_SPEED * seconds;
            const offsetX = (Number(keys.has("KeyA")) - Number(keys.has("KeyD"))) * distance;
            const offsetY = (Number(keys.has("KeyW")) - Number(keys.has("KeyS"))) * distance;
            if (offsetX || offsetY) pan(offsetX, offsetY);
            frame = requestAnimationFrame(step);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!KEY_PAN_CODES.has(event.code) || event.metaKey || event.ctrlKey || event.altKey || !isDragging()) return;
            event.preventDefault();
            keys.add(event.code);
            if (frame !== null) return;
            lastTime = performance.now();
            frame = requestAnimationFrame(step);
        };
        const handleKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
        const handleBlur = () => keys.clear();

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [getConnectionDropTarget, screenToCanvas]);

    // Reveal a node's "+" handles when the pointer comes near its edges, not only when it is over the card.
    // One rAF-throttled listener for the whole canvas; it never swallows clicks the way a hit-test zone would.
    useEffect(() => {
        const PROXIMITY_WORLD_PX = 64;
        let frame: number | null = null;
        let pending: { x: number; y: number } | null = null;

        const resolve = () => {
            frame = null;
            if (!pending) return;
            const world = screenToCanvas(pending.x, pending.y);
            setMouseWorld(world);
            let nearestId: string | null = null;
            let nearestDistance = Number.POSITIVE_INFINITY;
            for (const node of nodesRef.current) {
                if (node.type === CanvasNodeType.Group) continue;
                const dx = Math.max(node.position.x - world.x, 0, world.x - (node.position.x + node.width));
                const dy = Math.max(node.position.y - world.y, 0, world.y - (node.position.y + node.height));
                const distance = Math.hypot(dx, dy);
                if (distance <= PROXIMITY_WORLD_PX && distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestId = node.id;
                }
            }
            setProximityNodeId((current) => (current === nearestId ? current : nearestId));
        };

        const onPointerMove = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-interaction-layer],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) {
                pending = null;
                setProximityNodeId(null);
                return;
            }
            pending = { x: event.clientX, y: event.clientY };
            if (frame === null) frame = requestAnimationFrame(resolve);
        };

        window.addEventListener("pointermove", onPointerMove, { passive: true });
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [screenToCanvas]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            pointerClientRef.current = { x: event.clientX, y: event.clientY };
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    // Dragging from the selection-box plus connects every selected node at once, like a group's source handle.
    const handleSelectionConnectStart = useCallback(
        (event: ReactMouseEvent) => {
            event.stopPropagation();
            const selectedNodes = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id));
            if (selectedNodes.length < 2) return;
            pointerClientRef.current = { x: event.clientX, y: event.clientY };
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId: selectedNodes[0].id, handleType: "source", sourceNodeIds: selectedNodes.map((node) => node.id) });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const handleNodeResizeStart = useCallback(() => {
        setIsNodeResizing(true);
    }, []);
    const handleNodeResizeEnd = useCallback(() => setIsNodeResizing(false), []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content, texts: node.metadata?.texts?.map((text) => (text.id === node.metadata?.primaryTextId ? { ...text, content } : text)) } } : node)));
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        setExpandedBatchNodeIds((current) => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    }, []);

    const setBatchPrimary = useCallback((nodeId: string, itemId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                if (node.type === CanvasNodeType.Text) {
                    const text = node.metadata?.texts?.find((item) => item.id === itemId);
                    return text?.content ? { ...node, metadata: { ...node.metadata, content: text.content, primaryTextId: text.id } } : node;
                }
                const image = node.metadata?.images?.find((item) => item.id === itemId);
                if (!image?.content) return node;
                const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitImageNodeSize(image.naturalWidth, image.naturalHeight, node.width * node.height);
                return {
                    ...node,
                    position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
                    ...size,
                    metadata: {
                        ...node.metadata,
                        content: image.content,
                        storageKey: image.storageKey,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        bytes: image.bytes,
                        mimeType: image.mimeType,
                        response: image.response,
                        primaryImageId: image.id,
                    },
                };
            }),
        );
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const downloadBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        saveAs(image.content, `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`);
    }, []);

    const captureVideoNodeFrame = useCallback(
        async (nodeId: string, position: VideoFramePosition) => {
            setContextMenu(null);
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const video = Array.from(containerRef.current!.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]")).find((item) => item.dataset.canvasVideo === nodeId);
            if (node?.type !== CanvasNodeType.Video || !node.metadata?.content || !video) return message.error(t("canvas.videoFrames.failed"));
            try {
                const image = await uploadImage(await captureVideoFrame(node.metadata.content, position, video.currentTime));
                const size = fitImageNodeSize(image.width, image.height);
                const id = nanoid();
                const x = node.position.x + node.width + 96;
                let y = node.position.y + node.height / 2 - size.height / 2;
                while (nodesRef.current.some((item) => item.id !== node.id && item.position.x < x + size.width && item.position.x + item.width > x && item.position.y < y + size.height && item.position.y + item.height > y)) y += size.height + 24;
                const child: CanvasNodeData = {
                    id,
                    type: CanvasNodeType.Image,
                    title: t(`canvas.videoFrames.${position}Title`, { name: node.title || t("assets.kinds.video") }),
                    position: { x, y },
                    ...size,
                    metadata: imageMetadata(image),
                };
                setNodes((prev) => [...prev, child]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: id }]);
                setSelectedNodeIds(new Set([id]));
                setSelectedConnectionId(null);
                setDialogNodeId(id);
                message.success(t("canvas.videoFrames.captured"));
            } catch {
                message.error(t("canvas.videoFrames.failed"));
            }
        },
        [message, t],
    );

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error(t("canvas.projectPage.noTextToSave"));
                await addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasText"), coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                return;
            }
            if (node.type === CanvasNodeType.Audio) {
                if (!node.metadata?.content) return message.error(t("canvas.projectPage.noAudioToSave"));
                await addAsset({
                    kind: "audio",
                    title: node.title || node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasAudio"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "audio/mpeg", durationMs: node.metadata.durationMs },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error(t("canvas.projectPage.noVideoToSave"));
                await addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasVideo"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                return;
            }
            if (!node.metadata?.content) return message.error(t("canvas.projectPage.noImageToSave"));
            const dataUrl = node.metadata.content;
            await addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasImage"),
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
        },
        [addAsset, message, t],
    );

    const setCanvasCover = useCallback(
        (node: CanvasNodeData) => {
            const primaryImage = node.metadata?.images?.find((image) => image.id === node.metadata?.primaryImageId) || node.metadata?.images?.[0];
            const storageKey = primaryImage?.storageKey || node.metadata?.storageKey;
            if (!storageKey) {
                message.warning(t("canvas.nodeToolbar.canvasCoverUnavailable"));
                return;
            }
            updateProject(projectId, { coverStorageKey: storageKey });
            message.success(t("canvas.nodeToolbar.canvasCoverSet"));
        },
        [message, projectId, t, updateProject],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas.projectPage.emptyReverse"));
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(
                    CanvasNodeType.Text,
                    { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY },
                    { content: t("canvas.projectPage.reversePreset"), prompt: t("canvas.projectPage.reversePreset"), status: NODE_STATUS_SUCCESS, fontSize: 14 },
                ),
                title: t("canvas.projectPage.reverseTitle"),
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: t("canvas.reverseComposer", { imageId: node.id, textId: textNode.id }),
                    },
                ),
                title: t("canvas.projectPage.reverseConfigTitle"),
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message, t],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const size = fitImageNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const saveEditedImageNode = useCallback(
        async (node: CanvasNodeData, blob: Blob, label?: string) => {
            const image = await uploadImage(blob);
            const size = fitImageNodeSize(image.width, image.height);
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: label || t("canvas.editors.editedImage"),
                position: findFreeChildPosition(nodesRef.current, node, size, { x: node.position.x + node.width + 96, y: node.position.y + node.height / 2 - size.height / 2 }),
                ...size,
                metadata: {
                    ...imageMetadata(image),
                    prompt: node.metadata?.prompt,
                },
            };
            setNodes((prev) => [...prev, child]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            setEditNodeId(null);
        },
        [t],
    );

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: t("canvas.projectPage.splitTitle", { name: node.title || t("assets.kinds.image"), row: piece.row + 1, column: piece.column + 1 }),
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(t("canvas.projectPage.splitSuccess", { count: childNodes.length }));
        },
        [message, t],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (payload.generate && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = t("canvas.projectPage.maskPrompt", { source: imageReferenceLabel(0), mask: imageReferenceLabel(1), prompt: userPrompt });
            setMaskEditNodeId(null);
            const maskImage = await uploadImage(payload.maskDataUrl);
            const maskNodeId = nanoid();
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const maskSource = { id: maskNodeId, name: "mask.png", type: maskImage.mimeType || "image/png", dataUrl: maskImage.url, storageKey: maskImage.storageKey };
            const references = [source, maskSource];
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, references);
            const childMetadata = payload.generate ? { prompt, status: NODE_STATUS_LOADING, startedAt: Date.now(), ...generationMetadata } : { prompt };
            setNodes((prev) => [
                ...prev,
                {
                    id: maskNodeId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.projectPage.maskNodeTitle"),
                    position: { x: node.position.x, y: node.position.y + node.height + 96 },
                    width: node.width,
                    height: node.height,
                    metadata: imageMetadata(maskImage),
                },
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.createMenu.image"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: childMetadata,
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }, { id: nanoid(), fromNodeId: maskNodeId, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            if (!payload.generate) return;
            setRunningNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, references, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                const size = fitImageNodeSize(uploaded.width, uploaded.height);
                setNodes((prev) =>
                    prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata, response: image.response } } : item)),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.maskFailed");
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitImageNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = t("canvas.createMenu.image");
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, startedAt: Date.now(), ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }], {
                    signal: controller.signal,
                }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                const size = fitImageNodeSize(uploaded.width, uploaded.height);
                setNodes((prev) =>
                    prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata, response: image.response } } : item)),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest, t],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files || []).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || isAudioFile(f));
            if (!files.length) {
                uploadTargetRef.current = null;
                event.target.value = "";
                return;
            }

            const target = uploadTargetRef.current;
            const basePosition = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const STAGGER = 40; // Offset between multiple imported files.

            // When replacing a target node, use the first file as the replacement and create the rest nearby.
            if (target?.nodeId) {
                const [first, ...rest] = files;

                // Replace the target node with the first file.
                if (isAudioFile(first)) {
                    const audio = await uploadMediaFile(first, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Audio,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                      width: spec.width,
                                      height: spec.height,
                                      metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else if (first.type.startsWith("video/")) {
                    const video = await uploadMediaFile(first, "video");
                    const nextSize = fitImageNodeSize(video.width || 1280, video.height || 720);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Video,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                      width: nextSize.width,
                                      height: nextSize.height,
                                      metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                } else {
                    const image = await uploadImage(first);
                    const s = fitImageNodeSize(image.width, image.height);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Image,
                                      title: first.name,
                                      position: { x: node.position.x + node.width / 2 - s.width / 2, y: node.position.y + node.height / 2 - s.height / 2 },
                                      width: s.width,
                                      height: s.height,
                                      metadata: {
                                          ...node.metadata,
                                          ...imageMetadata(image),
                                          errorDetails: undefined,
                                          freeResize: false,
                                          images: undefined,
                                          generationType: undefined,
                                          model: undefined,
                                          size: undefined,
                                          quality: undefined,
                                          count: undefined,
                                          references: undefined,
                                          primaryImageId: undefined,
                                          response: undefined,
                                      },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                }

                // Create the remaining files near the target node.
                for (let i = 0; i < rest.length; i++) {
                    const offsetPos = { x: basePosition.x + (i + 1) * STAGGER, y: basePosition.y + (i + 1) * STAGGER };
                    const f = rest[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            } else {
                // Without a replacement target, create all files near the canvas center.
                for (let i = 0; i < files.length; i++) {
                    const offsetPos = { x: basePosition.x + i * STAGGER, y: basePosition.y + i * STAGGER };
                    const f = files[i];
                    if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!files.length) return;

            const basePos = screenToCanvas(event.clientX, event.clientY);
            const STAGGER = 40;
            for (let i = 0; i < files.length; i++) {
                const pos = { x: basePos.x + i * STAGGER, y: basePos.y + i * STAGGER };
                const f = files[i];
                if (isAudioFile(f)) {
                    void createAudioFileNode(f, pos);
                } else if (f.type.startsWith("video/")) {
                    void createVideoFileNode(f, pos);
                } else {
                    void createImageFileNode(f, pos);
                }
            }
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || t("canvas.projectPage.untitledCanvas"));
        setTitleEditing(true);
    }, [currentProject?.title, t]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            // useBuiltinPanel.writeBackToSelf reuses built-in generation while writing the result back to the plugin node.
            // Image mode currently supports display-only nodes such as panoramas, with a useBuiltinPanel.promptPrefix.
            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, startedAt: Date.now(), errorDetails: undefined, response: undefined } } : node)));
                try {
                    const fullPrompt = (builtinPanel.promptPrefix || "") + scene;
                    const context = await hydrateNodeGenerationContext(buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, fullPrompt, { assets: useAssetStore.getState().assets }));
                    const refs = context.referenceImages;
                    const image = refs.length
                        ? await requestEdit({ ...generationConfig, count: "1" }, context.prompt, refs, { signal: controller.signal }).then((items) => items[0])
                        : await requestGeneration({ ...generationConfig, count: "1" }, context.prompt, { signal: controller.signal }).then((items) => items[0]);
                    const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, errorDetails: undefined, response: image.response } } : node,
                        ),
                    );
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error)) {
                        const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                        message.error(errorDetails);
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                } finally {
                    finishGenerationRequest(nodeId, controller);
                }
                return;
            }

            setRunningNodeId(nodeId);
            const overwriteExisting = effectiveConfig.nodeRegenerateBehavior === "overwrite";
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const contextPrompt = editingTextNode ? t("canvas.projectPage.editTextPrompt", { source: sourceTextContent, prompt }) : prompt;
            const libraryAssets = useAssetStore.getState().assets;
            const upstreamContext = buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, contextPrompt, { assets: libraryAssets });
            // Editing an existing image sends it as a reference too, unless it came from editing upstream images:
            // then it keeps editing those originals so its own last output does not replace the source.
            const preferUpstreamReferences = Boolean(sourceNode?.metadata?.generationType === "edit" && sourceNode?.metadata?.references?.length && upstreamContext.referenceImages.length);
            const includeSourceImage = mode === "image" && sourceNode?.type === CanvasNodeType.Image && Boolean(sourceNode.metadata?.content) && !overwriteExisting && !preferUpstreamReferences;
            const generationContext = await hydrateNodeGenerationContext(includeSourceImage ? buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, contextPrompt, { includeSourceImage, assets: libraryAssets }) : upstreamContext);
            const effectivePrompt = generationContext.prompt.trim();
            // Results keep the library assets they were generated with, so their reference bar can show them again.
            const resultAssetIds = assetIdsFromReferenceIds(generationContext.referenceNodeIds);
            // Keep only what the user typed in the prompt field; upstream text nodes are sent to the model
            // but must not be written back into the editable prompt.
            const displayPrompt = prompt
                .replace(/@\[node:[^\]]+\]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            const generationStartedAt = Date.now();
            if (markSourceStatus)
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...(node.type === CanvasNodeType.Config ? {} : { prompt }), status: NODE_STATUS_LOADING, startedAt: generationStartedAt, errorDetails: undefined } } : node,
                    ),
                );

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const reuseImageNode = isImageNode && (overwriteExisting || isEmptyImageNode);
                    const { referenceImages, referenceNodeIds } = generationContext;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    // While loading, size the placeholder to the requested ratio (e.g. 16:9) instead of the default 4:3 card.
                    const loadingSize = imageNodeSizeFromRatio(generationConfig.size) || imageConfig;
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const rootId = reuseImageNode ? nodeId : nanoid();
                    const imageIds = Array.from({ length: count }, () => nanoid());
                    pendingChildIds = [rootId];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: t("canvas.createMenu.image"),
                        position: reuseImageNode
                            ? parentPosition
                            : findFreeChildPosition(nodesRef.current, sourceNode, loadingSize, { x: parentPosition.x + parentConfig.width + 96, y: parentPosition.y + parentConfig.height / 2 - loadingSize.height / 2 }),
                        width: reuseImageNode ? sourceNode?.width || imageConfig.width : loadingSize.width,
                        height: reuseImageNode ? sourceNode?.height || imageConfig.height : loadingSize.height,
                        metadata: {
                            prompt: displayPrompt,
                            composerContent: prompt,
                            assetReferenceIds: resultAssetIds,
                            requestPrompt: effectivePrompt,
                            referenceNodeIds,
                            status: NODE_STATUS_LOADING,
                            startedAt: generationStartedAt,
                            images: imageIds.map((id) => ({ id, status: NODE_STATUS_LOADING, startedAt: generationStartedAt, content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" })),
                            primaryImageId: undefined,
                            response: undefined,
                            ...generationMetadata,
                        },
                    };

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, status: NODE_STATUS_LOADING, startedAt: generationStartedAt, errorDetails: undefined },
                                      }
                                    : reuseImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, content: undefined, storageKey: undefined, naturalWidth: undefined, naturalHeight: undefined, bytes: undefined, mimeType: undefined, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(reuseImageNode ? [] : [rootNode]),
                    ]);
                    if (!reuseImageNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]);
                    if (imageIds.length > 1) setExpandedBatchNodeIds((current) => new Set(current).add(rootId));
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                    let hasSuccess = false;
                    let hasFailure = false;
                    let firstError = "";
                    await Promise.all(
                        imageIds.map(async (imageId) => {
                            try {
                                const image = referenceImages.length
                                    ? await requestEdit({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages, { signal: controller.signal }).then((items) => items[0])
                                    : await requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt, { signal: controller.signal }).then((items) => items[0]);
                                const uploaded = await uploadImage(image.dataUrl, { signal: controller.signal });
                                const imageSize = fitImageNodeSize(uploaded.width, uploaded.height);
                                const item: CanvasNodeImage = {
                                    id: imageId,
                                    status: NODE_STATUS_SUCCESS,
                                    content: uploaded.url,
                                    storageKey: uploaded.storageKey,
                                    naturalWidth: uploaded.width,
                                    naturalHeight: uploaded.height,
                                    bytes: uploaded.bytes,
                                    mimeType: uploaded.mimeType,
                                    response: image.response,
                                };
                                setNodes((prev) =>
                                    prev.map((node) => {
                                        if (node.id !== rootId) return node;
                                        const images = node.metadata?.images?.map((image) => (image.id === imageId ? item : image)) || [];
                                        if (node.metadata?.primaryImageId) return { ...node, metadata: { ...node.metadata, images } };
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        return {
                                            ...node,
                                            position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                            ...imageSize,
                                            metadata: {
                                                ...node.metadata,
                                                content: item.content,
                                                storageKey: item.storageKey,
                                                naturalWidth: item.naturalWidth,
                                                naturalHeight: item.naturalHeight,
                                                bytes: item.bytes,
                                                mimeType: item.mimeType,
                                                response: item.response,
                                                images,
                                                primaryImageId: imageId,
                                            },
                                        };
                                    }),
                                );
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                                if (!firstError) firstError = errorDetails;
                                hasFailure = true;
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        node.id === rootId ? { ...node, metadata: { ...node.metadata, images: node.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)) } } : node,
                                    ),
                                );
                            }
                            return false;
                        }),
                    );
                    if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) {
                        message.error(hasSuccess ? t("canvas.projectPage.partialFailed") : firstError || t("canvas.projectPage.generationFailed"));
                    }
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : t("canvas.projectPage.generationFailed") } }
                                : node.id === rootId
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : t("canvas.projectPage.allFailed") } }
                                  : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const reuseVideoNode = sourceNode?.type === CanvasNodeType.Video && (overwriteExisting || isEmptyVideoNode);
                    const videoId = reuseVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: t("canvas.createMenu.video"),
                        position: reuseVideoNode ? sourceNode.position : findFreeChildPosition(nodesRef.current, sourceNode, spec, { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y }),
                        width: reuseVideoNode ? sourceNode.width : spec.width,
                        height: reuseVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: displayPrompt,
                            composerContent: prompt,
                            assetReferenceIds: resultAssetIds,
                            requestPrompt: effectivePrompt,
                            referenceNodeIds: generationContext.referenceNodeIds,
                            status: NODE_STATUS_LOADING,
                            startedAt: generationStartedAt,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                            references: generationReferenceUrls(generationContext),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        reuseVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!reuseVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        await completeVideoNodeTask(
                            videoId,
                            generationConfig,
                            effectivePrompt,
                            generationContext.referenceImages,
                            controller.signal,
                            {
                                size: generationConfig.size,
                                seconds: generationConfig.videoSeconds,
                                vquality: generationConfig.vquality,
                                generateAudio: generationConfig.videoGenerateAudio,
                                watermark: generationConfig.videoWatermark,
                                videoMode: generationConfig.videoMode,
                                references: generationReferenceUrls(generationContext),
                            },
                            generationContext.referenceVideos,
                            generationContext.referenceAudios,
                        );
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const reuseAudioNode = sourceNode?.type === CanvasNodeType.Audio && (overwriteExisting || isEmptyAudioNode);
                    const audioId = reuseAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: reuseAudioNode
                            ? sourceNode.position
                            : findFreeChildPosition(nodesRef.current, sourceNode, spec, { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 }),
                        width: reuseAudioNode ? sourceNode.width : spec.width,
                        height: reuseAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: displayPrompt, composerContent: prompt, assetReferenceIds: resultAssetIds, requestPrompt: effectivePrompt, referenceNodeIds: generationContext.referenceNodeIds, status: NODE_STATUS_LOADING, startedAt: generationStartedAt, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        reuseAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!reuseAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: displayPrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = getGenerationCount(String(sourceNode?.metadata?.textCount || 1));
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const isEmptyTextNode = sourceNode?.type === CanvasNodeType.Text && !sourceTextContent;
                const reuseTextNode = sourceNode?.type === CanvasNodeType.Text && (overwriteExisting || isEmptyTextNode);
                const rootId = reuseTextNode ? nodeId : nanoid();
                const textIds = Array.from({ length: textCount }, () => nanoid());
                const rootNode: CanvasNodeData = {
                    id: rootId,
                    type: CanvasNodeType.Text,
                    title: displayPrompt.slice(0, 32) || "Generated Text",
                    position: reuseTextNode ? sourceNode.position : findFreeChildPosition(nodesRef.current, sourceNode, textConfig, { x: parentPosition.x + parentConfig.width + 96, y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 }),
                    width: reuseTextNode ? sourceNode.width : textConfig.width,
                    height: reuseTextNode ? sourceNode.height : textConfig.height,
                    metadata: {
                        prompt: displayPrompt,
                        composerContent: prompt,
                        assetReferenceIds: resultAssetIds,
                        requestPrompt: effectivePrompt,
                        referenceNodeIds: generationContext.referenceNodeIds,
                        status: NODE_STATUS_LOADING,
                        startedAt: generationStartedAt,
                        fontSize: 14,
                        model: generationConfig.model,
                        reasoningEffort: generationConfig.reasoningEffort,
                        textCount,
                        texts: textIds.map((id) => ({ id, status: NODE_STATUS_LOADING, startedAt: generationStartedAt, content: "" })),
                        primaryTextId: textIds[0],
                    },
                };
                pendingChildIds = [rootId];
                setNodes((prev) =>
                    reuseTextNode
                        ? prev.map((node) => (node.id === nodeId ? { ...node, ...rootNode } : node))
                        : [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, startedAt: generationStartedAt, errorDetails: undefined } } : node)), rootNode],
                );
                if (!reuseTextNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]);
                if (textIds.length > 1) setExpandedBatchNodeIds((current) => new Set(current).add(rootId));
                setSelectedNodeIds(new Set([nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(nodeId);

                const controller = rootId === nodeId ? runController : startGenerationRequest(rootId, nodeId, nodeId, runController);
                const results = await Promise.all(
                    textIds.map(async (textId): Promise<CanvasNodeText | null> => {
                        let streamed = "";
                        try {
                            const answer = await requestImageQuestion(
                                generationConfig,
                                buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                                (text) => {
                                    streamed = text;
                                    setNodes((prev) =>
                                        prev.map((node) =>
                                            node.id === rootId
                                                ? {
                                                      ...node,
                                                      metadata: {
                                                          ...node.metadata,
                                                          ...(node.metadata?.primaryTextId === textId ? { content: text } : {}),
                                                          texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content: text } : item)),
                                                      },
                                                  }
                                                : node,
                                        ),
                                    );
                                },
                                { signal: controller.signal },
                            );
                            const content = answer || streamed;
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === rootId
                                        ? {
                                              ...node,
                                              metadata: {
                                                  ...node.metadata,
                                                  ...(node.metadata?.primaryTextId === textId ? { content } : {}),
                                                  texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, content, status: NODE_STATUS_SUCCESS } : item)),
                                              },
                                          }
                                        : node,
                                ),
                            );
                            return { id: textId, status: NODE_STATUS_SUCCESS, content } satisfies CanvasNodeText;
                        } catch (error) {
                            if (isGenerationCanceled(error)) return null;
                            const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                            setNodes((prev) =>
                                prev.map((node) => (node.id === rootId ? { ...node, metadata: { ...node.metadata, texts: node.metadata?.texts?.map((item) => (item.id === textId ? { ...item, status: NODE_STATUS_ERROR, errorDetails } : item)) } } : node)),
                            );
                            return { id: textId, status: NODE_STATUS_ERROR, content: "", errorDetails } satisfies CanvasNodeText;
                        }
                    }),
                );
                if (rootId !== nodeId) finishGenerationRequest(rootId, controller);
                if (controller.signal.aborted) return;
                const completedTexts = results.flatMap((item) => (item?.status === NODE_STATUS_SUCCESS ? [item] : []));
                const failedTexts = results.filter((item) => item?.status === NODE_STATUS_ERROR);
                const firstText = completedTexts[0];
                if (completedTexts.length <= 1) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== rootId)));
                if (failedTexts.length) message.error(firstText ? t("canvas.projectPage.partialTextFailed") : failedTexts[0]?.errorDetails || t("canvas.projectPage.generationFailed"));
                setNodes((prev) =>
                    prev.map((node) => {
                        if (node.id === rootId) {
                            const primaryText = completedTexts.find((text) => text.id === node.metadata?.primaryTextId) || firstText;
                            return {
                                ...node,
                                metadata: {
                                    ...node.metadata,
                                    content: primaryText?.content || "",
                                    texts: completedTexts,
                                    primaryTextId: primaryText?.id,
                                    status: primaryText ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                    errorDetails: primaryText ? undefined : t("canvas.projectPage.generationFailed"),
                                },
                            };
                        }
                        return node.id === nodeId && isConfigNode
                            ? { ...node, metadata: { ...node.metadata, status: firstText ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: firstText ? undefined : t("canvas.projectPage.generationFailed") } }
                            : node;
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId || pendingChildIds.includes(node.id)
                            ? node.id === nodeId && !markSourceStatus
                                ? node
                                : {
                                      ...node,
                                      metadata: {
                                          ...node.metadata,
                                          status: NODE_STATUS_ERROR,
                                          errorDetails,
                                          ...(isVideoTaskFailed(error) && node.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                      },
                                  }
                            : node,
                    ),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, t],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, imageId?: string) => {
            if (hasResumableVideoTask(node)) {
                await pollVideoNodeTask(node);
                return;
            }
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? node.metadata : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          background: savedImageMetadata.background ?? effectiveConfig.background,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || "", { assets: useAssetStore.getState().assets }));
            const prompt = (savedImageMetadata?.requestPrompt || savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.retryPromptMissing"));
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error(t("canvas.projectPage.referenceMissing"));
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : t("canvas.projectPage.referenceMissing"),
                                      images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("canvas.projectPage.referenceMissing") } : image)),
                                  },
                              }
                            : item,
                    ),
                );
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            const retryStartedAt = Date.now();
            setNodes((prev) =>
                prev.map((item) =>
                    item.id === node.id
                        ? {
                              ...item,
                              metadata: {
                                  ...item.metadata,
                                  status: NODE_STATUS_LOADING,
                                  startedAt: retryStartedAt,
                                  errorDetails: undefined,
                                  images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_LOADING, startedAt: retryStartedAt, errorDetails: undefined } : image)),
                              },
                          }
                        : item,
                ),
            );
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        },
                        { signal: controller.signal },
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    await completeVideoNodeTask(
                        node.id,
                        generationConfig,
                        prompt,
                        retryImages,
                        controller.signal,
                        {
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                        },
                        context?.referenceVideos || [],
                        context?.referenceAudios || [],
                    );
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages
                    ? await requestEdit(generationConfig, prompt, retryImages, { signal: controller.signal }).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl, { signal: controller.signal });
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const retryImage: CanvasNodeImage = {
                    id: imageId || node.metadata?.primaryImageId || nanoid(),
                    status: NODE_STATUS_SUCCESS,
                    content: uploadedImage.url,
                    storageKey: uploadedImage.storageKey,
                    naturalWidth: uploadedImage.width,
                    naturalHeight: uploadedImage.height,
                    bytes: uploadedImage.bytes,
                    mimeType: uploadedImage.mimeType,
                    response: image.response,
                };
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          quality: generationConfig.quality,
                          ...(generationConfig.background ? { background: generationConfig.background } : {}),
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const makePrimary = !imageId || !item.metadata?.content;
                        const imageSize =
                            imageId && item.metadata?.freeResize
                                ? { width: item.width, height: item.height }
                                : imageId
                                  ? fitImageNodeSize(uploadedImage.width, uploadedImage.height, item.width * item.height)
                                  : fitImageNodeSize(uploadedImage.width, uploadedImage.height);
                        return {
                            ...item,
                            type: CanvasNodeType.Image,
                            ...(makePrimary
                                ? { width: imageSize.width, height: imageSize.height, ...(imageId ? { position: { x: item.position.x + item.width / 2 - imageSize.width / 2, y: item.position.y + item.height / 2 - imageSize.height / 2 } } : {}) }
                                : {}),
                            metadata: {
                                ...item.metadata,
                                ...(makePrimary ? imageMetadata(uploadedImage) : { status: NODE_STATUS_SUCCESS }),
                                ...(makePrimary ? { response: retryImage.response } : {}),
                                images: item.metadata?.images?.map((current) => (current.id === retryImage.id ? retryImage : current)),
                                primaryImageId: makePrimary ? retryImage.id : item.metadata?.primaryImageId,
                                prompt,
                                ...generationMetadata,
                            },
                        };
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                                      errorDetails: item.metadata?.content ? undefined : errorDetails,
                                      images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)),
                                      ...(isVideoTaskFailed(error) && item.type === CanvasNodeType.Video ? { videoTaskId: undefined } : {}),
                                  },
                              }
                            : item,
                    ),
                );
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [completeVideoNodeTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, pollVideoNodeTask, startGenerationRequest, t],
    );

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const remaining = node?.metadata?.images?.filter((image) => image.id !== imageId) || [];
        // Keep the batch open while two or more results are left; only a single image has nothing to fan out.
        if (remaining.length < 2) setExpandedBatchNodeIds((current) => new Set([...current].filter((id) => id !== nodeId)));
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId) return item;
                if (!remaining.length) {
                    // Every result was removed: fall back to an empty image node.
                    return {
                        ...item,
                        metadata: {
                            ...item.metadata,
                            images: undefined,
                            primaryImageId: undefined,
                            count: 1,
                            content: undefined,
                            storageKey: undefined,
                            naturalWidth: undefined,
                            naturalHeight: undefined,
                            bytes: undefined,
                            mimeType: undefined,
                            response: undefined,
                            status: NODE_STATUS_IDLE,
                            errorDetails: undefined,
                        },
                    };
                }
                if (remaining.length === 1) {
                    // Back to a plain single-image node: promote the only remaining image and refit the card to it.
                    const image = remaining[0];
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const size = fitImageNodeSize(image.naturalWidth || item.width, image.naturalHeight || item.height);
                    const center = { x: item.position.x + item.width / 2, y: item.position.y + item.height / 2 };
                    return {
                        ...item,
                        position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
                        width: size.width,
                        height: size.height,
                        metadata: {
                            ...item.metadata,
                            content: image.content,
                            storageKey: image.storageKey,
                            naturalWidth: image.naturalWidth,
                            naturalHeight: image.naturalHeight,
                            bytes: image.bytes,
                            mimeType: image.mimeType,
                            response: image.response,
                            images: undefined,
                            primaryImageId: undefined,
                            count: 1,
                            status: NODE_STATUS_SUCCESS,
                            errorDetails: undefined,
                        },
                    };
                }
                return { ...item, metadata: { ...item.metadata, images: remaining, count: remaining.length, primaryImageId: item.metadata?.primaryImageId === imageId ? remaining[0]?.id : item.metadata?.primaryImageId } };
            }),
        );
    }, []);

    const retryBatchImage = useCallback((node: CanvasNodeData, imageId: string) => void handleRetryNode(node, imageId), [handleRetryNode]);

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.emptyTextImage"));
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, t],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            await ensureImagePreview(storedImage.storageKey);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitImageNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: t("canvas.createMenu.image"),
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width, t],
    );

    const insertAssistantText = useCallback(
        (text: string, title?: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: title || text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content, payload.title);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitImageNodeSize(payload.width || spec.width, payload.height || spec.height);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else if (payload.kind === "audio") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Audio,
                        title: payload.title,
                        position: { x: center.x - spec.width / 2, y: center.y - spec.height / 2 },
                        width: spec.width,
                        height: spec.height,
                        metadata: audioMetadata({ url: payload.url, storageKey: payload.storageKey || "", bytes: payload.bytes || 0, mimeType: payload.mimeType || "audio/mpeg", durationMs: payload.durationMs }),
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    // Memoize every callback and render function passed to CanvasNode.
    // CanvasNode uses React.memo, but new prop references would invalidate it on every render and rerender every node
    // during click, hover, or viewport changes, which is especially expensive for Markdown. These useCallback values
    // and their memoized map/handler dependencies remain stable during interaction, so unchanged nodes do not rerender.
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData, imageId?: string) => {
        setPreviewNodeId(node.id);
        setPreviewImageId(imageId || null);
    }, []);
    const handleNodeRetry = useCallback(
        (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text && (node.metadata?.textCount || 1) > 1) {
                void generateNodeRef.current?.(node.id, "text", node.metadata?.prompt || "");
                return;
            }
            void handleRetryNode(node);
        },
        [handleRetryNode],
    );
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    }, []);

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    nodeId={panelNode.id}
                    nodes={nodes}
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                    onDisconnectReference={disconnectNodeReference}
                    onAssetReferencesChange={(nodeId, assetReferenceIds) => handleConfigNodeChange(nodeId, { assetReferenceIds })}
                />
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    nodes={nodes}
                    isRunning={runningNodeId === panelNode.id}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    onDisconnectReference={disconnectNodeReference}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            ),
        [
            configInputsById,
            confirmStopGeneration,
            connectedNodesByNodeId,
            disconnectNodeReference,
            handleConfigNodeChange,
            handleGenerateNode,
            handleNodePromptChange,
            mentionReferencesByNodeId,
            nodes,
            renderPluginPanel,
            runningNodeId,
        ],
    );

    const renderNodeContentPanel = useCallback(
        (contentNode: CanvasNodeData) => (
            <CanvasConfigNodePanel
                node={contentNode}
                isRunning={runningNodeId === contentNode.id}
                inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                onConfigChange={handleConfigNodeChange}
                onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                onStop={confirmStopGeneration}
                onGenerate={(nodeId) => {
                    const target = nodesRef.current.find((item) => item.id === nodeId);
                    void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                }}
            />
        ),
        [configInputsById, confirmStopGeneration, handleConfigNodeChange, handleGenerateNode, runningNodeId],
    );

    const hoverPreviewNode = hoverPreviewNodeId ? nodeById.get(hoverPreviewNodeId) || null : null;
    const hoverPreviewMedia =
        hoverPreviewNode && (hoverPreviewNode.type === CanvasNodeType.Image || hoverPreviewNode.type === CanvasNodeType.Video) && hoverPreviewNode.metadata?.content
            ? {
                  video: hoverPreviewNode.type === CanvasNodeType.Video,
                  src: hoverPreviewNode.metadata.content,
                  width: hoverPreviewNode.metadata.naturalWidth || hoverPreviewNode.width,
                  height: hoverPreviewNode.metadata.naturalHeight || hoverPreviewNode.height,
              }
            : null;
    const showHoverPreview = Boolean(hoverPreviewMedia);
    const retainedPreviewRef = useRef<{ video: boolean; src: string; title: string; width: number; height: number } | null>(null);
    // Written during render on purpose: the overlay stays mounted while it fades out, so the last preview has to be
    // retained after the hovered node clears. Sizing reuses the measured container size instead of reading layout here.
    if (hoverPreviewMedia) {
        const previewSize = fitNodeSize(hoverPreviewMedia.width, hoverPreviewMedia.height, size.width * 0.9, size.height * 0.9);
        retainedPreviewRef.current = { video: hoverPreviewMedia.video, src: hoverPreviewMedia.src, title: hoverPreviewNode?.title || "", width: previewSize.width, height: previewSize.height };
    }
    const retainedPreview = retainedPreviewRef.current;

    if (!projectLoaded || !assetsHydrated) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={focusNode} onPreviewNode={setPreviewNodeId} onHoverNode={setHoverPreviewNodeId} onInsertAsset={handleAssetInsert} />
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || t("canvas.projectPage.untitledCanvas")}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => navigate("/")}
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onExportProject={exportCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                    onToggleAgent={toggleAgentPanel}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    tool={canvasTool}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onCanvasDoubleClick={(event) => {
                        setContextMenu(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {visibleConnections.map(({ connection, from, to }) => (
                            <ConnectionPath
                                key={connection.id}
                                connection={connection}
                                from={from}
                                to={to}
                                active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                selected={selectedConnectionId === connection.id}
                                scale={viewport.k}
                                onSelect={() => {
                                    setSelectedConnectionId(connection.id);
                                    setSelectedNodeIds(new Set());
                                    setContextMenu(null);
                                }}
                                onDelete={() => deleteConnection(connection.id)}
                                onContextMenu={(event) => {
                                    setSelectedConnectionId(connection.id);
                                    setSelectedNodeIds(new Set());
                                    setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                }}
                            />
                        ))}
                        {connectingParams
                            ? (connectingParams.sourceNodeIds || [connectingParams.nodeId]).map((sourceId) => (
                                  <ActiveConnectionPath
                                      key={sourceId}
                                      node={nodeById.get(sourceId)}
                                      handle={{ nodeId: sourceId, handleType: connectingParams.handleType }}
                                      mouseWorld={mouseWorld}
                                      target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined}
                                  />
                              ))
                            : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            hasIncomingConnection={nodeIdsWithIncoming.has(node.id)}
                            isPointerNear={proximityNodeId === node.id}
                            // Groups never win proximity, but their handle still follows the pointer vertically while visible.
                            pointerWorldY={proximityNodeId === node.id || node.type === CanvasNodeType.Group ? mouseWorld.y : undefined}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            showPanel={!isNodeResizing && dialogNodeId === node.id && !selectionBox && !getNodeDefinition(node.type)?.hidePanel}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={expandedBatchNodeIds.has(node.id)}
                            showImageInfo={showImageInfo}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
                            pluginHost={pluginHost}
                            registryVersion={nodeRegistryVersion}
                            renderPanel={renderNodePanel}
                            renderNodeContent={renderNodeContentPanel}
                            onMouseDown={handleNodeMouseDown}
                            onSelectCapture={handleNodeSelectCapture}
                            onHoverStart={handleNodeHoverStart}
                            onHoverEnd={handleNodeHoverEnd}
                            onConnectStart={handleConnectStart}
                            onResizeStart={handleNodeResizeStart}
                            onResize={handleNodeResize}
                            onResizeEnd={handleNodeResizeEnd}
                            onContentChange={handleNodeContentChange}
                            onTitleChange={handleNodeTitleChange}
                            onTitleEditingChange={(nodeId, editing) => setEditingNodeTitleId(editing ? nodeId : (current) => (current === nodeId ? null : current))}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onDownloadBatchImage={downloadBatchImage}
                            onRetryBatchImage={retryBatchImage}
                            onDeleteBatchImage={deleteBatchImage}
                            onRetry={handleNodeRetry}
                            onViewImage={handleNodeViewImage}
                            onContextMenu={handleNodeContextMenu}
                        />
                    ))}

                    {selectionBox ? (
                        <svg
                            className="pointer-events-none absolute z-[100] overflow-visible"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                            }}
                        >
                            <rect width="100%" height="100%" fill={theme.canvas.selectionFill} stroke={theme.canvas.selectionStroke} strokeOpacity={0.55} strokeWidth={1 / viewport.k} strokeDasharray={`${6 / viewport.k} ${4 / viewport.k}`} />
                        </svg>
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} scale={viewport.k} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            scale={viewport.k}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                <div
                    className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center transition-opacity duration-200 ease-out"
                    style={{ background: `color-mix(in srgb, ${theme.canvas.background} 76%, transparent)`, opacity: showHoverPreview ? 1 : 0 }}
                >
                    <div
                        className="flex flex-col overflow-hidden rounded-2xl border transition-transform duration-200 ease-out"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: "0 24px 60px rgba(0,0,0,.32)", transform: showHoverPreview ? "scale(1)" : "scale(0.95)" }}
                    >
                        {retainedPreview ? (
                            <>
                                <div className="max-w-full truncate px-3.5 py-2 text-sm font-medium" style={{ color: theme.node.text }}>
                                    {retainedPreview.title || t(retainedPreview.video ? "assets.kinds.video" : "assets.kinds.image")}
                                </div>
                                <div className="overflow-hidden" style={{ width: retainedPreview.width, height: retainedPreview.height }}>
                                    {retainedPreview.video ? (
                                        <video src={retainedPreview.src} muted playsInline preload="metadata" className="size-full object-contain" />
                                    ) : (
                                        <img src={retainedPreview.src} alt={retainedPreview.title} className="size-full object-contain" />
                                    )}
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || isNodeResizing || nodeImageSettingsOpen || editingNodeTitleId === toolbarNode?.id ? null : toolbarNode}
                    viewport={viewport}
                    batchExpanded={expandedBatchNodeIds.has(toolbarNode?.id || "")}
                    extraTools={toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onSetCanvasCover={setCanvasCover}
                    onEditImage={(node) => setEditNodeId(node.id)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={handleNodeViewImage}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                    onAddToCompare={(node) => handleAddToCompare(node)}
                    compareActive={Boolean(
                        toolbarNode?.metadata?.storageKey
                            ? compareItems.some((item) => item.storageKey === toolbarNode.metadata?.storageKey)
                            : toolbarNode?.metadata?.content && compareItems.some((item) => item.src === toolbarNode.metadata?.content),
                    )}
                    onOrganize={() => organizeSelection()}
                    onUngroup={(node) => ungroupSelection(new Set([node.id]))}
                />

                {hasMultipleSelectedNodes && !selectionBox ? (
                    <CanvasSelectionToolbar
                        nodes={selectedNodes}
                        viewport={viewport}
                        showToolbar={!isNodeDragging && !isNodeResizing}
                        canGroup={canGroupSelection}
                        canUngroup={canUngroupSelection}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                        onOrganize={organizeSelection}
                        onConnectDragStart={handleSelectionConnectStart}
                    />
                ) : null}

                <CanvasToolbar
                    canvasTool={canvasTool}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onAddGroup={() => createNode(CanvasNodeType.Group)}
                    onAddExtensionNode={(type) => createNode(type)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onCanvasToolChange={setCanvasTool}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls
                    isMiniMapOpen={isMiniMapOpen}
                    onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}
                    onOpenCompare={() => setCompareOpen(true)}
                    compareCount={compareItemCount}
                />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        canCaptureVideoFrame={contextMenuNode?.type === CanvasNodeType.Video && Boolean(contextMenuNode.metadata?.content)}
                        canGroup={contextMenu.type === "node" && canGroupSelection}
                        canUngroup={contextMenu.type === "node" && canUngroupSelection}
                        onClose={() => setContextMenu(null)}
                        onCaptureVideoFrame={(position) => {
                            if (contextMenu.type !== "node") return;
                            void captureVideoNodeFrame(contextMenu.nodeId, position);
                        }}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" multiple accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />
                <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />

                {editNode?.metadata?.content ? (
                    <Suspense fallback={null}>
                        <CanvasImageEditor dataUrl={editNode.metadata.content} title={editNode.title || t("assets.kinds.image")} open onClose={() => setEditNodeId(null)} onSave={(blob, label) => saveEditedImageNode(editNode, blob, label)} />
                    </Suspense>
                ) : null}

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                <Modal title={t("canvas.projectPage.superResolve")} open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">{t("canvas.projectPage.notImplemented")}</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <CanvasImageLightbox
                    src={previewContent || ""}
                    title={previewNode?.title || t("assets.kinds.image")}
                    open={Boolean(previewContent)}
                    images={previewImages}
                    index={previewIndex < 0 ? 0 : previewIndex}
                    onIndexChange={(index) => setPreviewImageId(previewImages[index]?.id ?? null)}
                    onClose={() => {
                        setPreviewNodeId(null);
                        setPreviewImageId(null);
                    }}
                />

                <CanvasImageCompare open={compareOpen} onClose={() => setCompareOpen(false)} />

                <AssetPickerModal open={assetPickerOpen} onSelect={(asset) => handleAssetInsert(assetToInsertPayload(asset))} onClose={() => setAssetPickerOpen(false)} />
            </section>
        </main>
    );
}
