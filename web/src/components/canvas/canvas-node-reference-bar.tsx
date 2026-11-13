import { FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { Popover } from "antd";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { assetMediaUrl } from "@/lib/asset-library";
import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { assetCoverUrl, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type ReferenceKind = "image" | "video" | "audio" | "text" | "other";
type ReferenceView = { kind: ReferenceKind; title: string; thumbnail?: string; content?: string; text?: string };

// Reference bar above a prompt: connected canvas nodes first, then "我的资产" items picked with the + button.
// Picked assets are stored on the node as `assetReferenceIds`; they are not placed on the canvas.
export function CanvasNodeReferenceBar({
    nodeId,
    nodes,
    connectedNodes,
    onDisconnect,
    onAssetReferencesChange,
}: {
    nodeId: string;
    nodes: CanvasNodeData[];
    connectedNodes: CanvasNodeData[];
    onDisconnect?: (fromNodeId: string, toNodeId: string) => void;
    onAssetReferencesChange?: (nodeId: string, assetReferenceIds: string[]) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const assets = useAssetStore((state) => state.assets);
    const [pickerOpen, setPickerOpen] = useState(false);
    const references = connectedNodes.flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })));
    const assetIds = nodes.find((node) => node.id === nodeId)?.metadata?.assetReferenceIds || [];
    const attachedAssets = assetIds.flatMap((id) => assets.filter((asset) => asset.id === id));
    return (
        <div className="mb-1.5">
            <div className="flex min-h-12 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {references.map(({ node, sourceNodeId }) => (
                    <ReferenceItem key={`${sourceNodeId}:${node.id}`} reference={nodeReferenceView(node)} removeLabel={t("canvas.references.disconnect")} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} />
                ))}
                {attachedAssets.map((asset) => (
                    <ReferenceItem key={`asset:${asset.id}`} reference={assetReferenceView(asset)} removeLabel={t("canvas.references.removeAsset")} onRemove={() => onAssetReferencesChange?.(nodeId, assetIds.filter((id) => id !== asset.id))} />
                ))}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} title={t("canvas.references.select")} onClick={() => setPickerOpen(true)}>
                    <Plus className="size-4" />
                </button>
            </div>
            <AssetPickerModal
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSelect={(asset) => {
                    if (!assetIds.includes(asset.id)) onAssetReferencesChange?.(nodeId, [...assetIds, asset.id]);
                    setPickerOpen(false);
                }}
            />
        </div>
    );
}

function nodeReferenceView(node: CanvasNodeData): ReferenceView {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const kind: ReferenceKind =
        resource?.kind === "image" || node.type === CanvasNodeType.Image
            ? "image"
            : resource?.kind === "video" || node.type === CanvasNodeType.Video
              ? "video"
              : resource?.kind === "audio" || node.type === CanvasNodeType.Audio
                ? "audio"
                : resource?.kind === "text" || node.type === CanvasNodeType.Text
                  ? "text"
                  : "other";
    return { kind, title: node.title, content, thumbnail: previewUrlFor(node.metadata?.storageKey) || content, text: resource?.text || node.metadata?.content || node.metadata?.prompt || node.title };
}

function assetReferenceView(asset: Asset): ReferenceView {
    return { kind: asset.kind, title: asset.title, content: assetMediaUrl(asset), thumbnail: assetCoverUrl(asset) || assetMediaUrl(asset), text: asset.kind === "text" ? asset.data.content : asset.title };
}

function ReferenceItem({ reference, removeLabel, onRemove }: { reference: ReferenceView; removeLabel: string; onRemove: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const Icon = reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Video : reference.kind === "audio" ? Music2 : reference.kind === "text" ? FileText : Puzzle;
    return (
        <Popover
            placement="top"
            arrow={false}
            mouseEnterDelay={0.15}
            styles={{ container: { minWidth: 0, padding: 0, overflow: "hidden", background: "transparent", boxShadow: "none" }, content: { padding: 0 } }}
            content={<ReferencePreview reference={reference} />}
        >
            <div className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: "transparent", borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {reference.kind === "image" && reference.thumbnail ? (
                        <img src={reference.thumbnail} alt="" className="size-full object-cover" />
                    ) : reference.kind === "video" && reference.content ? (
                        <video src={reference.content} className="size-full object-cover" muted />
                    ) : (
                        <Icon className="size-4 opacity-65" />
                    )}
                </span>
                <button
                    type="button"
                    className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                    aria-label={removeLabel}
                    title={removeLabel}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove();
                    }}
                >
                    <X className="size-3" />
                </button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ reference }: { reference: ReferenceView }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (reference.kind === "image" && reference.content) return <img src={reference.content} alt={reference.title} className="block max-h-52 max-w-72 rounded-lg object-contain" />;
    if (reference.kind === "video" && reference.content) return <video src={reference.content} className="block max-h-52 max-w-72 rounded-lg" muted controls />;
    if (reference.kind === "audio" && reference.content) return <audio src={reference.content} className="w-72" controls />;
    return (
        <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
            {reference.text || t("canvas.references.empty")}
        </div>
    );
}
