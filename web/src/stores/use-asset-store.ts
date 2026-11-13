import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video" | "audio";
export const ASSET_KINDS: AssetKind[] = ["image", "video", "audio", "text"];
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;
type WithoutAssetIdentity<T> = T extends Asset ? Omit<T, "id" | "createdAt" | "updatedAt"> : never;
export type AssetDraft = WithoutAssetIdentity<Asset>;
/** A user-defined category such as 角色/场景/道具. Assets without one stay in the built-in category of their kind. */
export type AssetCategory = { id: string; name: string; updatedAt: string };

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    /** Custom category id; empty means the asset sits in the built-in category of its kind. */
    categoryId?: string;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    categories: AssetCategory[];
    addAsset: (asset: AssetDraft) => string;
    addCategory: (name: string) => string;
    renameCategory: (id: string, name: string) => void;
    removeCategory: (id: string) => void;
    mergeCategories: (categories: AssetCategory[]) => void;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

/** The category an asset is listed under: its custom category, or the built-in category named after its kind. */
export function assetCategoryKey(asset: Asset) {
    return asset.categoryId || asset.kind;
}

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if ((asset.kind === "video" || asset.kind === "audio") && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } } as Asset;
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            categories: [],
            addCategory: (name) => {
                const existing = get().categories.find((category) => category.name === name.trim());
                if (existing) return existing.id;
                const id = nanoid();
                set((state) => ({ categories: [...state.categories, { id, name: name.trim(), updatedAt: new Date().toISOString() }] }));
                return id;
            },
            renameCategory: (id, name) => set((state) => ({ categories: state.categories.map((category) => (category.id === id ? { ...category, name: name.trim(), updatedAt: new Date().toISOString() } : category)) })),
            // Assets of a removed category fall back to the built-in category of their kind.
            removeCategory: (id) =>
                set((state) => ({
                    categories: state.categories.filter((category) => category.id !== id),
                    assets: state.assets.map((asset) => (asset.categoryId === id ? ({ ...asset, categoryId: undefined, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            mergeCategories: (categories) => set((state) => ({ categories: [...state.categories, ...categories.filter((category) => !state.categories.some((item) => item.id === category.id))] })),
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets, categories: state.categories }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
