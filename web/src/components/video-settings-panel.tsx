import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Slider } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN } from "@/lib/media-size";
import { type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
    { value: "2160", label: "4K" },
];
const ratioOptions = [
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:4", width: 3, height: 4 },
    { value: "21:9", width: 21, height: 9 },
] as const;
const videoModeOptions = [
    { value: "frames", labelKey: "frames" },
    { value: "reference", labelKey: "reference" },
];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = ratioOptions.map((item) => ({ value: item.value, label: item.value }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const seconds = Number(clampVideoSeconds(config.videoSeconds || "15"));
    const videoMode = normalizeVideoModeValue(config.videoMode);
    const resolution = parseVideoResolution(config.vquality);
    const selectedRatio = inferVideoRatio(config.size || "16:9");
    const selectResolution = (nextResolution: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", computeVideoSize(nextResolution, selectedRatio));
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-base font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <DurationTimeline seconds={seconds} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.text}>
                    <div className="grid grid-cols-4 gap-1.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.text}>
                    <div className="grid grid-cols-5 gap-1.5">
                        {ratioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[58px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-[11px] transition duration-150 hover:!bg-black/10 hover:shadow-sm active:scale-[0.98] dark:hover:!bg-white/15"
                                style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", computeVideoSize(resolution, item.value))}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.text}>
                    <div className="grid grid-cols-2 gap-1.5">
                        {videoModeOptions.map((item) => (
                            <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                {t(`settingsPanels.video.modes.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    const resolution = parseVideoResolution(value);
    return resolution === "2160" ? "4K" : `${resolution}p`;
}

export function videoSizeLabel(value: string) {
    return inferVideoRatio(value);
}

export function videoSecondsLabel(value: string) {
    return `${clampVideoSeconds(value || "15")}s`;
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "frames" ? "frames" : "reference";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    return computeVideoSize(resolution, ratio === "auto" ? "16:9" : ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

const DEFAULT_TIMELINE_MAX = 16;

function DurationTimeline({ seconds, theme, onChange }: { seconds: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const [expanded, setExpanded] = useState(seconds > DEFAULT_TIMELINE_MAX);
    const dragLockedRef = useRef(false);
    const max = expanded ? VIDEO_SECONDS_MAX : DEFAULT_TIMELINE_MAX;

    useEffect(() => {
        const unlockDrag = () => {
            dragLockedRef.current = false;
        };
        window.addEventListener("pointerup", unlockDrag);
        window.addEventListener("pointercancel", unlockDrag);
        return () => {
            window.removeEventListener("pointerup", unlockDrag);
            window.removeEventListener("pointercancel", unlockDrag);
        };
    }, []);

    const marks = useMemo(
        () =>
            Object.fromEntries(
                Array.from({ length: max - VIDEO_SECONDS_MIN + 1 }, (_, index) => VIDEO_SECONDS_MIN + index)
                    .filter((value) => (expanded ? value % 5 === 0 : value % 2 === 0 || value === seconds))
                    .map((value) => [
                        value,
                        {
                            label: (
                                <button
                                    type="button"
                                    className={`cursor-pointer border-0 bg-transparent p-0 ${value === seconds ? "text-sm font-semibold" : "text-xs font-medium opacity-60"}`}
                                    style={{ color: theme.node.text }}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={() => {
                                        if (!expanded && value >= DEFAULT_TIMELINE_MAX) setExpanded(true);
                                        onChange(value);
                                    }}
                                >
                                    {value}s
                                </button>
                            ),
                        },
                    ]),
            ),
        [expanded, max, onChange, seconds, theme.node.text],
    );

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between font-semibold">
                <span>{i18n.t("settingsPanels.video.seconds")}</span>
                <span className="text-[11px]">{seconds}s</span>
            </div>
            <div className="h-[58px] px-2 pt-1">
                <Slider
                    min={VIDEO_SECONDS_MIN}
                    max={max}
                    step={1}
                    value={seconds}
                    marks={marks}
                    tooltip={{ open: false }}
                    onChange={(value) => {
                        if (dragLockedRef.current) return;
                        if (!expanded && value >= DEFAULT_TIMELINE_MAX) {
                            dragLockedRef.current = true;
                            setExpanded(true);
                            onChange(DEFAULT_TIMELINE_MAX);
                            return;
                        }
                        onChange(value);
                    }}
                    onChangeComplete={() => {
                        dragLockedRef.current = false;
                    }}
                    styles={{ rail: { background: theme.node.stroke }, track: { background: theme.node.text }, handle: { color: theme.node.text } }}
                />
            </div>
        </div>
    );
}
function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-xl border bg-transparent px-2 text-sm transition duration-150 hover:!bg-black/10 hover:shadow-sm active:scale-[0.98] dark:hover:!bg-white/15"
            style={{ borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="text-xs font-semibold" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(8, Math.round((width / longSide) * 22));
    const previewHeight = Math.max(8, Math.round((height / longSide) * 22));
    return <span className="rounded-[2px] border" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
