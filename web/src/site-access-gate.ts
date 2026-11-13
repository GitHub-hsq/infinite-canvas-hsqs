const ACCESS_STORAGE_KEY = "suparkai:site-access";
const PASSWORD_SHA256 = "ef20fe59b4907ed98a5d495b24863b400a5b150835ac922085273f7f6b7eb517";
const ACCESS_MARKER = "5e304d07272ffff8ee27039bfff5dfda3ccd4fb1809f96ac08c1c80e2024930a";

export async function requireSiteAccess() {
    if (window.sessionStorage.getItem(ACCESS_STORAGE_KEY) === ACCESS_MARKER) return;

    document.title = "访问验证 · SuparkAI";
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light dark";
    document.body.className = "";
    document.body.innerHTML = loginMarkup();

    const form = document.querySelector<HTMLFormElement>("#site-access-form");
    const input = document.querySelector<HTMLInputElement>("#site-access-password");
    const error = document.querySelector<HTMLElement>("#site-access-error");
    if (!form || !input || !error) return new Promise<void>(() => undefined);

    return new Promise<void>((resolve) => {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const button = form.querySelector<HTMLButtonElement>("button");
            if (button) button.disabled = true;
            const valid = await passwordMatches(input.value);
            if (valid) {
                window.sessionStorage.setItem(ACCESS_STORAGE_KEY, ACCESS_MARKER);
                document.body.innerHTML = '<div id="root"></div>';
                resolve();
                return;
            }
            error.hidden = false;
            input.value = "";
            input.focus();
            if (button) button.disabled = false;
        });
    });
}

async function passwordMatches(password: string) {
    if (!password) return false;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    let difference = actual.length ^ PASSWORD_SHA256.length;
    for (let index = 0; index < PASSWORD_SHA256.length; index += 1) difference |= (actual.charCodeAt(index) || 0) ^ PASSWORD_SHA256.charCodeAt(index);
    return difference === 0;
}

function loginMarkup() {
    return `<style>
:root{font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0%,#dbeafe 0,transparent 38%),#f5f5f4;color:#1c1917}.site-access-card{width:min(100%,400px);padding:32px;border:1px solid #e7e5e4;border-radius:22px;background:rgba(255,255,255,.94);box-shadow:0 22px 60px rgba(28,25,23,.12)}.site-access-mark{width:48px;height:48px;display:grid;place-items:center;margin-bottom:22px;border-radius:14px;background:#1c1917;color:white;font-size:23px;font-weight:700}.site-access-card h1{margin:0 0 10px;font-size:24px}.site-access-card p{margin:0 0 24px;color:#78716c;line-height:1.6}.site-access-label{display:block;margin-bottom:10px;font-size:13px;font-weight:600}.site-access-card input{width:100%;height:48px;padding:0 14px;border:1px solid #d6d3d1;border-radius:12px;background:white;color:#1c1917;font:inherit;outline:none}.site-access-card input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14)}.site-access-card button{width:100%;height:48px;margin-top:14px;border:0;border-radius:12px;background:#1c1917;color:white;font:inherit;font-weight:650;cursor:pointer}.site-access-card button:hover{background:#292524}.site-access-card button:disabled{opacity:.65;cursor:wait}.site-access-error{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:13px}.site-access-note{margin:18px 0 0;text-align:center;font-size:12px;color:#a8a29e}@media(prefers-color-scheme:dark){body{background:radial-gradient(circle at 50% 0%,#172554 0,transparent 38%),#0c0a09;color:#fafaf9}.site-access-card{border-color:#292524;background:rgba(28,25,23,.96);box-shadow:0 22px 60px rgba(0,0,0,.35)}.site-access-mark,.site-access-card button{background:#fafaf9;color:#1c1917}.site-access-card button:hover{background:#e7e5e4}.site-access-card p{color:#a8a29e}.site-access-card input{border-color:#44403c;background:#0c0a09;color:#fafaf9}.site-access-error{background:#450a0a;color:#fecaca}}
</style>
<main class="site-access-card">
<div class="site-access-mark">S</div>
<h1>此网站受密码保护</h1>
<p>请输入家庭访问密码后继续使用无限画布。</p>
<div id="site-access-error" class="site-access-error" role="alert" hidden>密码不正确，请重新输入。</div>
<form id="site-access-form">
<label class="site-access-label" for="site-access-password">访问密码</label>
<input id="site-access-password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">进入网站</button>
</form>
<div class="site-access-note">画布数据仍分别保存在每台设备的浏览器中</div>
</main>`;
}
