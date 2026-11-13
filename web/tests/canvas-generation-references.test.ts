import { afterAll, expect, test } from "bun:test";
import type { CanvasConnection, CanvasNodeData } from "../src/types/canvas";
import type { Asset } from "../src/stores/use-asset-store";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { CanvasNodeType } = await import("../src/types/canvas");
const { buildNodeGenerationContext } = await import("../src/components/canvas/canvas-node-generation");
const { getNodeReferenceNodes, buildNodeMentionReferences, assetIdsFromReferenceIds } = await import("../src/lib/canvas/canvas-resource-references");
const { assetInCategory, assetKindOfFile } = await import("../src/lib/asset-library");
const { buildImageReferencePromptText } = await import("../src/lib/image-reference-prompt");

const node = (id: string, type: CanvasNodeData["type"], content?: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: { ...metadata, ...(content ? { content } : {}) },
});
const connection = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

const imageA = node("image-a", CanvasNodeType.Image, "data:image/png;base64,AA==");
const imageB = node("image-b", CanvasNodeType.Image, "data:image/png;base64,BB==");
const text = node("text-a", CanvasNodeType.Text, "红色外套");
const config = node("config", CanvasNodeType.Config, undefined, { composerContent: "ready" });
const inputs = [imageA, text, imageB, config];
const inputConnections = [connection(imageA.id, config.id), connection(text.id, config.id), connection(imageB.id, config.id)];

test("mentioned text is inlined where it is mentioned and references follow mention order", () => {
    const context = buildNodeGenerationContext(config.id, inputs, inputConnections, "把 @[node:text-a] 的描述应用到 @[node:image-b]，背景参考 @[node:image-a]");

    expect(context.referenceNodeIds).toEqual([text.id, imageB.id, imageA.id]);
    expect(context.referenceImages.map((image) => image.id)).toEqual([imageB.id, imageA.id]);
    expect(context.prompt).toBe("把 红色外套 的描述应用到 图片1，背景参考 图片2");

    const requestPrompt = buildImageReferencePromptText(context.prompt, context.referenceImages);
    expect(requestPrompt.startsWith("参考图片编号：图片1、图片2。")).toBe(true);
    expect(requestPrompt.indexOf("参考图片编号")).toBeLessThan(requestPrompt.indexOf("把 红色外套"));
});

test("a prompt without mentions sends every connected reference with reference text first", () => {
    const context = buildNodeGenerationContext(config.id, inputs, inputConnections, "输入框里的要求");

    expect(context.referenceNodeIds).toEqual([imageA.id, text.id, imageB.id]);
    expect(context.referenceImages.map((image) => image.id)).toEqual([imageA.id, imageB.id]);
    expect(context.prompt).toBe("红色外套\n\n输入框里的要求");
});

test("unmentioned references are kept after the mentioned ones", () => {
    const context = buildNodeGenerationContext(config.id, inputs, inputConnections, "女生穿着 @[node:image-b] 里的衣服");

    expect(context.referenceNodeIds).toEqual([imageB.id, imageA.id, text.id]);
    expect(context.referenceImages.map((image) => image.id)).toEqual([imageB.id, imageA.id]);
    expect(context.prompt).toBe("红色外套\n\n女生穿着 图片1 里的衣服");
});

test("a mention-only prompt keeps the referenced text", () => {
    const context = buildNodeGenerationContext(config.id, inputs, inputConnections, "@[node:text-a]");

    expect(context.prompt).toBe("红色外套");
    expect(context.referenceImages.map((image) => image.id)).toEqual([imageA.id, imageB.id]);
});

test("a mentioned group child resolves even though the group is the connected input", () => {
    const group = node("group", CanvasNodeType.Group);
    const childText = node("child-text", CanvasNodeType.Text, "蓝色背景", { groupId: group.id });
    const childImage = node("child-image", CanvasNodeType.Image, "data:image/png;base64,CC==", { groupId: group.id });
    const target = node("target", CanvasNodeType.Image);
    const context = buildNodeGenerationContext(target.id, [group, childText, childImage, target], [connection(group.id, target.id)], "@[node:child-image] 换成 @[node:child-text]");

    expect(context.prompt).toBe("图片1 换成 蓝色背景");
    expect(context.referenceNodeIds).toEqual([childImage.id, childText.id]);
});

test("an edited source image is labelled together with its references", () => {
    const source = node("source", CanvasNodeType.Image, "data:image/png;base64,DD==");
    const nodes = [imageA, text, source];
    const connections = [connection(imageA.id, source.id), connection(text.id, source.id)];

    const plain = buildNodeGenerationContext(source.id, nodes, connections, "参考 @[node:image-a] 修改", { includeSourceImage: true });
    expect(plain.referenceImages.map((image) => image.id)).toEqual([imageA.id, source.id]);
    expect(plain.prompt).toBe("红色外套\n\n参考 图片1 修改");

    const withoutMention = buildNodeGenerationContext(source.id, nodes, connections, "修改", { includeSourceImage: true });
    expect(withoutMention.referenceImages.map((image) => image.id)).toEqual([source.id, imageA.id]);
});

test("an existing generated result recovers references through its source config node", () => {
    const result = node("result", CanvasNodeType.Image, "image:result", { requestPrompt: "saved request" });
    const nodes = [...inputs, result];
    const connections = [...inputConnections, connection(config.id, result.id)];

    expect(getNodeReferenceNodes(result.id, nodes, connections).map((item) => item.id)).toEqual([imageA.id, text.id, imageB.id]);
});

test("a generated result restores its exact saved reference order", () => {
    const result = node("result", CanvasNodeType.Image, "image:result", { requestPrompt: "saved request", referenceNodeIds: [text.id, imageB.id] });
    const nodes = [...inputs, result];
    const connections = [...inputConnections, connection(config.id, result.id)];

    expect(getNodeReferenceNodes(result.id, nodes, connections).map((item) => item.id)).toEqual([text.id, imageB.id]);
});

test("saved references merge a directly connected text node", () => {
    const result = node("result", CanvasNodeType.Image, "image:result", {
        prompt: "让女生穿着参考图里的衣服",
        requestPrompt: "saved request",
        referenceNodeIds: [imageA.id, imageB.id],
    });
    const nodes = [...inputs, result];
    const connections = [connection(imageA.id, result.id), connection(imageB.id, result.id), connection(text.id, result.id)];

    expect(getNodeReferenceNodes(result.id, nodes, connections).map((item) => item.id)).toEqual([imageA.id, imageB.id, text.id]);
});

const libraryAssets: Asset[] = [
    { id: "portrait", kind: "image", title: "角色图", coverUrl: "", tags: [], categoryId: "characters", createdAt: "", updatedAt: "", data: { dataUrl: "data:image/png;base64,CC==", width: 10, height: 10, bytes: 1, mimeType: "image/png" } },
    { id: "description", kind: "text", title: "角色描述", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { content: "蓝色长裙" } },
    { id: "voice", kind: "audio", title: "配音", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { url: "blob:voice", storageKey: "audio:voice", bytes: 10, mimeType: "audio/wav" } },
];

test("library references work without adding canvas nodes or connections", () => {
    const target = node("library-target", CanvasNodeType.Config, undefined, { assetReferenceIds: ["portrait", "description", "voice"] });
    const context = buildNodeGenerationContext(target.id, [target], [], "用户要求", { assets: libraryAssets });
    expect(context.prompt).toBe("蓝色长裙\n\n用户要求");
    expect(context.referenceImages.map((image) => image.id)).toEqual(["asset:portrait"]);
    expect(context.referenceAudios.map((audio) => audio.storageKey)).toEqual(["audio:voice"]);
    expect(assetIdsFromReferenceIds(context.referenceNodeIds)).toEqual(["portrait", "description", "voice"]);
});

test("library mentions inline text and order media while retaining connected inputs", () => {
    const target = node("library-target", CanvasNodeType.Image, undefined, { assetReferenceIds: ["portrait", "description"] });
    const nodes = [imageA, target];
    const connections = [connection(imageA.id, target.id)];
    const context = buildNodeGenerationContext(target.id, nodes, connections, "让 @[node:asset:portrait] 穿 @[node:asset:description]", { assets: libraryAssets });
    expect(context.prompt).toBe("让 图片1 穿 蓝色长裙");
    expect(context.referenceImages.map((image) => image.id)).toEqual(["asset:portrait", imageA.id]);
    const mentions = buildNodeMentionReferences(target, nodes, connections, libraryAssets);
    expect(mentions.map((item) => item.nodeId)).toEqual([imageA.id, "asset:portrait", "asset:description"]);
});

test("removed library references cannot reappear from saved reference ids or mentions", () => {
    const target = node("library-target", CanvasNodeType.Image, undefined, { assetReferenceIds: [], referenceNodeIds: ["asset:portrait"] });
    const context = buildNodeGenerationContext(target.id, [target], [], "修改 @[node:asset:portrait]", { assets: libraryAssets });
    expect(context.referenceImages).toEqual([]);
    expect(context.prompt).toBe("修改");
});

test("custom categories replace rather than duplicate the built-in media category", () => {
    expect(assetInCategory(libraryAssets[0], "characters")).toBe(true);
    expect(assetInCategory(libraryAssets[0], "image")).toBe(false);
    expect(assetInCategory(libraryAssets[0], "all")).toBe(true);
    expect(assetInCategory(libraryAssets[2], "audio")).toBe(true);
    expect(assetKindOfFile(new File([""], "voice.WAV"))).toBe("audio");
    expect(assetKindOfFile(new File([""], "document.txt", { type: "text/plain" }))).toBe(null);
});

test("saved references merge a valid text mention", () => {
    const result = node("result", CanvasNodeType.Image, "image:result", {
        prompt: "@[node:text-a] 的女生穿着参考图里的衣服",
        requestPrompt: "saved request",
        referenceNodeIds: [imageA.id, imageB.id],
    });
    const nodes = [...inputs, result];
    const connections = [connection(imageA.id, result.id), connection(imageB.id, result.id)];

    expect(getNodeReferenceNodes(result.id, nodes, connections).map((item) => item.id)).toEqual([imageA.id, imageB.id, text.id]);
});
