import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import type { Asset, AssetDraft, AssetKind } from "@/stores/use-asset-store";

/** Filter key for the category row: "all", a built-in kind, or a custom category id. */
export type AssetCategoryFilter = "all" | AssetKind | string;

export function assetInCategory(asset: Asset, filter: AssetCategoryFilter) {
    return filter === "all" || (asset.categoryId || asset.kind) === filter;
}

/** Built-in kinds a file can be stored as; other files are rejected. */
export function assetKindOfFile(file: File): Exclude<AssetKind, "text"> | null {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return "audio";
    return null;
}

/** Store a local file and build the asset record for it, or null when the file is not an image, video or audio. */
export async function assetDraftFromFile(file: File, categoryId?: string): Promise<AssetDraft | null> {
    const kind = assetKindOfFile(file);
    const base = { title: file.name, coverUrl: "", tags: [], categoryId: categoryId || undefined, source: undefined };
    if (kind === "image") {
        const image = await uploadImage(file);
        return { ...base, kind, coverUrl: image.url, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } };
    }
    if (kind === "video") {
        const media = await uploadMediaFile(file, "video");
        return { ...base, kind, data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } };
    }
    if (kind === "audio") {
        const media = await uploadMediaFile(file, "audio");
        return { ...base, kind, data: { url: media.url, storageKey: media.storageKey, bytes: media.bytes, mimeType: media.mimeType || "audio/mpeg", durationMs: media.durationMs } };
    }
    return null;
}

/** Playable or viewable source of a media asset. */
export function assetMediaUrl(asset: Asset) {
    if (asset.kind === "image") return asset.data.dataUrl;
    if (asset.kind === "video" || asset.kind === "audio") return asset.data.url;
    return "";
}
