import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";

import { forwardProxyRequest } from "./proxy.js";
import { isTrustedProxyOrigin } from "./http.js";

test("后台代理只接受本地画布、正式站点或已配对来源", () => {
    assert.equal(isTrustedProxyOrigin("http://127.0.0.1:3000", []), true);
    assert.equal(isTrustedProxyOrigin("http://localhost:5173", []), true);
    assert.equal(isTrustedProxyOrigin("https://canvas.best", []), true);
    assert.equal(isTrustedProxyOrigin("https://preview.canvas.best", []), true);
    assert.equal(isTrustedProxyOrigin("https://suparkai.tech", []), true);
    assert.equal(isTrustedProxyOrigin("https://www.suparkai.tech", []), true);
    assert.equal(isTrustedProxyOrigin("https://infinite-canvas-hsqs.vercel.app", []), true);
    assert.equal(isTrustedProxyOrigin("https://custom.example", ["https://custom.example"]), true);
    assert.equal(isTrustedProxyOrigin("http://www.suparkai.tech", []), false);
    assert.equal(isTrustedProxyOrigin("https://suparkai.tech.evil.example", []), false);
    assert.equal(isTrustedProxyOrigin("https://evil.example", []), false);
    assert.equal(isTrustedProxyOrigin("null", []), false);
});

test("内置代理转发模型列表、鉴权头和查询参数", async (t) => {
    let authorization = "";
    let query = "";
    const upstream = http.createServer((req, res) => {
        authorization = String(req.headers.authorization || "");
        query = String(req.url || "");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "image-model" }, { id: "text-model" }] }));
    });
    await listen(upstream);
    t.after(() => upstream.close());

    const app = express();
    app.all("/proxy", async (req, res, next) => {
        try {
            await forwardProxyRequest(req, res, String(req.query.target || ""));
        } catch (error) {
            next(error);
        }
    });
    const proxy = http.createServer(app);
    await listen(proxy);
    t.after(() => proxy.close());

    const upstreamAddress = upstream.address();
    const proxyAddress = proxy.address();
    if (!isAddress(upstreamAddress) || !isAddress(proxyAddress)) throw new Error("test server did not bind");
    const target = `http://127.0.0.1:${upstreamAddress.port}/v1/models?scope=all`;
    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/proxy?target=${encodeURIComponent(target)}`, { headers: { authorization: "Bearer test-key" } });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: [{ id: "image-model" }, { id: "text-model" }] });
    assert.equal(authorization, "Bearer test-key");
    assert.equal(query, "/v1/models?scope=all");
});

function listen(server: http.Server) {
    return new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
}

function isAddress(value: ReturnType<http.Server["address"]>): value is { address: string; family: string; port: number } {
    return Boolean(value && typeof value === "object" && "port" in value);
}
