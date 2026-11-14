import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Empty, Input, Modal, Pagination, Tag } from "antd";
import { FileText, Music2, Search, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AssetCategoryBar } from "@/components/asset-category";
import { assetDraftFromFile, assetInCategory, assetKindOfFile, assetTitle, type AssetCategoryFilter } from "@/lib/asset-library";
import { useAddAsset } from "@/hooks/use-add-asset";
import { getImagePreviewRevision, subscribeImagePreviews } from "@/services/image-storage";
import { ASSET_KINDS, assetCoverUrl, useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string }
    | { kind: "image"; dataUrl: string; title: string; storageKey?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number }
    | { kind: "audio"; url: string; title: string; storageKey?: string; bytes?: number; mimeType?: string; durationMs?: number };

export function assetToInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, bytes: asset.data.bytes, mimeType: asset.data.mimeType, durationMs: asset.data.durationMs };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

type Props = {
    open: boolean;
    /** Kinds that can be picked; other assets are hidden and uploads of other kinds are rejected. */
    kinds?: AssetKind[];
    onSelect: (asset: Asset) => void;
    onClose: () => void;
};

const PAGE_SIZE = 8;
const ACCEPT: Record<AssetKind, string> = { image: "image/*", video: "video/*", audio: "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac", text: "" };

export function AssetPickerModal({ open, kinds = ASSET_KINDS, onSelect, onClose }: Props) {
    const { t } = useTranslation();
    return (
        <Modal title={t("canvas.assetPicker.title")} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 320 } }}>
            <AssetPickerContent kinds={kinds} onSelect={onSelect} />
        </Modal>
    );
}

function AssetPickerContent({ kinds, onSelect }: { kinds: AssetKind[]; onSelect: (asset: Asset) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const { chooseCategory } = useAddAsset();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState<AssetCategoryFilter>("all");
    const [page, setPage] = useState(1);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const accept = kinds.map((kind) => ACCEPT[kind]).filter(Boolean).join(",");

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => kinds.includes(asset.kind) && assetInCategory(asset, category) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, category, keyword, kinds]);
    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        setPage((value) => Math.min(value, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))));
    }, [filtered.length]);

    const uploadFiles = async (files: File[]) => {
        if (fileInputRef.current) fileInputRef.current.value = "";
        const supported = files.filter((file) => {
            const kind = assetKindOfFile(file);
            return kind && kinds.includes(kind);
        });
        if (!supported.length) return void message.warning(t("canvas.assetPicker.unsupported"));
        const categoryId = await chooseCategory();
        if (categoryId === null) return;
        setUploading(true);
        let added = 0;
        const uploaded: Asset[] = [];
        try {
            for (const file of supported) {
                const draft = await assetDraftFromFile(file, categoryId);
                if (!draft) continue;
                const id = addAsset(draft);
                const asset = useAssetStore.getState().assets.find((item) => item.id === id);
                if (asset) uploaded.push(asset);
                added += 1;
            }
            if (added) {
                message.success(t("canvas.sidePanel.addedAssets", { count: added }));
                setCategory(categoryId || "all");
                if (uploaded.length === 1) onSelect(uploaded[0]);
            } else message.warning(t("canvas.assetPicker.unsupported"));
        } catch {
            message.error(t("canvas.sidePanel.addFailed"));
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5 text-stone-400" />}
                    placeholder={t("canvas.assetPicker.search")}
                    value={keyword}
                    allowClear
                    onChange={(event) => {
                        setPage(1);
                        setKeyword(event.target.value);
                    }}
                />
                <div className="min-w-0 flex-1">
                    <AssetCategoryBar
                        kinds={kinds}
                        value={category}
                        onChange={(value) => {
                            setPage(1);
                            setCategory(value);
                        }}
                    />
                </div>
                {accept ? (
                    <>
                        <Button size="small" type="text" icon={<Upload className="size-3.5" />} loading={uploading} onClick={() => fileInputRef.current?.click()}>
                            {t("common.upload")}
                        </Button>
                        <input ref={fileInputRef} type="file" accept={accept} multiple className="hidden" onChange={(event) => void uploadFiles(Array.from(event.target.files || []))} />
                    </>
                ) : null}
            </div>

            {visible.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} asset={asset} onClick={() => onSelect(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />
            )}

            {filtered.length > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}

function PickerCard({ asset, onClick }: { asset: Asset; onClick: () => void }) {
    const { t } = useTranslation();
    const categories = useAssetStore((state) => state.categories);
    const cover = assetCoverUrl(asset);
    const title = assetTitle(asset);
    const label = categories.find((category) => category.id === asset.categoryId)?.name || t(`assets.kinds.${asset.kind}`);
    // The tag repeats the title for canvas-generated assets named after their kind ("画布文本" / 文本).
    const showLabel = label !== title;
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
            onClick={onClick}
        >
            <div className="relative h-24 w-full overflow-hidden bg-stone-100 dark:bg-stone-800" style={{ borderRadius: "0.5rem 0.5rem 0 0" }}>
                {cover ? (
                    <img src={cover} alt={title} className="block size-full max-h-full max-w-full object-cover" />
                ) : asset.kind === "video" ? (
                    <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" className="block size-full bg-black object-cover" />
                ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-xs leading-5 text-stone-500 dark:text-stone-400">
                        {asset.kind === "audio" ? <Music2 className="size-6" /> : <FileText className="size-5" />}
                        <span className="line-clamp-3">{asset.kind === "text" ? asset.data.content : title}</span>
                    </div>
                )}
            </div>
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{title}</span>
                    {showLabel ? <Tag className="m-0 shrink-0 text-[10px]">{label}</Tag> : null}
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">{t("canvas.assetPicker.insert")}</div>
        </button>
    );
}
