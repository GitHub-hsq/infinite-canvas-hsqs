import { App, Button, Checkbox, Input, Tabs } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchChannelModels } from "@/services/api/image";
import { channelApiKeyValues, guessCapability, normalizeChannelModels, type ChannelModel, type ModelChannel } from "@/stores/use-config-store";

// Channel model selector rendered as a page inside the config drawer.
// Checking a model writes it to the channel immediately, so there is nothing to confirm.
export function ModelSelectPanel({ channel, onChange }: { channel: ModelChannel; onChange: (models: ChannelModel[]) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [existing] = useState<string[]>(() => channel.models.map((model) => model.name));
    const [fetched, setFetched] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState(channel.models.length ? "existing" : "new");
    const [search, setSearch] = useState("");
    const [manual, setManual] = useState("");
    const [loading, setLoading] = useState(false);

    const selected = useMemo(() => new Set(channel.models.map((model) => model.name)), [channel.models]);
    const knownNames = useMemo(() => [...existing, ...fetched].filter((name, index, list) => list.indexOf(name) === index), [existing, fetched]);

    const currentList = activeTab === "new" ? fetched : existing;
    const visibleList = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return keyword ? currentList.filter((name) => name.toLowerCase().includes(keyword)) : currentList;
    }, [currentList, search]);
    const visibleSelectedCount = visibleList.filter((name) => selected.has(name)).length;

    const applyNames = (names: string[]) => {
        const current = new Map(channel.models.map((model) => [model.name, model]));
        onChange(normalizeChannelModels(names.map((name) => current.get(name) || { name, capability: guessCapability(name) })));
    };

    const applySelection = (next: Set<string>) => applyNames(knownNames.filter((name) => next.has(name)));

    const toggle = (name: string, checked: boolean) => {
        const next = new Set(selected);
        if (checked) next.add(name);
        else next.delete(name);
        applySelection(next);
    };

    const selectVisible = (checked: boolean) => {
        const next = new Set(selected);
        visibleList.forEach((name) => (checked ? next.add(name) : next.delete(name)));
        applySelection(next);
    };

    const addManual = () => {
        const name = manual.trim();
        if (!name) return;
        const nextFetched = fetched.includes(name) || existing.includes(name) ? fetched : [name, ...fetched];
        setFetched(nextFetched);
        setManual("");
        setActiveTab("new");
        applyNames([...existing, ...nextFetched].filter((item, index, list) => list.indexOf(item) === index).filter((item) => item === name || selected.has(item)));
    };

    const fetchModels = async () => {
        if (!channel.baseUrl.trim() || !channelApiKeyValues(channel).length) {
            message.error(t("config.modelSelect.missingConfig"));
            return;
        }
        setLoading(true);
        try {
            const models = await fetchChannelModels(channel);
            setFetched(models);
            setActiveTab("new");
            message.success(t("config.modelSelect.fetched", { count: models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.modelSelect.fetchFailed"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className="mb-3 text-xs text-stone-500">{t("config.modelSelect.selected", { selected: selected.size, total: knownNames.length })}</div>

            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("config.modelSelect.search")} prefix={<Search className="size-4 text-stone-400" />} allowClear />

            <div className="mt-2 flex flex-wrap gap-2">
                <Input className="min-w-[180px] flex-1" value={manual} onChange={(event) => setManual(event.target.value)} onPressEnter={addManual} placeholder={t("config.modelSelect.modelName")} />
                <Button onClick={addManual}>{t("config.modelSelect.add")}</Button>
                <Button type="primary" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void fetchModels()}>
                    {t("config.modelSelect.fetch")}
                </Button>
            </div>

            <div className="mt-2 text-xs text-stone-500">{t("config.modelSelect.description")}</div>

            <Tabs
                className="mt-2"
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    { key: "new", label: t("config.modelSelect.fetchedTab", { count: fetched.length }) },
                    { key: "existing", label: t("config.modelSelect.existingTab", { count: existing.length }) },
                ]}
            />

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-stone-500">{t("config.modelSelect.visibleSelected", { selected: visibleSelectedCount, total: visibleList.length })}</span>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        {t("config.modelSelect.selectVisible")}
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        {t("config.modelSelect.clearVisible")}
                    </Button>
                </div>
            </div>

            {visibleList.length ? (
                <div className="space-y-1.5">
                    {visibleList.map((name) => (
                        <label key={name} className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900">
                            <Checkbox checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)} />
                            <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                                {name}
                            </span>
                        </label>
                    ))}
                </div>
            ) : (
                <div className="py-8 text-center text-sm text-stone-500">{t(activeTab === "new" ? "config.modelSelect.fetchedEmpty" : "config.modelSelect.existingEmpty")}</div>
            )}
        </div>
    );
}
