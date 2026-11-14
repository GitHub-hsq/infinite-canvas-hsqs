import { Copy, Download, Music2, PencilLine, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Card, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { AssetCategoryBar, AssetCategorySelect } from "@/components/asset-category";
import { useCopyText } from "@/hooks/use-copy-text";
import { assetDraftFromFile, assetInCategory, assetMediaUrl, assetTitle } from "@/lib/asset-library";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob, getImagePreviewRevision, subscribeImagePreviews } from "@/services/image-storage";
import { ASSET_KINDS, assetCoverUrl, useAssetStore, type Asset, type AssetDraft, type AssetKind } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { AssetCategoryManager } from "./components/asset-category-manager";

type AssetFormValues = {
    kind: AssetKind;
    categoryId?: string;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [mediaDraft, setMediaDraft] = useState<AssetDraft | null>(null);
    const [uploading, setUploading] = useState(false);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const content = Form.useWatch("content", form) || "";

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => assetInCategory(asset, categoryFilter) && (!query || assetSearchText(asset).includes(query)));
    }, [assets, keyword, categoryFilter]);
    const visibleAssets = filteredAssets.slice((page - 1) * pageSize, page * pageSize);

    useEffect(() => {
        setPage((value) => Math.min(value, Math.max(1, Math.ceil(filteredAssets.length / pageSize))));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setMediaDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", categoryId: ASSET_KINDS.includes(categoryFilter as AssetKind) || categoryFilter === "all" ? "" : categoryFilter, title: "", coverUrl: "", tags: [], source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };
    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setMediaDraft(asset.kind === "text" ? null : asset);
        form.setFieldsValue({ kind: asset.kind, categoryId: asset.categoryId || "", title: asset.title, coverUrl: asset.coverUrl, tags: asset.tags || [], source: asset.source, note: asset.note, content: asset.kind === "text" ? asset.data.content : "" });
        setIsAssetOpen(true);
    };
    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (mediaDraft?.kind === "image" ? mediaDraft.data.dataUrl : ""),
            categoryId: values.categoryId || undefined,
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };
        let draft: AssetDraft;
        if (values.kind === "text") draft = { ...base, kind: "text", data: { content: (values.content || "").trim() } };
        else {
            if (!mediaDraft || mediaDraft.kind !== values.kind) return void message.error(t("assets.selectMedia"));
            draft = { ...mediaDraft, ...base };
        }
        if (editingAsset) updateAsset(editingAsset.id, draft);
        else addAsset(draft);
        message.success(t(editingAsset ? "assets.updated" : "assets.saved"));
        setIsAssetOpen(false);
    };
    const readMediaFile = async (file?: File) => {
        if (!file) return;
        setUploading(true);
        try {
            const draft = await assetDraftFromFile(file);
            if (!draft) return void message.error(t("assets.selectMedia"));
            setMediaDraft(draft);
            setFormKind(draft.kind);
            form.setFieldValue("kind", draft.kind);
            if (draft.kind === "image" && !form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.data.dataUrl);
            if (!form.getFieldValue("title")) form.setFieldValue("title", draft.title);
        } catch {
            message.error(t("assets.uploadFailed"));
        } finally {
            setUploading(false);
        }
    };
    const copyAssetText = (asset: Asset) => {
        if (asset.kind === "text") copyText(asset.data.content, t("assets.textCopied"));
    };
    const downloadAsset = async (asset: Asset) => {
        if (asset.kind === "text") return;
        try {
            const stored = asset.data.storageKey ? await (asset.kind === "image" ? getImageBlob(asset.data.storageKey) : getMediaBlob(asset.data.storageKey)) : null;
            const blob = stored || await fetch(assetMediaUrl(asset) || asset.coverUrl).then((response) => response.ok ? response.blob() : null);
            if (!blob) return void message.error(t("assets.downloadFailed"));
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "png");
            saveAs(blob, `${assetTitle(asset) || "asset"}.${ext}`);
        } catch {
            message.error(t("assets.downloadFailed"));
        }
    };
    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const imported = await readAssetPackage(file);
            useAssetStore.getState().mergeCategories(imported.categories);
            imported.assets.forEach(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...asset }) => addAsset(asset));
            message.success(t("assets.imported", { count: imported.assets.length }));
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight">{t("assets.title")}</h1>
                        <p className="mt-3 text-sm text-stone-500">{t("assets.description")}</p>
                    </div>
                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <Input.Search size="large" allowClear prefix={<Search className="size-4" />} value={keyword} placeholder={t("assets.search")} onChange={(event) => { setPage(1); setKeyword(event.target.value); }} />
                    </div>
                    <div className="mx-auto mt-6 flex max-w-6xl flex-wrap items-center justify-between gap-3">
                        <AssetCategoryBar value={categoryFilter} onChange={(value) => { setPage(1); setCategoryFilter(value); }} extra={<AssetCategoryManager onRemoved={() => setCategoryFilter("all")} />} />
                        <Space wrap>
                            <Button type="text" onClick={() => assets.length ? void exportAssets(assets, t("assets.packageName")) : message.warning(t("assets.noneToExport"))}>{t("assets.export")}</Button>
                            <Button type="text" onClick={() => assetInputRef.current?.click()}>{t("assets.import")}</Button>
                            <Button type="primary" onClick={openCreate}>{t("assets.add")}</Button>
                        </Space>
                    </div>
                </div>
                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadAsset} onDelete={() => setDeletingAsset(asset)} />)}
                    </div>
                    {!visibleAssets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}
                    <div className="flex justify-center">
                        <Pagination current={page} pageSize={pageSize} total={filteredAssets.length} showSizeChanger pageSizeOptions={[10, 20, 50, 100]} onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
                    </div>
                </div>
            </main>
            <Modal title={t(editingAsset ? "assets.edit" : "assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} confirmLoading={uploading} okButtonProps={{ disabled: uploading }} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", categoryId: "", tags: [] }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select options={ASSET_KINDS.map((kind) => ({ label: t(`assets.kinds.${kind}`), value: kind }))} onChange={(value) => { setFormKind(value); setMediaDraft(null); }} />
                        </Form.Item>
                        <Form.Item name="categoryId" label={t("assets.category")}><AssetCategorySelect kind={formKind} /></Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, whitespace: true, message: t("assets.fields.titleRequired") }]}><Input size="large" placeholder={t("assets.fields.titlePlaceholder")} /></Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>{t("common.upload")}</Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}><Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} /></Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}><Input placeholder={t("assets.fields.sourcePlaceholder")} /></Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}><Input placeholder={t("assets.fields.optional")} /></Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, whitespace: true, message: t("assets.fields.textRequired") }]}><Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} /></Form.Item>
                        ) : (
                            <Form.Item label={t(`assets.kinds.${formKind}`)} required>
                                <div className="rounded-lg border border-dashed p-4">
                                    <Button loading={uploading} icon={<Upload className="size-4" />} onClick={() => mediaInputRef.current?.click()}>{t("common.upload")}</Button>
                                    <Typography.Text type="secondary" className="ml-3 text-xs">{mediaDraft && mediaDraft.kind !== "text" ? `${formatBytes(mediaDraft.data.bytes)} · ${mediaDraft.data.mimeType}` : t("assets.selectMedia")}</Typography.Text>
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="min-w-0 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg">
                            {mediaDraft?.kind === "audio" ? <audio src={mediaDraft.data.url} controls className="w-full" /> : mediaDraft?.kind === "video" ? <video src={mediaDraft.data.url} controls className="aspect-video w-full" /> : coverUrl || mediaDraft?.kind === "image" ? <img src={coverUrl || (mediaDraft?.kind === "image" ? mediaDraft.data.dataUrl : "")} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="whitespace-pre-wrap break-words p-5 text-sm">{content || t("assets.noCover")}</div>}
                            <Typography.Title level={5} className="!mt-3">{title || t("assets.untitled")}</Typography.Title>
                        </div>
                    </div>
                </div>
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFileAsDataUrl(file).then((url) => form.setFieldValue("coverUrl", url)); event.target.value = ""; }} />
                <input ref={mediaInputRef} type="file" accept={formKind === "image" ? "image/*" : formKind === "video" ? "video/*" : "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"} className="hidden" onChange={(event) => { void readMediaFile(event.target.files?.[0]); event.target.value = ""; }} />
            </Modal>
            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadAsset} />
            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />
            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={() => { if (deletingAsset) removeAsset(deletingAsset.id); setDeletingAsset(null); message.success(t("assets.deleted")); }} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>{t("assets.deleteConfirm", { name: deletingAsset?.title })}</Modal>
        </div>
    );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const categories = useAssetStore((state) => state.categories);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = assetCoverUrl(asset);
    const title = assetTitle(asset);
    const label = categories.find((category) => category.id === asset.categoryId)?.name || t(`assets.kinds.${asset.kind}`);
    return (
        <Card hoverable className="overflow-hidden" styles={{ body: { padding: 0 } }} cover={
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                {cover ? <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" /> : asset.kind === "video" ? <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center overflow-hidden p-5 text-sm">{asset.kind === "audio" ? <Music2 className="size-8 opacity-60" /> : asset.kind === "text" ? <span className="line-clamp-5 whitespace-pre-wrap">{asset.data.content}</span> : t("assets.noCover")}</div>}
            </button>
        }>
            <button type="button" className="block w-full p-4 text-left" onClick={onOpen}>
                <div className="flex items-start justify-between gap-3"><h2 className="line-clamp-1 min-w-0 text-sm font-semibold">{title}</h2><Tag className="m-0 shrink-0 text-[11px]">{label}</Tag></div>
                <Typography.Text type="secondary" className="mt-1 block text-xs">{asset.source || t("assets.unknownSource")}</Typography.Text>
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs">{assetSummary(asset)}</Typography.Paragraph>
                <div className="mt-3 flex flex-wrap gap-1.5">{(asset.tags || []).slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>
            </button>
            <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>{t("common.view")}</Button>
                <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>{t("common.edit")}</Button>
                {asset.kind === "text" ? <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(asset)}>{t("common.copy")}</Button> : <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>{t("common.download")}</Button>}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>{t("common.delete")}</Button>
            </div>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    return (
        <Drawer title={t("assets.details")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? <div className="space-y-5">
                {asset.kind === "image" ? <Image src={assetCoverUrl(asset)} preview={{ src: asset.data.dataUrl || asset.coverUrl }} alt={asset.title} /> : asset.kind === "video" ? <video src={asset.data.url} controls className="aspect-video w-full rounded-lg" /> : asset.kind === "audio" ? <audio src={asset.data.url} controls className="w-full" /> : <Typography.Paragraph className="whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>}
                <Typography.Title level={4}>{assetTitle(asset)}</Typography.Title>
                <Space wrap><Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>{asset.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>
                <Typography.Paragraph>{assetSummary(asset)}</Typography.Paragraph>
                {asset.note ? <Typography.Paragraph>{asset.note}</Typography.Paragraph> : null}
                {asset.kind === "text" ? <Button onClick={() => onCopy(asset)}>{t("assets.copyText")}</Button> : <Button onClick={() => onDownload(asset)}>{t("common.download")}</Button>}
            </div> : null}
        </Drawer>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.kind === "audio" ? "" : `${asset.data.width}x${asset.data.height} · `}${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
