import { App, Button, Checkbox, Input, Popconfirm, Segmented, Select, Switch, Tabs, Tooltip, type InputRef } from "antd";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, KeyRound, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { fetchImageModels } from "@/services/api/image";
import { channelApiKeySuffix, createChannelApiKey, defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, useConfigStore, withResolvedApiKeyContext, type ApiCallFormat, type ChannelApiKey, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

// Channel editor: every change is written straight to the config store, so there is no save step.
export function ChannelEditorPanel({ channel, onChange, onSwitchChannel }: { channel: ModelChannel; onChange: (channel: ModelChannel) => void; onSwitchChannel: (channelId: string) => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [duplicate, setDuplicate] = useState<ModelChannel | null>(null);
    const [modelPanelKeyId, setModelPanelKeyId] = useState<string | null>(null);
    const [fetchedByKey, setFetchedByKey] = useState<Record<string, string[]>>({});
    const [keyInputSyncTick, setKeyInputSyncTick] = useState(0);
    const focusedBaseUrlRef = useRef(channel.baseUrl);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    const patch = (value: Partial<ModelChannel>) => onChange({ ...channel, ...value });
    const setModels = (models: ChannelModel[]) => patch({ models });
    const apiKeys = channel.apiKeys?.length ? channel.apiKeys : [createChannelApiKey({ name: "Key 1", apiKey: channel.apiKey })];
    const setApiKeys = (items: ChannelApiKey[]) => patch({ apiKeys: items, apiKey: items.find((item) => item.enabled !== false && item.apiKey.trim())?.apiKey || "" });
    const updateApiKey = (id: string, value: Partial<ChannelApiKey>) => {
        // Identical keys are never allowed: they would fake a second account with the same quota.
        if (value.apiKey !== undefined && value.apiKey.trim()) {
            const next = value.apiKey.trim();
            const clash = apiKeys.find((item) => item.id !== id && item.apiKey.trim() === next);
            if (clash) {
                message.warning({
                    content: t("config.channelEditor.apiKeyDuplicateBlocked", { name: clash.name.trim() || t("config.channelEditor.apiKeyName", { index: apiKeys.indexOf(clash) + 1 }) }),
                    key: "duplicate-api-key",
                });
                // No state change would leave the typed value in the DOM; bump a tick so the field resyncs.
                setKeyInputSyncTick((tick) => tick + 1);
                return;
            }
        }
        setApiKeys(apiKeys.map((item) => (item.id === id ? { ...item, ...value } : item)));
    };
    const removeApiKey = (id: string) => setApiKeys(apiKeys.filter((item) => item.id !== id));
    const addApiKey = () => setApiKeys([...apiKeys, createChannelApiKey({ name: `Key ${apiKeys.length + 1}` })]);
    const moveApiKey = (index: number, offset: -1 | 1) => {
        const target = index + offset;
        if (target < 0 || target >= apiKeys.length) return;
        const next = [...apiKeys];
        [next[index], next[target]] = [next[target], next[index]];
        setApiKeys(next);
    };
    const primaryCapabilities = (item: ChannelApiKey) =>
        capabilityOptions
            .filter(
                ({ value }) =>
                    item.enabled !== false &&
                    Boolean(item.apiKey.trim()) &&
                    item.capabilities.includes(value) &&
                    apiKeys.find((candidate) => candidate.enabled !== false && candidate.apiKey.trim() && candidate.capabilities.includes(value))?.id === item.id,
            )
            .map(({ label }) => label);

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(channel.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(channel.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(channel.models.filter((model) => model.name !== name));

    // After the endpoint is edited, offer to jump to an existing channel that already uses the same domain.
    const checkDuplicateBaseUrl = () => {
        if (channel.baseUrl === focusedBaseUrlRef.current) return;
        focusedBaseUrlRef.current = channel.baseUrl;
        const host = channelHost(channel.baseUrl);
        setDuplicate(host ? useConfigStore.getState().config.channels.find((item) => item.id !== channel.id && channelHost(item.baseUrl) === host) || null : null);
    };

    return (
        <div>
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={channel.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={channel.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Popconfirm
                        open={Boolean(duplicate)}
                        placement="bottomLeft"
                        title={t("config.channelEditor.duplicateTitle")}
                        description={duplicate ? t("config.channelEditor.duplicateContent", { host: channelHost(duplicate.baseUrl), name: duplicate.name || t("config.channels.unnamed") }) : null}
                        okText={t("config.channelEditor.duplicateSwitch")}
                        cancelText={t("config.channelEditor.duplicateStay")}
                        onConfirm={() => duplicate && onSwitchChannel(duplicate.id)}
                        onCancel={() => setDuplicate(null)}
                        onOpenChange={(open) => !open && setDuplicate(null)}
                    >
                        <Input
                            value={channel.baseUrl}
                            onChange={(event) => patch({ baseUrl: event.target.value })}
                            onFocus={() => (focusedBaseUrlRef.current = channel.baseUrl)}
                            onBlur={checkDuplicateBaseUrl}
                            placeholder="https://api.example.com"
                            autoComplete="off"
                            name="canvas-provider-endpoint"
                            data-form-type="other"
                        />
                    </Popconfirm>
                </label>
                <div className="md:col-span-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{t("config.channelEditor.apiKeys")}</span>
                        <Button size="small" type="text" icon={<KeyRound className="size-3.5" />} onClick={addApiKey}>
                            {t("config.channelEditor.addApiKey")}
                        </Button>
                    </div>
                    <div className="space-y-2">
                        {apiKeys.map((item, index) => {
                            const duplicateNames = item.apiKey.trim()
                                ? apiKeys
                                      .filter((other) => other.id !== item.id && other.apiKey.trim() && other.apiKey.trim() === item.apiKey.trim())
                                      .map((other) => other.name.trim() || t("config.channelEditor.apiKeyName", { index: apiKeys.indexOf(other) + 1 }))
                                : [];
                            return (
            <div key={item.id} className={`rounded-lg border p-3 ${item.enabled === false ? "border-stone-200 bg-stone-50/60 opacity-70 dark:border-stone-800 dark:bg-stone-900/30" : "border-stone-200 dark:border-stone-800"}`}>
                                <div className="mb-3 flex min-w-0 items-center gap-2">
                                    <Switch size="small" checked={item.enabled !== false} onChange={(enabled) => updateApiKey(item.id, { enabled })} aria-label={t("config.channelEditor.apiKeyEnabled")} />
                                    <div className="min-w-0 flex-1 truncate text-sm font-medium">
                                        {item.name.trim() || t("config.channelEditor.apiKeyName", { index: index + 1 })}
                                        {item.apiKey.trim() ? <span className="ml-2 font-normal text-stone-400">{t("config.channelEditor.apiKeySuffix", { suffix: channelApiKeySuffix(item.apiKey) })}</span> : null}
                                    </div>
                                    <Tooltip title={t("config.channelEditor.moveApiKeyUp")}>
                                        <Button size="small" type="text" disabled={index === 0} icon={<ArrowUp className="size-3.5" />} aria-label={t("config.channelEditor.moveApiKeyUp")} onClick={() => moveApiKey(index, -1)} />
                                    </Tooltip>
                                    <Tooltip title={t("config.channelEditor.moveApiKeyDown")}>
                                        <Button size="small" type="text" disabled={index === apiKeys.length - 1} icon={<ArrowDown className="size-3.5" />} aria-label={t("config.channelEditor.moveApiKeyDown")} onClick={() => moveApiKey(index, 1)} />
                                    </Tooltip>
                                    <Tooltip title={t("common.delete")}>
                                        <Button size="small" danger type="text" disabled={apiKeys.length <= 1} icon={<Trash2 className="size-3.5" />} aria-label={t("common.delete")} onClick={() => removeApiKey(item.id)} />
                                    </Tooltip>
                                </div>
                                <div className="grid gap-3 md:grid-cols-[minmax(140px,0.7fr)_minmax(220px,1.3fr)]">
                                    <label className="block min-w-0">
                                        <span className="mb-1 block text-xs text-stone-500">{t("config.channelEditor.apiKeyAccount")}</span>
                                        <Input value={item.name} onChange={(event) => updateApiKey(item.id, { name: event.target.value })} placeholder={t("config.channelEditor.apiKeyAccountPlaceholder")} />
                                    </label>
                                    <label className="block min-w-0">
                                        <span className="mb-1 block text-xs text-stone-500">API Key</span>
                                        <SecretInput value={item.apiKey} fieldName={`canvas-provider-key-${index + 1}`} syncTick={keyInputSyncTick} onChange={(apiKey) => updateApiKey(item.id, { apiKey })} />
                                    </label>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <span className="text-xs text-stone-500">{t("config.channelEditor.apiKeyCapabilities")}</span>
                                    <Checkbox.Group value={item.capabilities} options={capabilityOptions} onChange={(capabilities) => updateApiKey(item.id, { capabilities: capabilities as ModelCapability[] })} />
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1 text-xs text-stone-500">
                                        {duplicateNames.length ? (
                                            <div className="mb-1 font-medium text-amber-600 dark:text-amber-500">{t("config.channelEditor.apiKeyDuplicateHint", { names: duplicateNames.join(t("config.channelEditor.capabilitySeparator")) })}</div>
                                        ) : null}
                                        {item.enabled === false
                                            ? t("config.channelEditor.apiKeyDisabledHint")
                                            : primaryCapabilities(item).length
                                              ? t("config.channelEditor.apiKeyPrimaryFor", { capabilities: primaryCapabilities(item).join(t("config.channelEditor.capabilitySeparator")) })
                                              : t("config.channelEditor.apiKeyStandbyHint")}
                                    </div>
                                    <Button size="small" type="text" onClick={() => setModelPanelKeyId((current) => (current === item.id ? null : item.id))}>
                                        <ChevronDown className={`size-3.5 transition-transform ${modelPanelKeyId === item.id ? "rotate-180" : ""}`} />
                                        {t("config.channelEditor.fetchModels")}
                                    </Button>
                                </div>
                                {modelPanelKeyId === item.id ? (
                                    <KeyModelPanel
                                        channel={channel}
                                        apiKeyName={item.name.trim() || t("config.channelEditor.apiKeyName", { index: index + 1 })}
                                        apiKeyValue={item.apiKey}
                                        canFetch={item.enabled !== false && Boolean(item.apiKey.trim()) && Boolean(channel.baseUrl.trim())}
                                        fetched={fetchedByKey[item.id] || []}
                                        onFetched={(models) => setFetchedByKey((prev) => ({ ...prev, [item.id]: models }))}
                                        onChange={setModels}
                                    />
                                ) : null}
                            </div>
                            );
                        })}
                    </div>
                    <div className="mt-2 text-xs text-stone-500">{t("config.channelEditor.apiKeyOrderHint")}</div>
                </div>
            </div>

            <div className="mt-6 mb-3">
                <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: channel.models.length })}</div>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {channel.models.length ? (
                    channel.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </div>
    );
}

// Compare channels by host (domain plus port); a missing scheme is treated as https.
function channelHost(baseUrl: string) {
    const value = baseUrl.trim();
    if (!value) return "";
    try {
        return new URL(value.includes("://") ? value : `https://${value}`).host;
    } catch {
        return "";
    }
}

// A plain text input with CSS masking instead of type="password": Chrome no longer treats it as a
// credential field, so it stops offering to save the API key in the password manager.
// Each key card passes its own field name so the browser cannot backfill one card's value into another.
function SecretInput({ value, onChange, fieldName, syncTick }: { value: string; onChange: (value: string) => void; fieldName: string; syncTick: number }) {
    const [visible, setVisible] = useState(false);
    const inputRef = useRef<InputRef>(null);
    // A rejected duplicate leaves the DOM value ahead of the controlled value; pull the field back in sync.
    useEffect(() => {
        const input = inputRef.current?.input;
        if (input && input.value !== value) input.value = value;
        // Runs when the parent rejects an edit (syncTick bump); value is read at that moment on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syncTick]);
    // Inline end padding for the eye button: antd v6's own .ant-input padding outranks Tailwind utilities, so a pr-* class is ignored here.
    const maskedStyle = { WebkitTextSecurity: visible ? "none" : "disc", paddingInlineEnd: 40 } as CSSProperties;
    return (
        <div className="relative">
            <Input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="sk-..."
                style={maskedStyle}
                autoComplete="off"
                name={fieldName}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore
            />
            <button
                type="button"
                className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-stone-400 transition hover:text-stone-600 dark:hover:text-stone-200"
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? "Hide API key" : "Show API key"}
                title={visible ? "Hide" : "Show"}
            >
                {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
        </div>
    );
}

// Inline per-key model manager: fetch the upstream list with just this key, search it, add names
// manually, and check models into the channel list. Checking writes immediately, like the old page.
function KeyModelPanel({ channel, apiKeyName, apiKeyValue, canFetch, fetched, onFetched, onChange }: { channel: ModelChannel; apiKeyName: string; apiKeyValue: string; canFetch: boolean; fetched: string[]; onFetched: (models: string[]) => void; onChange: (models: ChannelModel[]) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    // Snapshot of the models present when the panel opened: unchecking must keep the name listable for re-checking.
    const [existing] = useState<string[]>(() => channel.models.map((model) => model.name));
    const [search, setSearch] = useState("");
    const [manual, setManual] = useState("");
    const [activeTab, setActiveTab] = useState<"new" | "existing">(channel.models.length ? "existing" : "new");

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
        onFetched(nextFetched);
        setManual("");
        setActiveTab("new");
        applyNames([...existing, ...nextFetched].filter((item, index, list) => list.indexOf(item) === index).filter((item) => item === name || selected.has(item)));
    };
    const fetchList = async () => {
        const apiKey = apiKeyValue.trim();
        if (!channel.baseUrl.trim() || !apiKey) {
            message.error(t("config.channelEditor.fetchModelsMissing"));
            return;
        }
        setLoading(true);
        try {
            const names = await fetchImageModels({ baseUrl: channel.baseUrl, apiKey, apiFormat: channel.apiFormat, proxyMode: channel.proxyMode });
            onFetched(names);
            setActiveTab("new");
            message.success(t("config.channelEditor.fetchedCount", { count: names.length }));
        } catch (error) {
            const text = error instanceof Error ? error.message : t("config.channelEditor.fetchModelsFailed");
            message.error(withResolvedApiKeyContext(text, { resolvedChannelName: channel.name, resolvedApiKeyName: apiKeyName, resolvedApiKeySuffix: channelApiKeySuffix(apiKey) }));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mt-3 max-h-[420px] overflow-y-auto rounded-lg border border-stone-200 bg-stone-50/60 p-3 thin-scrollbar dark:border-stone-800 dark:bg-stone-900/40">
            <div className="mb-3 text-xs text-stone-500">{t("config.channelEditor.modelSelected", { selected: selected.size, total: knownNames.length })}</div>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("config.channelEditor.modelSearch")} prefix={<Search className="size-4 text-stone-400" />} allowClear />
            <div className="mt-2 flex flex-wrap gap-2">
                <Input className="min-w-[160px] flex-1" value={manual} onChange={(event) => setManual(event.target.value)} onPressEnter={addManual} placeholder={t("config.channelEditor.modelNamePlaceholder")} />
                <Button onClick={addManual}>{t("config.channelEditor.addModel")}</Button>
                <Button type="primary" icon={<RefreshCw className="size-4" />} loading={loading} disabled={!canFetch} onClick={() => void fetchList()}>
                    {t("config.channelEditor.fetchModelList")}
                </Button>
            </div>
            <div className="mt-2 text-xs text-stone-500">{t("config.channelEditor.modelManualHint")}</div>
            <Tabs
                className="mt-1"
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as "new" | "existing")}
                items={[
                    { key: "new", label: t("config.channelEditor.fetchedTab", { count: fetched.length }) },
                    { key: "existing", label: t("config.channelEditor.existingTab", { count: existing.length }) },
                ]}
            />
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-stone-500">{t("config.channelEditor.visibleSelected", { selected: visibleSelectedCount, total: visibleList.length })}</span>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        {t("config.channelEditor.selectVisible")}
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        {t("config.channelEditor.clearVisible")}
                    </Button>
                </div>
            </div>
            {visibleList.length ? (
                <div className="space-y-1.5">
                    {visibleList.map((name) => (
                        <label key={name} className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-900/60">
                            <Checkbox checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)} />
                            <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                                {name}
                            </span>
                        </label>
                    ))}
                </div>
            ) : (
                <div className="py-6 text-center text-sm text-stone-500">{t(activeTab === "new" ? "config.channelEditor.fetchedEmpty" : "config.channelEditor.existingEmpty")}</div>
            )}
        </div>
    );
}
