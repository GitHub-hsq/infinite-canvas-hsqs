import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";

export type CompareSide = "left" | "right";
/** src is only a fallback for non-persisted sources; storageKey survives reloads. */
export type CompareImage = { id: string; storageKey?: string; src?: string; title?: string; width?: number; height?: number; side?: CompareSide };
export type CompareMode = "slide" | "side";

export const COMPARE_LIBRARY_LIMIT = 16;

type CompareStore = {
    items: CompareImage[];
    mode: CompareMode;
    /** Returns why nothing was added so callers can show the right message. */
    addItem: (image: { storageKey?: string; src?: string; title?: string; width?: number; height?: number }) => "added" | "duplicate" | "full";
    removeItem: (id: string) => void;
    assignSide: (id: string, side: CompareSide | null) => void;
    /** Exchanges the side badges of two library items; an unassigned target simply takes the source's side. */
    swapWith: (sourceId: string, targetId: string) => void;
    swapSides: () => void;
    setMode: (mode: CompareMode) => void;
    clear: () => void;
};

export const useCompareStore = create<CompareStore>()(
    persist(
        (set, get) => ({
            items: [],
            mode: "slide",
            addItem: (image) => {
                const state = get();
                const key = image.storageKey?.trim();
                if (key && state.items.some((item) => item.storageKey === key)) return "duplicate";
                if (!key && image.src && state.items.some((item) => item.src === image.src)) return "duplicate";
                if (state.items.length >= COMPARE_LIBRARY_LIMIT) return "full";
                // Adding to an empty slot places the image there right away; the user can re-place it later.
                const hasLeft = state.items.some((item) => item.side === "left");
                const hasRight = state.items.some((item) => item.side === "right");
                const side: CompareSide | undefined = !hasLeft ? "left" : !hasRight ? "right" : undefined;
                set({ items: [...state.items, { id: `compare-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, side, ...image }] });
                return "added";
            },
            removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
            assignSide: (id, side) =>
                set((state) => ({
                    items: state.items.map((item) => {
                        if (item.id === id) return { ...item, side: side ?? undefined };
                        // One image per side: clear the side from whoever else held it.
                        if (side && item.side === side) return { ...item, side: undefined };
                        return item;
                    }),
                })),
            swapWith: (sourceId, targetId) =>
                set((state) => {
                    const source = state.items.find((item) => item.id === sourceId);
                    const target = state.items.find((item) => item.id === targetId);
                    if (!source || !target || source.id === target.id) return state;
                    return {
                        items: state.items.map((item) => {
                            if (item.id === sourceId) return { ...item, side: target.side ?? undefined };
                            if (item.id === targetId) return { ...item, side: source.side ?? undefined };
                            return item;
                        }),
                    };
                }),
            swapSides: () =>
                set((state) => ({
                    items: state.items.map((item) => (item.side === "left" ? { ...item, side: "right" as CompareSide } : item.side === "right" ? { ...item, side: "left" as CompareSide } : item)),
                })),
            setMode: (mode) => set({ mode }),
            clear: () => set({ items: [] }),
        }),
        {
            name: "infinite-canvas:compare_store",
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ items: state.items, mode: state.mode }),
            // Entries from before storageKey-based persistence hold dead runtime URLs; drop them once.
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                const usable = state.items.filter((item) => item.storageKey?.trim() || /^(https?:|data:)/.test(item.src || ""));
                if (usable.length !== state.items.length) useCompareStore.setState({ items: usable });
            },
        },
    ),
);
