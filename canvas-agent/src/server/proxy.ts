import type { Request, Response } from "express";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const skippedRequestHeaders = new Set(["host", "connection", "content-length", "accept-encoding", "origin", "referer", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "x-canvas-agent-token"]);
const skippedResponseHeaders = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export async function forwardProxyRequest(req: Request, res: Response, rawTarget: string) {
    const target = new URL(rawTarget);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("代理仅支持 HTTP(S) 地址");

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (skippedRequestHeaders.has(name) || value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }

    const controller = new AbortController();
    req.once("aborted", () => controller.abort());
    const method = req.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : Uint8Array.from(await readBody(req));
    const upstream = await fetch(target, {
        method,
        headers,
        body,
        redirect: "follow",
        signal: controller.signal,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
        if (!skippedResponseHeaders.has(name) && !name.startsWith("access-control-")) res.setHeader(name, value);
    });
    if (!upstream.body) return void res.end();

    const stream = Readable.fromWeb(upstream.body as NodeReadableStream);
    res.once("close", () => stream.destroy());
    stream.once("error", () => res.destroy());
    stream.pipe(res);
}

function readBody(req: Request) {
    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}
