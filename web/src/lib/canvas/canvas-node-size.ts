export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

export const IMAGE_NODE_DISPLAY_LONG_EDGE = 340;
export const IMAGE_NODE_DISPLAY_AREA = (IMAGE_NODE_DISPLAY_LONG_EDGE * IMAGE_NODE_DISPLAY_LONG_EDGE * 9) / 16;

// Canvas footprint is independent from source pixels: 1K and 4K images with the same ratio
// render at the same visual area, while the original blob and natural dimensions stay untouched.
export function fitImageNodeSize(width: number, height: number, targetArea = IMAGE_NODE_DISPLAY_AREA) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const ratio = w / h;
    const area = Math.max(1, targetArea);
    return { width: Math.sqrt(area * ratio), height: Math.sqrt(area / ratio) };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}

export function imageNodeSizeFromRatio(size: string, targetArea = IMAGE_NODE_DISPLAY_AREA) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!(width > 0 && height > 0)) return null;
    return fitImageNodeSize(width, height, targetArea);
}
