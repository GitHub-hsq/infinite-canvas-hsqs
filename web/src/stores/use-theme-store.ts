import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";
/** Stored choice: an explicit theme, or "system" which follows the OS preference. */
export type ThemeMode = ThemeName | "system";

type ThemeStore = {
    mode: ThemeMode;
    /** Resolved theme currently applied to the page ("system" is already resolved against the OS). */
    theme: ThemeName;
    setMode: (mode: ThemeMode) => void;
};

const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

export function systemTheme(): ThemeName {
    return typeof window !== "undefined" && window.matchMedia?.(SYSTEM_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): ThemeName {
    return mode === "system" ? systemTheme() : mode;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            mode: "dark",
            theme: "dark",
            setMode: (mode) => set({ mode, theme: resolveTheme(mode) }),
        }),
        {
            name: "infinite-canvas:theme_mode",
            partialize: (state) => ({ mode: state.mode }),
            // Older builds stored the explicit theme under a different key; keep that choice until the user picks again.
            onRehydrateStorage: () => (state) => {
                if (state) return void useThemeStore.setState({ theme: resolveTheme(state.mode) });
                // First run after the upgrade: adopt the previously saved explicit theme instead of the default.
                try {
                    const stored = JSON.parse(window.localStorage.getItem("infinite-canvas:theme_store") || "null") as { state?: { theme?: ThemeName } } | null;
                    if (stored?.state?.theme === "light" || stored?.state?.theme === "dark") useThemeStore.getState().setMode(stored.state.theme);
                } catch {
                    // A malformed older value is simply ignored.
                }
            },
        },
    ),
);

// Keep "system" in sync with the OS while it is the active choice.
if (typeof window !== "undefined" && window.matchMedia) {
    window.matchMedia(SYSTEM_QUERY).addEventListener("change", () => {
        if (useThemeStore.getState().mode === "system") useThemeStore.setState({ theme: systemTheme() });
    });
}
