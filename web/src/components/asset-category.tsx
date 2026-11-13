import { App, Button, Divider, Input, Select, Tag } from "antd";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { AssetCategoryFilter } from "@/lib/asset-library";
import { cn } from "@/lib/utils";
import { ASSET_KINDS, useAssetStore, type AssetKind } from "@/stores/use-asset-store";

/** One row of category filters: 全部, the built-in kinds, then custom categories such as 角色/场景/道具. */
export function AssetCategoryBar({ value, onChange, kinds = ASSET_KINDS, extra }: { value: AssetCategoryFilter; onChange: (value: AssetCategoryFilter) => void; kinds?: AssetKind[]; extra?: ReactNode }) {
    const { t } = useTranslation();
    const categories = useAssetStore((state) => state.categories);
    const options = [{ key: "all", label: t("common.all") }, ...kinds.map((kind) => ({ key: kind, label: t(`assets.kinds.${kind}`) })), ...categories.map((category) => ({ key: category.id, label: category.name }))];
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {options.map((option) => (
                <Tag.CheckableTag key={option.key} checked={value === option.key} className={cn("prompt-filter-tag", value === option.key && "is-active")} onChange={() => onChange(option.key)}>
                    {option.label}
                </Tag.CheckableTag>
            ))}
            {extra}
        </div>
    );
}

/**
 * Pick where an asset is stored: "" keeps it in the built-in category of its kind (or of each file's kind
 * when `kind` is omitted for mixed uploads); any other value is a custom category id. New categories can be created inline.
 */
export function AssetCategorySelect({ kind, value = "", onChange, className }: { kind?: AssetKind; value?: string; onChange?: (value: string) => void; className?: string }) {
    const { t } = useTranslation();
    const categories = useAssetStore((state) => state.categories);
    const addCategory = useAssetStore((state) => state.addCategory);
    const { message } = App.useApp();
    const [name, setName] = useState("");
    const create = () => {
        if (!name.trim()) return;
        if (ASSET_KINDS.some((item) => t(`assets.kinds.${item}`) === name.trim())) {
            message.warning(t("assets.categories.duplicate"));
            return;
        }
        onChange?.(addCategory(name));
        setName("");
    };
    return (
        <Select
            className={className}
            value={value}
            onChange={onChange}
            options={[{ value: "", label: kind ? t(`assets.kinds.${kind}`) : t("assets.categories.byKind") }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
            popupRender={(menu) => (
                <>
                    {menu}
                    <Divider className="!my-1" />
                    <div className="flex items-center gap-1 p-1" onMouseDown={(event) => event.stopPropagation()}>
                        <Input
                            size="small"
                            value={name}
                            placeholder={t("assets.categories.namePlaceholder")}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") create();
                            }}
                        />
                        <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={create}>
                            {t("assets.categories.add")}
                        </Button>
                    </div>
                </>
            )}
        />
    );
}
