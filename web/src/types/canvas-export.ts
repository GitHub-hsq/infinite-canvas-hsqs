import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { Asset, AssetCategory } from "@/stores/use-asset-store";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
    assets: Asset[];
    categories: AssetCategory[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
