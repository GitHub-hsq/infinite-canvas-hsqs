import { Switch } from "antd";
import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LOCAL_PROXY_SERVICE_URL, useConfigStore } from "@/stores/use-config-store";

export function ConfigLocalProxy() {
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);

    return (
        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Network className="size-4" />
                        {t("config.proxy.title")}
                    </div>
                    <div className="mt-1 text-xs text-stone-500">{t("config.proxy.description")}</div>
                </div>
                <Switch checked={config.proxyEnabled} onChange={(checked) => updateConfig("proxyEnabled", checked)} />
            </div>
            <div className="mt-3 text-xs text-stone-500">
                {config.proxyEnabled
                    ? t("config.proxy.activeLocal", { address: `${LOCAL_PROXY_SERVICE_URL}/proxy` })
                    : t("config.proxy.channelHint")}
            </div>
        </section>
    );
}
