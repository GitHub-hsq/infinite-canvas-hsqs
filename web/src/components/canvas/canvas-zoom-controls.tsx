import { Columns2, Compass } from "lucide-react";
import { Button, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasZoomControls({ isMiniMapOpen, onToggleMiniMap, onOpenCompare, compareCount }: { isMiniMapOpen: boolean; onToggleMiniMap: () => void; onOpenCompare: () => void; compareCount: number }) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    return (
        <div className="absolute bottom-5 left-5 z-50 flex items-center" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Tooltip
                title={`${t("canvas.compare.title")}${compareCount ? ` · ${t("canvas.compare.libraryCount", { count: compareCount })}` : ""}`}
                color={colorTheme === "dark" ? "#292524" : "#ffffff"}
                styles={{ root: { color: colorTheme === "dark" ? "#ffffff" : "#1c1917", fontWeight: 500 } }}
            >
                <Button
                    type="text"
                    className="!h-12 !w-12 !min-w-12 !border-0 !bg-transparent !p-0 !shadow-none"
                    style={{ color: theme.toolbar.item }}
                    icon={<Columns2 className="size-6" />}
                    onClick={onOpenCompare}
                    aria-label={t("canvas.compare.title")}
                />
            </Tooltip>
            <Tooltip
                title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                color={colorTheme === "dark" ? "#292524" : "#ffffff"}
                styles={{ root: { color: colorTheme === "dark" ? "#ffffff" : "#1c1917", fontWeight: 500 } }}
            >
                <Button
                    type="text"
                    className="!h-12 !w-12 !min-w-12 !border-0 !bg-transparent !p-0 !shadow-none"
                    style={{ color: isMiniMapOpen ? theme.toolbar.activeText : theme.toolbar.item }}
                    icon={<Compass className="size-6" />}
                    onClick={onToggleMiniMap}
                    aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                />
            </Tooltip>
        </div>
    );
}
