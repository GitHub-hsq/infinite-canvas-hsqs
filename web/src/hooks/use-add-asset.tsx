import { App } from "antd";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { AssetCategorySelect } from "@/components/asset-category";
import { useAssetStore, type AssetDraft, type AssetKind } from "@/stores/use-asset-store";

/**
 * "加入资产" with a category prompt. `chooseCategory` resolves to the chosen category ("" = built-in category of the kind)
 * or null when cancelled; `addAsset` asks, stores the asset and shows the success message.
 */
export function useAddAsset() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const storeAsset = useAssetStore((state) => state.addAsset);

    const chooseCategory = useCallback(
        (kind?: AssetKind) =>
            new Promise<string | null>((resolve) => {
                let value = "";
                modal.confirm({
                    title: t("common.addToAssets"),
                    icon: null,
                    content: <CategoryField kind={kind} onChange={(next) => (value = next)} />,
                    okText: t("common.save"),
                    cancelText: t("common.cancel"),
                    onOk: () => resolve(value),
                    onCancel: () => resolve(null),
                });
            }),
        [modal, t],
    );

    const addAsset = useCallback(
        async (draft: AssetDraft) => {
            const categoryId = await chooseCategory(draft.kind);
            if (categoryId === null) return false;
            storeAsset({ ...draft, categoryId: categoryId || undefined });
            message.success(t("common.addedToAssets"));
            return true;
        },
        [chooseCategory, message, storeAsset, t],
    );

    return { chooseCategory, addAsset };
}

function CategoryField({ kind, onChange }: { kind?: AssetKind; onChange: (value: string) => void }) {
    const { t } = useTranslation();
    const [value, setValue] = useState("");
    return (
        <div className="pt-2">
            <div className="mb-1 text-sm">{t("assets.category")}</div>
            <AssetCategorySelect
                className="w-full"
                kind={kind}
                value={value}
                onChange={(next) => {
                    setValue(next);
                    onChange(next);
                }}
            />
        </div>
    );
}
