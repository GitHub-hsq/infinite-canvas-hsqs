import type { AiTextMessage } from "@/services/api/image";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { ASSET_REFERENCE_PREFIX, getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";

export type NodeGenerationContext = {
    prompt: string;
    /** The user-authored prompt without upstream text blocks appended; safe to store back on the node. */
    basePrompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    referenceNodeIds: string[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

type NodeGenerationResourceInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

type NodeGenerationGroupInput = {
    nodeId: string;
    type: "group";
    title: string;
    children: NodeGenerationResourceInput[];
};

export type NodeGenerationInput = NodeGenerationResourceInput | NodeGenerationGroupInput;

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, options: { includeSourceImage?: boolean; assets?: Asset[] } = {}): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections, options.assets);
    // Editing an existing image keeps that image as a labelled reference, so mentions and labels stay aligned with the request.
    const sourceNode = options.includeSourceImage ? nodes.find((node) => node.id === nodeId) : undefined;
    const sourceImage = sourceNode ? readNodeGenerationResource(sourceNode).filter((input) => input.type === "image") : [];
    const resources = flattenGenerationInputs([...sourceImage, ...inputs]);
    // A mention may point at a group (all of its children) or directly at a single resource, including a group child.
    const resourcesById = new Map(resources.map((input) => [input.nodeId, [input]]));
    inputs.forEach((input) => {
        if (input.type === "group") resourcesById.set(input.nodeId, input.children);
    });
    const ordered: NodeGenerationResourceInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    const register = (input: NodeGenerationResourceInput) => {
        if (labelByNodeId.has(input.nodeId)) return;
        labelByNodeId.set(input.nodeId, generationLabel(input.type, counts[input.type]++));
        ordered.push(input);
    };

    // Prompts store references as stable `@[node:<id>]` tokens. Referenced text is inlined at its mention,
    // media becomes a sequential label; mentions are numbered first, in the order they appear.
    const body = prompt.replace(/@\[node:([^\]]+)\]/g, (_, id: string) => {
        const matched = resourcesById.get(id) || [];
        matched.forEach(register);
        return matched.map((input) => (input.type === "text" ? input.text || "" : labelByNodeId.get(input.nodeId))).join("、");
    });
    const mentionedIds = new Set(labelByNodeId.keys());
    // Connected references that were not mentioned are still sent, after the mentioned ones; their text goes before the prompt.
    resources.forEach(register);
    const unmentionedText = ordered.filter((input) => input.type === "text" && !mentionedIds.has(input.nodeId)).map((input) => input.text || "");
    const referenceImages = ordered.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = ordered.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = ordered.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: [...unmentionedText, body.trim()].filter((text) => text.trim()).join("\n\n"),
        basePrompt: body,
        referenceImages,
        referenceVideos,
        referenceAudios,
        referenceNodeIds: ordered.map((input) => input.nodeId),
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], assets: Asset[] = []): NodeGenerationInput[] {
    const nodeInputs = getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        if (node.type === CanvasNodeType.Group) {
            const children = getGroupResourceNodes(node.id, nodes).flatMap(readNodeGenerationResource);
            return children.length ? [{ nodeId: node.id, type: "group", title: node.title, children }] : [];
        }
        return readNodeGenerationResource(node);
    });
    // Library assets picked into the reference bar follow the connected nodes; deleted assets drop out.
    const assetIds = nodes.find((node) => node.id === nodeId)?.metadata?.assetReferenceIds || [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return [...nodeInputs, ...assetIds.flatMap((id) => (assetById.has(id) ? [readAssetGenerationResource(assetById.get(id)!)] : []))];
}

function readAssetGenerationResource(asset: Asset): NodeGenerationResourceInput {
    const nodeId = `${ASSET_REFERENCE_PREFIX}${asset.id}`;
    if (asset.kind === "text") return { nodeId, type: "text", title: asset.title, text: asset.data.content };
    if (asset.kind === "video") return { nodeId, type: "video", title: asset.title, video: { id: nodeId, name: asset.title, type: asset.data.mimeType || "video/mp4", url: asset.data.url, storageKey: asset.data.storageKey, bytes: asset.data.bytes, width: asset.data.width, height: asset.data.height } };
    if (asset.kind === "audio") return { nodeId, type: "audio", title: asset.title, audio: { id: nodeId, name: asset.title, type: asset.data.mimeType || "audio/mpeg", url: asset.data.url, storageKey: asset.data.storageKey, durationMs: asset.data.durationMs } };
    return { nodeId, type: "image", title: asset.title, image: { id: nodeId, name: asset.title, type: asset.data.mimeType || "image/png", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey } };
}

function flattenGenerationInputs(inputs: NodeGenerationInput[]) {
    const resources = inputs.flatMap((input) => (input.type === "group" ? input.children : [input]));
    return [...new Map(resources.map((input) => [input.nodeId, input])).values()];
}

function readNodeGenerationResource(node: CanvasNodeData): NodeGenerationResourceInput[] {
    const image = readReferenceImage(node);
    if (image) return [{ nodeId: node.id, type: "image", title: node.title, image }];
    const video = readReferenceVideo(node);
    if (video) return [{ nodeId: node.id, type: "video", title: node.title, video }];
    const audio = readReferenceAudio(node);
    if (audio) return [{ nodeId: node.id, type: "audio", title: node.title, audio }];
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if (resource?.kind === "image" && resource.url) return [{ nodeId: node.id, type: "image", title: node.title, image: { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata?.mimeType || "image/png", dataUrl: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "video" && resource.url) return [{ nodeId: node.id, type: "video", title: node.title, video: { id: node.id, name: `${node.title || node.id}.mp4`, type: node.metadata?.mimeType || "video/mp4", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "audio" && resource.url) return [{ nodeId: node.id, type: "audio", title: node.title, audio: { id: node.id, name: `${node.title || node.id}.mp3`, type: node.metadata?.mimeType || "audio/mpeg", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "text" && resource.text) return [{ nodeId: node.id, type: "text", title: node.title, text: resource.text }];
    const text = readNodeTextInput(node);
    return text ? [{ nodeId: node.id, type: "text", title: node.title, text }] : [];
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationResourceInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (type === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
