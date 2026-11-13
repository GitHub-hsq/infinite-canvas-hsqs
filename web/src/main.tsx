import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { requireSiteAccess } from "@/site-access-gate";

await requireSiteAccess();

const [{ AppProviders }, { initAnalytics }, { router }] = await Promise.all([import("@/components/layout/app-providers"), import("@/lib/analytics"), import("@/router"), import("@/i18n")]);
initAnalytics();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
