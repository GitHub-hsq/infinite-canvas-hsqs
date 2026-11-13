import { afterAll, expect, test } from "bun:test";

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

const { LOCAL_PROXY_SERVICE_URL, useConfigStore, withLocalProxy } = await import("../src/stores/use-config-store");

test("local proxy uses the standalone 23210 service rather than Canvas Agent", () => {
    useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: true } }));

    expect(LOCAL_PROXY_SERVICE_URL).toBe("http://127.0.0.1:23210");
    expect(withLocalProxy("https://api.example.com/v1/models?scope=all")).toBe("http://127.0.0.1:23210/https://api.example.com/v1/models?scope=all");
    expect(withLocalProxy("data:image/png;base64,AA==")).toBe("data:image/png;base64,AA==");
});

test("local proxy respects explicit channel bypass", () => {
    useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: true } }));
    expect(withLocalProxy("https://api.example.com/v1/models", "never")).toBe("https://api.example.com/v1/models");
});
