import { afterAll, expect, test } from "bun:test";
import type { AiConfig, ModelCapability } from "../src/stores/use-config-store";
import type { CanvasNodeData } from "../src/types/canvas";

// Config and i18n use browser storage during module initialization.
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

const { channelApiKeyValues, defaultConfig, resolveModelForCapability, resolveModelRequestConfig, upsertChannelCredentials, useConfigStore, withResolvedApiKeyContext } = await import("../src/stores/use-config-store");
const { buildGenerationConfig } = await import("../src/lib/canvas/canvas-generation-helpers");
const { CanvasNodeType } = await import("../src/types/canvas");

const config: AiConfig = {
    ...defaultConfig,
    videoModel: "replacement::video-b",
    channels: [
        {
            id: "replacement",
            name: "Replacement",
            baseUrl: "https://example.com",
            apiKey: "test-key",
            apiFormat: "openai",
            models: [
                { name: "video-b", capability: "video" },
                { name: "video-a", capability: "video" },
                { name: "image-a", capability: "image" },
            ],
        },
    ],
};
const ready = useConfigStore.getState().isAiConfigReady;
const videoNode = (model: string): CanvasNodeData => ({
    id: "saved-video",
    type: CanvasNodeType.Video,
    title: "Saved video",
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: { model, videoTaskId: "original-task", videoTaskProvider: "openai", seconds: "4" },
});

test("a saved video on a removed provider is not replaced by the default video model", () => {
    const selected = buildGenerationConfig(config, videoNode("removed::video-a"), "video");
    expect(selected.model).toBe("removed::video-a");
    expect(ready(selected, selected.model)).toBe(false);
});

test("removing a model from an existing provider prevents retry even with valid credentials", () => {
    const selected = buildGenerationConfig(config, videoNode("replacement::deleted-video"), "video");
    expect(selected.model).toBe("replacement::deleted-video");
    expect(ready(selected, selected.model)).toBe(false);
});

test("task recovery rejects a missing provider instead of querying the first provider", () => {
    expect(ready(config, "removed::video-a")).toBe(false);
    expect(ready(config, "unknown-video")).toBe(false);
});

test("an explicitly selected unavailable default is not replaced by the built-in default", () => {
    const selected = buildGenerationConfig({ ...config, videoModel: "removed::video-a" }, undefined, "video");
    expect(selected.model).toBe("removed::video-a");
    expect(ready(selected, selected.model)).toBe(false);
});

test("a new node without a selection still uses its configured default", () => {
    const selected = buildGenerationConfig(config, undefined, "video");
    expect(selected.model).toBe("replacement::video-b");
    expect(ready(selected, selected.model)).toBe(true);
});

test("a provider with capability-specific keys selects the matching key", () => {
    const multiKeyConfig: AiConfig = {
        ...config,
        channels: config.channels.map((channel) => ({
            ...channel,
            apiKey: "text-key",
            models: [...channel.models, { name: "text-a", capability: "text" as const }],
            apiKeys: [
                { id: "text-key", name: "Text", apiKey: "text-key", capabilities: ["text"] },
                { id: "image-key", name: "Image", apiKey: "image-key", capabilities: ["image"] },
            ],
        })),
    };

    expect(resolveModelRequestConfig(multiKeyConfig, "replacement::video-b").apiKey).toBe("");
    expect(resolveModelRequestConfig(multiKeyConfig, "replacement::text-a").apiKey).toBe("text-key");
    const imageRequest = resolveModelRequestConfig(multiKeyConfig, "replacement::image-a");
    expect(imageRequest.apiKey).toBe("image-key");
    expect(imageRequest.resolvedApiKeyName).toBe("Image");
    expect(imageRequest.resolvedApiKeySuffix).toBe("-key");
    expect(ready(multiKeyConfig, "replacement::video-b")).toBe(false);
    expect(ready(multiKeyConfig, "replacement::image-a")).toBe(true);
});

test("disabled keys are skipped and errors identify the selected account without exposing the full key", () => {
    const multiKeyConfig: AiConfig = {
        ...config,
        channels: config.channels.map((channel) => ({
            ...channel,
            apiKeys: [
                { id: "depleted", name: "Personal", apiKey: "secret-personal-1234", capabilities: ["image"], enabled: false },
                { id: "active", name: "Work", apiKey: "secret-work-7890", capabilities: ["image"], enabled: true },
            ],
        })),
    };

    expect(channelApiKeyValues(multiKeyConfig.channels[0])).toEqual(["secret-work-7890"]);
    const request = resolveModelRequestConfig(multiKeyConfig, "replacement::image-a");
    const message = withResolvedApiKeyContext("quota exceeded", request);
    expect(request.apiKey).toBe("secret-work-7890");
    expect(message).toContain("Work");
    expect(message).toContain("7890");
    expect(message).not.toContain("secret-work-7890");
});

test("updating imported credentials preserves the provider's additional keys", () => {
    const multiKeyConfig: AiConfig = {
        ...config,
        channels: config.channels.map((channel) => ({
            ...channel,
            apiKeys: [
                { id: "primary", name: "Primary", apiKey: "old-key", capabilities: ["text"] },
                { id: "image", name: "Image", apiKey: "image-key", capabilities: ["image"] },
            ],
        })),
    };
    const result = upsertChannelCredentials(multiKeyConfig, { baseUrl: "https://example.com", apiKey: "new-key" });

    expect(result.config.channels[0].apiKeys).toEqual([
        { id: "primary", name: "Primary", apiKey: "new-key", capabilities: ["text"] },
        { id: "image", name: "Image", apiKey: "image-key", capabilities: ["image"] },
    ]);
});

test("switching generation capability still selects a model of the new capability", () => {
    expect(resolveModelForCapability(config, "replacement::image-a", "video")).toBe("replacement::video-b");
});

test("changing only the key on the same provider preserves the saved model and task", () => {
    const node = videoNode("replacement::video-a");
    const selected = buildGenerationConfig({ ...config, channels: [{ ...config.channels[0], apiKey: "rotated-key" }] }, node, "video");
    expect(selected.model).toBe("replacement::video-a");
    expect(ready(selected, selected.model)).toBe(true);
    expect(node.metadata?.videoTaskId).toBe("original-task");
    expect(ready({ ...selected, channels: [{ ...config.channels[0], apiKey: "" }] }, selected.model)).toBe(false);
});

test("unavailable explicit selections are preserved for every generation capability", () => {
    for (const capability of ["image", "video", "text", "audio"] as ModelCapability[]) {
        expect(resolveModelForCapability(config, `removed::${capability}`, capability)).toBe(`removed::${capability}`);
    }
});
