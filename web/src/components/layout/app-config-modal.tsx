import { App, Button, Drawer, Form, Input, Popconfirm, Progress, Radio, Select, Switch } from "antd";
import type { TFunction } from "i18next";
import { ArrowLeft, BookOpen, ChevronRight, Cloud, Download, ExternalLink, Pencil, Plus, Puzzle, RefreshCw, Trash2, Upload, Wifi, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { videoResolutionOptions } from "@/components/video-settings-panel";
import { ChannelEditorPanel } from "@/components/layout/channel-editor-drawer";
import { ConfigLocalProxy } from "@/components/layout/config-local-proxy";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { DOCS_URL } from "@/constant/env";
import type { AppLocale } from "@/i18n";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaScaleOptions, parseVideoResolution } from "@/lib/media-size";
import {
    channelApiKeyValues,
    createModelChannel,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    resolveChannelApiKey,
    selectableModelsByCapability,
    useConfigStore,
    type AiConfig,
    type ApiCallFormat,
    type ConfigTabKey,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

type WebdavDomainProgress = {
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel() {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const configInputRef = useRef<HTMLInputElement>(null);
    const [expandedTab, setExpandedTab] = useState<ConfigTabKey | null>(null);
    const [editingChannelId, setEditingChannelId] = useState("");
    const draftRef = useRef<{ id: string; snapshot: string } | null>(null);
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const locale = i18n.resolvedLanguage as AppLocale;
    const backLabel = String(i18n.resolvedLanguage || "").startsWith("zh") ? "返回" : "Back";
    const imageResolutionOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? t("settingsPanels.common.auto") : value.toUpperCase() }));
    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: t("config.channels.numberedName", { count: config.channels.length + 1 }) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
        // Snapshot the stored form so leaving without any edit can be detected exactly.
        draftRef.current = { id: channel.id, snapshot: JSON.stringify(useConfigStore.getState().config.channels.find((item) => item.id === channel.id)) };
    };

    // A channel just added here is removed again when left untouched; `keepIfEdited: false` also drops it when only its endpoint changed.
    const discardDraft = (keepIfEdited = true) => {
        const draft = draftRef.current;
        draftRef.current = null;
        const current = useConfigStore.getState().config;
        const channel = draft && current.channels.find((item) => item.id === draft.id);
        if (!draft || !channel || current.channels.length <= 1) return;
        const untouched = JSON.stringify(channel) === draft.snapshot;
        const empty = !channel.models.length && !channel.apiKey.trim() && !channel.apiKeys?.some((item) => item.apiKey.trim());
        if (untouched || (!keepIfEdited && empty)) saveConfig(withChannels(current, current.channels.filter((item) => item.id !== channel.id)));
    };
    const discardDraftRef = useRef(discardDraft);
    discardDraftRef.current = discardDraft;
    // Closing the drawer while a fresh channel is still untouched removes it as well.
    useEffect(() => () => discardDraftRef.current(), []);

    // Switching to a channel with the same domain discards the channel just added here if nothing but its endpoint was filled in.
    const switchChannel = (channelId: string) => {
        discardDraft(false);
        setEditingChannelId(channelId);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.keepOne"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("config.webdav.available"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.webdav.testFailed"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus(t("config.webdav.preparing"));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(t("config.webdav.completed", { projects: result.projects, assets: result.assets, records: result.imageLogs + result.videoLogs, files: result.uploadedFiles, bytes: formatBytes(result.uploadedBytes) }));
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : t("config.webdav.failed"));
            message.error(error instanceof Error ? error.message : t("config.webdav.failed"));
        } finally {
            setSyncingWebdav(false);
        }
    };

    if (editingChannel) {
        return (
            <div>
                <SubViewHeader
                    title={t("config.channelEditor.title")}
                    backLabel={backLabel}
                    onBack={() => {
                        discardDraft();
                        setEditingChannelId("");
                    }}
                />
                <ChannelEditorPanel key={editingChannel.id} channel={editingChannel} onChange={saveChannel} onSwitchChannel={switchChannel} />
            </div>
        );
    }

    const sections: Array<{ key: ConfigTabKey; label: string; children: ReactNode }> = [
        {
            key: "channels",
            label: t("config.tabs.channels"),
            children: (
                <div>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-stone-500">{t("config.channels.description")}</div>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                            {t("config.channels.add")}
                        </Button>
                    </div>
                    <div className="space-y-2">
                        {config.channels.map((channel) => (
                            <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold">{channel.name || t("config.channels.unnamed")}</div>
                                    <div className="mt-1 truncate text-xs text-stone-500">
                                        {apiFormatLabel(channel.apiFormat)} · {t("config.channels.modelCount", { count: channel.models.length })} · {channel.baseUrl || t("config.channels.missingUrl")}
                                    </div>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                        {t("common.edit")}
                                    </Button>
                                    <Popconfirm
                                        placement="topRight"
                                        title={t("config.channels.deleteConfirm", { name: channel.name || t("config.channels.unnamed") })}
                                        okText={t("common.delete")}
                                        okButtonProps={{ danger: true }}
                                        cancelText={t("common.cancel")}
                                        disabled={config.channels.length <= 1}
                                        onConfirm={() => deleteChannel(channel.id)}
                                    >
                                        {/* With a single channel the confirm is disabled and the click shows the keep-one warning instead. */}
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={config.channels.length <= 1 ? () => deleteChannel(channel.id) : undefined} />
                                    </Popconfirm>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ),
        },
        {
            key: "local-proxy",
            label: t("config.tabs.localProxy"),
            children: <ConfigLocalProxy />,
        },
        {
            key: "preferences",
            label: t("config.tabs.preferences"),
            children: (
                <Form layout="vertical" requiredMark={false}>
                    <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}</div>
                    <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {modelGroups.map((group) => (
                            <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                                <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                            </Form.Item>
                        ))}
                    </div>
                    <div className="mb-2 text-sm font-semibold">{t("config.preferences.generation")}</div>
                    <div className="grid gap-4 md:grid-cols-4">
                        <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                            <Input
                                type="number"
                                min={1}
                                max={15}
                                value={config.canvasImageCount}
                                onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                            />
                        </Form.Item>
                        <Form.Item label={t("config.preferences.imageResolution")} className="mb-4">
                            <Select value={inferMediaScale(config.size)} options={imageResolutionOptions} onChange={(scale) => updateConfig("size", computeMediaSize(scale, inferMediaRatio(config.size)))} />
                        </Form.Item>
                        <Form.Item label={t("config.preferences.videoResolution")} className="mb-4">
                            <Select value={parseVideoResolution(config.vquality)} options={videoResolutionOptions} onChange={(value) => updateConfig("vquality", value)} />
                        </Form.Item>
                        <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                            <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                        </Form.Item>
                        <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                            <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                        </Form.Item>
                        <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                            <Input
                                type="number"
                                min={0.25}
                                max={4}
                                step={0.05}
                                value={config.audioSpeed}
                                onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item label={t("config.preferences.regenerateBehavior")} className="mb-4">
                        <Radio.Group value={config.nodeRegenerateBehavior} onChange={(event) => updateConfig("nodeRegenerateBehavior", event.target.value)} className="flex flex-col gap-2">
                            <Radio value="overwrite">
                                <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorOverwrite")}</span>
                                <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorOverwriteDescription")}</span>
                            </Radio>
                            <Radio value="new-node">
                                <span className="block text-sm font-medium">{t("config.preferences.regenerateBehaviorNewNode")}</span>
                                <span className="mt-0.5 block text-xs opacity-60">{t("config.preferences.regenerateBehaviorNewNodeDescription")}</span>
                            </Radio>
                        </Radio.Group>
                    </Form.Item>
                    <Form.Item className="mb-4">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm">{t("config.preferences.autoFocusOnSelect")}</span>
                            <Switch checked={config.autoFocusOnSelect} onChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
                        </div>
                    </Form.Item>
                    <Form.Item label={t("config.preferences.audioInstructions")} className="mb-4">
                        <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                        <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                    </Form.Item>
                    <div className="mt-5 border-t border-stone-200 pt-4 dark:border-stone-800">
                        <div className="mb-2 text-sm font-semibold">{t("config.preferences.canvasTools")}</div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                icon={<Puzzle className="size-4" />}
                                onClick={() => {
                                    setConfigDialogOpen(false);
                                    window.dispatchEvent(new Event("canvas-open-plugin-manager"));
                                }}
                            >
                                {t("topNav.plugins")}
                            </Button>
                            <Button href={DOCS_URL} target="_blank" icon={<BookOpen className="size-4" />}>
                                {t("topNav.docs")}
                                <ExternalLink className="ml-1 size-3.5 opacity-55" />
                            </Button>
                        </div>
                    </div>
                </Form>
            ),
        },
        {
            key: "prompt-sources",
            label: t("config.tabs.promptSources"),
            children: <ConfigPromptSources />,
        },
        {
            key: "webdav",
            label: "WebDAV",
            children: (
                <Form layout="vertical" requiredMark={false}>
                    <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-semibold">
                                    <Cloud className="size-4" />
                                    {t("config.webdav.title")}
                                </div>
                                <div className="mt-1 text-xs text-stone-500">{t("config.webdav.description")}</div>
                            </div>
                            <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? t("config.webdav.lastSynced", { time: formatWebdavTime(webdav.lastSyncedAt, locale) }) : t("config.webdav.neverSynced")}</div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Form.Item label={t("config.webdav.url")} className="mb-4">
                                <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                            </Form.Item>
                            <Form.Item label={t("config.webdav.directory")} extra={t("config.webdav.directoryDescription", { manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
                                <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                            </Form.Item>
                            <Form.Item label={t("config.webdav.username")} className="mb-0">
                                <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                            </Form.Item>
                            <Form.Item label={t("config.webdav.password")} className="mb-0">
                                <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                            </Form.Item>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                {t("config.webdav.test")}
                            </Button>
                            <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                {t(syncingWebdav ? "config.webdav.syncing" : "config.webdav.syncNow")}
                            </Button>
                            {webdavSyncStatus ? <span className="text-xs text-stone-500">{syncStageLabel(webdavSyncStatus, t)}</span> : null}
                        </div>
                        {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} t={t} /> : null}
                    </section>
                </Form>
            ),
        },
        {
            key: "local-storage",
            label: t("config.tabs.localStorage"),
            children: <ConfigLocalStorage active={expandedTab === "local-storage"} />,
        },
    ];

    return (
        <div className="flex min-h-full flex-1 flex-col">
            <div className="divide-y divide-stone-200 dark:divide-stone-800">
                {sections.map((section) => {
                    const expanded = expandedTab === section.key;
                    return (
                        <div key={section.key}>
                            <button
                                type="button"
                                aria-expanded={expanded}
                                onClick={() => setExpandedTab(expanded ? null : section.key)}
                                className="group relative flex w-full items-center justify-between gap-3 py-4 pl-3 pr-1 text-left text-sm outline-none"
                            >
                                <span
                                    className={`pointer-events-none absolute inset-y-0.5 left-0 w-[3px] rounded-full bg-stone-900 transition-all duration-200 dark:bg-white ${expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
                                    aria-hidden
                                />
                                <span
                                    className={`pointer-events-none absolute inset-y-0.5 left-0 right-0 -z-10 rounded-md bg-stone-500/0 transition-colors duration-200 ${expanded ? "" : "group-hover:bg-stone-500/[0.07] group-focus-visible:bg-stone-500/[0.07]"}`}
                                    aria-hidden
                                />
                                <span
                                    className={`font-medium transition-all duration-200 ${expanded ? "translate-x-1 text-stone-950 dark:text-white" : "text-stone-600 group-hover:translate-x-1 group-hover:text-stone-950 group-focus-visible:translate-x-1 dark:text-stone-400 dark:group-hover:text-white dark:group-focus-visible:text-white"}`}
                                >
                                    {section.label}
                                </span>
                                <ChevronRight
                                    className={`size-4 shrink-0 transition-all duration-200 ${expanded ? "rotate-90 text-stone-950 dark:text-white" : "text-stone-400 group-hover:-translate-x-0.5 group-hover:text-stone-950 dark:group-hover:text-white"}`}
                                />
                            </button>
                            {expanded ? <div className="pb-6 pl-3 pr-1 pt-1">{section.children}</div> : null}
                        </div>
                    );
                })}
            </div>

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pb-2 pt-10">
                <div className="text-xs text-stone-500">{t("config.fileSecurity")}</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>
                        {t("config.import")}
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={exportAppConfig}>
                        {t("config.export")}
                    </Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
        </div>
    );
}

function SubViewHeader({ title, backLabel, onBack }: { title: string; backLabel: string; onBack: () => void }) {
    return (
        <div className="mb-5 flex items-center gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
            <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
                {backLabel}
            </Button>
            <span className="text-sm font-semibold">{title}</span>
        </div>
    );
}

const CONFIG_DRAWER_WIDTH_KEY = "infinite-canvas-config-drawer-width";
const CONFIG_DRAWER_MIN_WIDTH = 420;
const CONFIG_DRAWER_MAX_WIDTH = 1100;
const CONFIG_DRAWER_DEFAULT_WIDTH = 560;

function clampDrawerWidth(width: number) {
    const max = typeof window === "undefined" ? CONFIG_DRAWER_MAX_WIDTH : Math.min(CONFIG_DRAWER_MAX_WIDTH, window.innerWidth);
    return Math.round(Math.max(Math.min(CONFIG_DRAWER_MIN_WIDTH, max), Math.min(width, max)));
}

function readStoredDrawerWidth() {
    try {
        const stored = Number(window.localStorage.getItem(CONFIG_DRAWER_WIDTH_KEY));
        if (Number.isFinite(stored) && stored > 0) return clampDrawerWidth(stored);
    } catch {
        // Private mode or blocked storage: fall back to the default width.
    }
    return clampDrawerWidth(CONFIG_DRAWER_DEFAULT_WIDTH);
}

export function AppConfigModal() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [drawerWidth, setDrawerWidth] = useState(CONFIG_DRAWER_DEFAULT_WIDTH);
    const widthRef = useRef(CONFIG_DRAWER_DEFAULT_WIDTH);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const channels = useConfigStore((state) => state.config.channels);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);

    const applyWidth = useCallback((width: number) => {
        const next = clampDrawerWidth(width);
        widthRef.current = next;
        setDrawerWidth(next);
        return next;
    }, []);

    useEffect(() => {
        applyWidth(readStoredDrawerWidth());
    }, [applyWidth]);

    // Keep the drawer usable when the viewport shrinks below the stored width.
    useEffect(() => {
        const onResize = () => applyWidth(widthRef.current);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [applyWidth]);

    // Drag the drawer edge to resize; the chosen width is remembered across sessions.
    const resizable = useMemo(
        () => ({
            onResize: (size: number) => applyWidth(size),
            onResizeEnd: () => {
                try {
                    window.localStorage.setItem(CONFIG_DRAWER_WIDTH_KEY, String(widthRef.current));
                } catch {
                    // Storage unavailable: the width still applies for this session.
                }
            },
        }),
        [applyWidth],
    );

    // Config is written to the store as it is edited, so closing the drawer only reports the "ready to continue" state.
    const closeConfig = () => {
        setConfigDialogOpen(false);
        if (!shouldPromptContinue) return;
        if (channels.some((channel) => channel.baseUrl.trim() && channelApiKeyValues(channel).length && channel.models.length)) message.success(t("config.savedContinue"));
        clearPromptContinue();
    };

    return (
        <Drawer
            title={
                <div>
                    <div className="text-lg font-semibold">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("config.modalDescription")}</div>
                </div>
            }
            open={isConfigOpen}
            placement="right"
            size={drawerWidth}
            resizable={resizable}
            onClose={closeConfig}
            closable={false}
            extra={<Button type="text" shape="circle" icon={<X className="size-4" />} aria-label={t("canvas.createMenu.close")} onClick={closeConfig} />}
            styles={{ body: { paddingTop: 20, display: "flex", flexDirection: "column", scrollbarWidth: "none" } }}
            footer={null}
        >
            <AppConfigPanel key={isConfigOpen ? "config-open" : "config-closed"} />
        </Drawer>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0] ? resolveChannelApiKey(channels[0]) : config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    return "OpenAI";
}

function formatWebdavTime(value: string, locale: AppLocale) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress, t }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress>; t: TFunction }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t(`config.webdav.domains.${domainTranslationKey(key)}`)}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {syncStageLabel(item.stage, t)}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function domainTranslationKey(domain: AppSyncDomainKey) {
    if (domain === "image-workbench") return "imageWorkbench";
    if (domain === "video-workbench") return "videoWorkbench";
    return domain;
}

function syncStageLabel(stage: string, t: TFunction) {
    if (stage === "等待本地数据加载") return t("config.webdav.stages.localWaiting");
    if (stage === "同步完成") return t("config.webdav.stages.syncComplete");
    if (stage === "等待同步") return t("config.webdav.stages.waiting");
    if (stage === "读取远端清单") return t("config.webdav.stages.remoteManifest");
    if (stage === "读取本地数据") return t("config.webdav.stages.localData");
    if (stage === "下载缺失媒体") return t("config.webdav.stages.downloadMedia");
    if (stage === "写入本地合并结果") return t("config.webdav.stages.writeMerge");
    if (stage === "上传新增媒体") return t("config.webdav.stages.uploadMedia");
    if (stage === "媒体已齐全") return t("config.webdav.stages.mediaReady");
    if (stage === "媒体无需上传") return t("config.webdav.stages.mediaSkipped");
    if (stage === "检查缺失媒体") return t("config.webdav.stages.checkMissingMedia");
    if (stage === "下载媒体") return t("config.webdav.stages.downloadMediaFile");
    if (stage === "检查本地媒体") return t("config.webdav.stages.checkLocalMedia");
    if (stage.startsWith("上传媒体 ")) return t("config.webdav.stages.uploadMediaFile", { size: stage.slice(5) });
    if (stage === "完成") return t("config.webdav.stages.complete");
    if (stage.startsWith("上传清单 ")) return t("config.webdav.stages.uploadManifest", { size: stage.slice(5) });
    return stage;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
