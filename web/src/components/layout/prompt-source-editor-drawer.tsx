import { App, Button, Input, Switch } from "antd";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PromptSource } from "@/services/api/prompt-source-presets";

// Prompt source editor rendered inline inside the config drawer instead of stacking a second drawer on top of it.
export function PromptSourceEditorPanel({ source, onSave, onClose }: { source: PromptSource; onSave: (source: PromptSource) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const [draft, setDraft] = useState<PromptSource>(source);
    const backLabel = String(i18n.resolvedLanguage || "").startsWith("zh") ? "返回" : "Back";

    useEffect(() => setDraft(source), [source]);

    const patch = (value: Partial<PromptSource>) => setDraft((current) => ({ ...current, ...value }));

    const save = () => {
        const name = draft.name.trim();
        const url = draft.url.trim();
        if (!name) return message.warning(t("config.promptSources.editor.nameRequired"));
        if (!isHttpUrl(url)) return message.warning(t("config.promptSources.editor.invalidUrl"));
        if (draft.homepage.trim() && !isHttpUrl(draft.homepage.trim())) return message.warning(t("config.promptSources.editor.invalidHomepage"));
        onSave({ ...draft, name, url, homepage: draft.homepage.trim(), builtIn: false });
        onClose();
    };

    return (
        <div>
            <div className="mb-5 flex items-center justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="flex items-center gap-2">
                    <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} onClick={onClose}>
                        {backLabel}
                    </Button>
                    <span className="text-sm font-semibold">{t(source.name ? "config.promptSources.editor.editTitle" : "config.promptSources.editor.addTitle")}</span>
                </div>
                <Button type="primary" size="small" onClick={save}>
                    {t("common.save")}
                </Button>
            </div>

            <div className="space-y-5">
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">{t("config.promptSources.editor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder={t("config.promptSources.editor.namePlaceholder")} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">JSON URL</span>
                    <Input value={draft.url} onChange={(event) => patch({ url: event.target.value })} placeholder="https://example.com/prompts.json" />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">{t("config.promptSources.editor.homepage")}</span>
                    <Input value={draft.homepage} onChange={(event) => patch({ homepage: event.target.value })} placeholder="https://example.com" />
                </label>
                <div className="flex items-center justify-between border-y border-stone-200 py-3 dark:border-stone-800">
                    <span className="text-sm font-medium">{t("config.promptSources.editor.enabled")}</span>
                    <Switch checked={draft.enabled} onChange={(enabled) => patch({ enabled })} />
                </div>
                <div>
                    <div className="mb-2 text-sm font-medium">{t("config.promptSources.editor.jsonFormat")}</div>
                    <pre className="overflow-x-auto rounded-md bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{`[
  {
    "id": "product-photo-1",
    "title": "Product photo",
    "prompt": "Generate a professional product photo on a white background",
    "description": "",
    "coverUrl": "",
    "referenceImageUrls": [],
    "tags": ["product", "photography"]
  }
]`}</pre>
                </div>
            </div>
        </div>
    );
}

function isHttpUrl(value: string) {
    try {
        return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}
