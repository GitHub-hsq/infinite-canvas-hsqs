import { App, Button, Input, Modal, Popconfirm } from "antd";
import { PencilLine, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ASSET_KINDS, useAssetStore } from "@/stores/use-asset-store";

export function AssetCategoryManager({ onRemoved }: { onRemoved: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const categories = useAssetStore((state) => state.categories);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const save = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (ASSET_KINDS.some((kind) => t(`assets.kinds.${kind}`) === trimmed) || categories.some((category) => category.id !== editingId && category.name === trimmed)) {
            message.warning(t("assets.categories.duplicate"));
            return;
        }
        const store = useAssetStore.getState();
        if (editingId) store.renameCategory(editingId, trimmed);
        else store.addCategory(trimmed);
        setName("");
        setEditingId(null);
    };
    return (
        <>
            <Button type="text" size="small" icon={<Settings2 className="size-3.5" />} onClick={() => setOpen(true)}>{t("assets.categories.manage")}</Button>
            <Modal title={t("assets.categories.manage")} open={open} footer={null} onCancel={() => setOpen(false)} width={440}>
                <div className="space-y-2 py-2">
                    {categories.map((category) => (
                        <div key={category.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 break-words">{category.name}</span>
                            <Button type="text" size="small" icon={<PencilLine className="size-3.5" />} aria-label={t("common.edit")} onClick={() => { setEditingId(category.id); setName(category.name); }} />
                            <Popconfirm title={t("assets.categories.deleteConfirm")} onConfirm={() => {
                                useAssetStore.getState().removeCategory(category.id);
                                if (editingId === category.id) { setEditingId(null); setName(""); }
                                onRemoved();
                            }} okText={t("common.delete")} cancelText={t("common.cancel")}>
                                <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} aria-label={t("common.delete")} />
                            </Popconfirm>
                        </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2">
                        <Input value={name} placeholder={t("assets.categories.namePlaceholder")} onChange={(event) => setName(event.target.value)} onPressEnter={save} />
                        <Button icon={editingId ? undefined : <Plus className="size-3.5" />} onClick={save}>{t(editingId ? "common.save" : "assets.categories.add")}</Button>
                        {editingId ? <Button type="text" onClick={() => { setEditingId(null); setName(""); }}>{t("common.cancel")}</Button> : null}
                    </div>
                </div>
            </Modal>
        </>
    );
}
