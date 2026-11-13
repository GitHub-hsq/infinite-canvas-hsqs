const ACCESS_COOKIE = "__Host-suparkai_access";
const LOGIN_PATH = "/__site-login";
const LOGOUT_PATH = "/__site-logout";
const PASSWORD_SHA256 = "ef20fe59b4907ed98a5d495b24863b400a5b150835ac922085273f7f6b7eb517";
const ACCESS_TOKEN = "5e304d07272ffff8ee27039bfff5dfda3ccd4fb1809f96ac08c1c80e2024930a";

export const config = { runtime: "nodejs" };

export default async function proxy(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === LOGOUT_PATH) {
        return new Response(null, {
            status: 303,
            headers: {
                Location: "/",
                "Set-Cookie": `${ACCESS_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
                "Cache-Control": "no-store",
            },
        });
    }

    if (await hasValidAccessCookie(request)) return;

    if (url.pathname === LOGIN_PATH && request.method === "POST") {
        const form = await request.formData();
        const password = String(form.get("password") || "");
        const returnTo = safeReturnTo(String(form.get("returnTo") || "/"));
        if (await passwordMatches(password)) {
            return new Response(null, {
                status: 303,
                headers: {
                    Location: returnTo,
                    "Set-Cookie": `${ACCESS_COOKIE}=${ACCESS_TOKEN}; Path=/; HttpOnly; Secure; SameSite=Strict`,
                    "Cache-Control": "no-store",
                },
            });
        }
        return loginResponse(returnTo, true, request.method === "HEAD");
    }

    const returnTo = safeReturnTo(`${url.pathname}${url.search}`);
    return loginResponse(returnTo, false, request.method === "HEAD");
}

async function hasValidAccessCookie(request: Request) {
    const cookieHeader = request.headers.get("cookie") || "";
    const rawCookie = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${ACCESS_COOKIE}=`))
        ?.slice(ACCESS_COOKIE.length + 1);
    return Boolean(rawCookie && constantTimeEqual(rawCookie, ACCESS_TOKEN));
}

async function passwordMatches(password: string) {
    if (!password) return false;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return constantTimeEqual(actual, PASSWORD_SHA256);
}

function constantTimeEqual(actual: string, expected: string) {
    let difference = actual.length ^ expected.length;
    for (let index = 0; index < expected.length; index += 1) difference |= (actual.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
    return difference === 0;
}

function safeReturnTo(value: string) {
    return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function loginResponse(returnTo: string, invalid: boolean, headRequest: boolean) {
    const escapedReturnTo = escapeHtml(returnTo);
    const error = invalid ? '<div class="error" role="alert">密码不正确，请重新输入。</div>' : "";
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>访问验证 · SuparkAI</title>
<style>
:root{color-scheme:light dark;font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0%,#dbeafe 0,transparent 38%),#f5f5f4;color:#1c1917}.card{width:min(100%,400px);padding:32px;border:1px solid #e7e5e4;border-radius:22px;background:rgba(255,255,255,.94);box-shadow:0 22px 60px rgba(28,25,23,.12)}.mark{width:48px;height:48px;display:grid;place-items:center;margin-bottom:22px;border-radius:14px;background:#1c1917;color:white;font-size:23px;font-weight:700}h1{margin:0 0 10px;font-size:24px}p{margin:0 0 24px;color:#78716c;line-height:1.6}.field{display:block;margin-bottom:10px;font-size:13px;font-weight:600}input{width:100%;height:48px;padding:0 14px;border:1px solid #d6d3d1;border-radius:12px;background:white;color:#1c1917;font:inherit;outline:none}input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14)}button{width:100%;height:48px;margin-top:14px;border:0;border-radius:12px;background:#1c1917;color:white;font:inherit;font-weight:650;cursor:pointer}button:hover{background:#292524}.error{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:13px}.note{margin:18px 0 0;text-align:center;font-size:12px;color:#a8a29e}@media(prefers-color-scheme:dark){body{background:radial-gradient(circle at 50% 0%,#172554 0,transparent 38%),#0c0a09;color:#fafaf9}.card{border-color:#292524;background:rgba(28,25,23,.96);box-shadow:0 22px 60px rgba(0,0,0,.35)}.mark,button{background:#fafaf9;color:#1c1917}button:hover{background:#e7e5e4}p{color:#a8a29e}input{border-color:#44403c;background:#0c0a09;color:#fafaf9}.error{background:#450a0a;color:#fecaca}}
</style>
</head>
<body>
<main class="card">
<div class="mark">S</div>
<h1>此网站受密码保护</h1>
<p>请输入家庭访问密码后继续使用无限画布。</p>
${error}
<form method="post" action="${LOGIN_PATH}">
<input type="hidden" name="returnTo" value="${escapedReturnTo}">
<label class="field" for="password">访问密码</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">进入网站</button>
</form>
<div class="note">画布数据仍分别保存在每台设备的浏览器中</div>
</main>
</body>
</html>`;
    return new Response(headRequest ? null : html, {
        status: invalid ? 401 : 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, private",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    });
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}
