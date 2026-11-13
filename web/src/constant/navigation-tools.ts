import { FileText, ImagePlus, Images, Maximize2, Settings2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
export type NavigationTool = (typeof navigationTools)[number];

const NAV_ORDER_KEY = "infinite-canvas-nav-order";

/** Nav items in the user's saved order; unknown or missing slugs fall back to the declared order. */
export function orderedNavigationTools(order: string[] | null): NavigationTool[] {
    if (!order?.length) return [...navigationTools];
    const bySlug = new Map(navigationTools.map((tool) => [tool.slug as string, tool]));
    const ordered = order.map((slug) => bySlug.get(slug)).filter((tool): tool is NavigationTool => Boolean(tool));
    const seen = new Set(ordered.map((tool) => tool.slug as string));
    return [...ordered, ...navigationTools.filter((tool) => !seen.has(tool.slug))];
}

export function readNavigationOrder(): string[] | null {
    try {
        const stored = JSON.parse(window.localStorage.getItem(NAV_ORDER_KEY) || "null");
        return Array.isArray(stored) ? stored.filter((slug): slug is string => typeof slug === "string") : null;
    } catch {
        return null;
    }
}

export function writeNavigationOrder(order: string[]) {
    try {
        window.localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order));
    } catch {
        // Storage unavailable: the order still applies for this session.
    }
}
