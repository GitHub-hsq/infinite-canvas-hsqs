import { Button, Checkbox, Input, Popconfirm, Segmented, Select, Switch, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Eye, EyeOff, KeyRound, ListPlus, Trash2 } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { channelApiKeySuffix, createChannelApiKey, defaultBaseUrlForApiFormat, useConfigStore, type ApiCallFormat, type ChannelApiKey, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

// Channel editor: every change is written straight to the config store, so there is no save step.
export function ChannelEditorPanel({ channel, onChange, onPickModels, onSwitchChannel }: { channel: ModelChannel; onChange: (channel: ModelChannel) => void; onPickModels: () => void; onSwitchChannel: (channelId: string) => void }) {
    const { t } = useTranslation();
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [duplicate, setDuplicate] = useState<ModelChannel | null>(null);
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
    const updateApiKey = (id: string, value: Partial<ChannelApiKey>) => setApiKeys(apiKeys.map((item) => (item.id === id ? { ...item, ...value } : item)));
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
                        {apiKeys.map((item, index) => (
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
                                        <SecretInput value={item.apiKey} onChange={(apiKey) => updateApiKey(item.id, { apiKey })} />
                                    </label>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <span className="text-xs text-stone-500">{t("config.channelEditor.apiKeyCapabilities")}</span>
                                    <Checkbox.Group value={item.capabilities} options={capabilityOptions} onChange={(capabilities) => updateApiKey(item.id, { capabilities: capabilities as ModelCapability[] })} />
                                </div>
                                <div className="mt-2 text-xs text-stone-500">
                                    {item.enabled === false
                                        ? t("config.channelEditor.apiKeyDisabledHint")
                                        : primaryCapabilities(item).length
                                          ? t("config.channelEditor.apiKeyPrimaryFor", { capabilities: primaryCapabilities(item).join(t("config.channelEditor.capabilitySeparator")) })
                                          : t("config.channelEditor.apiKeyStandbyHint")}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 text-xs text-stone-500">{t("config.channelEditor.apiKeyOrderHint")}</div>
                </div>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: channel.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={onPickModels}>
                    {t("config.channelEditor.selectModels")}
                </Button>
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
function SecretInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const [visible, setVisible] = useState(false);
    const maskedStyle = { WebkitTextSecurity: visible ? "none" : "disc" } as CSSProperties;
    return (
        <div className="relative">
            <Input
                className="pr-10"
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="sk-..."
                style={maskedStyle}
                autoComplete="off"
                name="canvas-provider-key"
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
