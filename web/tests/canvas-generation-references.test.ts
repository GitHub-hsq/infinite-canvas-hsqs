import { afterAll, expect, test } from "bun:test";
import type { CanvasConnection, CanvasNodeData } from "../src/types/canvas";

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
const { getNodeReferenceNodes } = await import("../src/lib/canvas/canvas-resource-references");
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
