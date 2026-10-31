"use strict";

/* ==========================================================================
   Mist.AI frontend — chat UI, threads, moderation, and backend wiring.
   Everything lives inside one IIFE; only the functions the HTML calls
   directly are exposed on `window` at the bottom.
   ========================================================================== */
(() => {

    // Every magic number lives here.
    const CONFIG = {
        PASTED_THRESHOLD: 200,
        MAX_PASTES: 5,
        MAX_PASTE_CHARS: 100_000,
        MAX_WORDS: 1200,
        WORD_WARNING_THRESHOLD: 500,
        MEMORY_CAP: 50,
        THINKING_DELAY_MSG_MS: 9000,
        MODEL_SWAP_DEBOUNCE_MS: 1300,
        DOWN_CHECK_INTERVAL_MS: 60000,
        TYPE_ANIM_MAX_WORDS: 80,
        TYPE_ANIM_MAX_CHARS: 400,
        BAN_STRIKES: 3,
        MAX_IMAGES: 4,
        IMAGE_SEND_DIM: 1600,   // what Mist.AI sees
        IMAGE_THUMB_DIM: 320,   // what's saved in chat history
        IMAGE_QUALITY: 0.85,
    };

    const THEME_CLASSES = [
        "light-theme", "blue-theme", "midnight-theme", "cyberpunk-theme",
        "arctic-theme", "terminal-theme", "sunset-theme", "konami-theme",
        "cherry-theme", "golden-theme", "galaxy-theme",
    ];

    function applyTheme(theme) {
        document.body.classList.remove(...THEME_CLASSES);
        if (theme && theme !== "dark") document.body.classList.add(`${theme}-theme`);
    }

    // Safe localStorage read/write — never throws on corrupt JSON.
    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            return JSON.parse(raw);
        } catch (err) {
            console.warn(`Corrupt localStorage value for "${key}", using fallback:`, err);
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.error(`Failed to write localStorage key "${key}":`, err);
        }
    }

    // Strips scripts/handlers/javascript: URLs before any HTML gets injected.
    const BLOCKED_TAGS = new Set([
        "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "LINK",
        "META", "BASE",
    ]);

    function sanitizeHtml(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const walk = (node) => {
            const children = Array.from(node.children || []);
            for (const el of children) {
                if (BLOCKED_TAGS.has(el.tagName)) {
                    el.remove();
                    continue;
                }
                for (const attr of Array.from(el.attributes)) {
                    const name = attr.name.toLowerCase();
                    const value = attr.value.trim().toLowerCase();
                    if (name.startsWith("on")) el.removeAttribute(attr.name);
                    else if (
                        (name === "href" || name === "src" || name === "xlink:href") &&
                        (value.startsWith("javascript:") || value.startsWith("data:text/html"))
                    ) {
                        el.removeAttribute(attr.name);
                    }
                }
                walk(el);
            }
        };
        walk(doc.body);
        return doc.body.innerHTML;
    }

    function setSafeHtml(el, html) {
        el.innerHTML = sanitizeHtml(html);
    }

    document.addEventListener("focusin", e => {
        if (!e.target.classList.contains("edit-textarea")) return;
        document.addEventListener("click", function exitEdit(ev) {
            if (!e.target.contains(ev.target)) {
                e.target.closest(".message")?.querySelector(".cancel-button")?.click();
                document.removeEventListener("click", exitEdit);
            }
        });
    });

    // Markdown converter.
    const converter = new showdown.Converter({
        simpleLineBreaks: true,
        omitExtraWLInCodeBlocks: true,
        tables: true,
        ghCodeBlocks: true,
        strikethrough: true,
        tasklists: true,
        smoothLivePreview: true,
        smartIndentationFix: true,
        simplifiedAutoLink: true,
        openLinksInNewWindow: true,
        literalMidWordUnderscores: true,
        emoji: true,
        disableForced4SpacesIndentedSublists: true,
    });

    // --- Math -------------------------------------------------------------
    // Math is lifted out before Showdown (which would eat \( \[ _ * and add
    // <br>s), then restored as KaTeX HTML before sanitizeHtml, so the
    // sanitizer is still the last step before innerHTML. Everything unclosed
    // simply doesn't match and stays literal, so partial text is safe.
    const MATH_PATTERNS = [
        [/\$\$([\s\S]+?)\$\$/g, true],
        [/\\\[([\s\S]+?)\\\]/g, true],
        [/\\\(([\s\S]+?)\\\)/g, false],
    ];
    const _texCache = new Map();

    function escapeHtml(s) {
        return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    function renderTex(tex, display) {
        const key = (display ? "D" : "I") + tex;
        let html = _texCache.get(key);
        if (html !== undefined) return html;
        try {
            if (typeof katex === "undefined") throw new Error("KaTeX not loaded");
            html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
        } catch {
            html = escapeHtml(display ? `\\[${tex}\\]` : `\\(${tex}\\)`);
        }
        if (_texCache.size > 500) _texCache.clear();
        _texCache.set(key, html);
        return html;
    }

    // $...$ only when it clearly isn't currency: opener followed by a
    // non-space, closer preceded by a non-space and not followed by a digit,
    // one line, at most 200 chars.
    function inlineDollarMath(t, hold) {
        let out = "";
        let i = 0;
        while (i < t.length) {
            if (t[i] === "$" && t[i - 1] !== "\\" && t[i + 1] && !/[\s$]/.test(t[i + 1])) {
                const limit = Math.min(t.length, i + 202);
                let j = i + 1;
                while (j < limit && t[j] !== "$" && t[j] !== "\n") j++;
                if (t[j] === "$" && !/[\s\\]/.test(t[j - 1]) && !/\d/.test(t[j + 1] || "")) {
                    out += hold(t.slice(i + 1, j));
                    i = j + 1;
                    continue;
                }
            }
            out += t[i];
            i++;
        }
        return out;
    }

    function extractMath(text) {
        const nonce = Math.random().toString(36).slice(2, 8);
        const spans = [];
        const found = [];
        // Inline code spans are masked so `$x$` stays literal.
        let t = text.replace(/`[^`\n]+`/g, m => `MSTCODE${nonce}X${spans.push(m) - 1}X`);
        const codeRe = new RegExp(`MSTCODE${nonce}X(\\d+)X`, "g");
        const unmask = s => s.replace(codeRe, (_, i) => spans[i]);
        const hold = (tex, display) => `MSTMATH${nonce}X${found.push([unmask(tex).trim(), display]) - 1}X`;

        for (const [re, display] of MATH_PATTERNS) t = t.replace(re, (_, tex) => hold(tex, display));
        t = inlineDollarMath(t, tex => hold(tex, false));
        t = unmask(t);

        const mathRe = new RegExp(`MSTMATH${nonce}X(\\d+)X`, "g");
        return {
            masked: t,
            restore: html => found.length
                ? html.replace(mathRe, (_, i) => renderTex(found[i][0], found[i][1]))
                : html,
        };
    }

    function renderMarkdownInto(el, text) {
        const { masked, restore } = extractMath(text);
        setSafeHtml(el, restore(converter.makeHtml(masked)));
    }

    // Fence names -> highlight.js languages registered in index.html.
    // Anything else stays plain text.
    const HLJS_LANGS = {
        js: "javascript", javascript: "javascript", jsx: "javascript", mjs: "javascript", node: "javascript",
        ts: "typescript", typescript: "typescript", tsx: "typescript",
        py: "python", python: "python", python3: "python",
        html: "xml", htm: "xml", xml: "xml", svg: "xml",
        css: "css",
        sh: "bash", bash: "bash", shell: "bash", zsh: "bash", console: "bash",
        c: "c", h: "c",
        cpp: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
        json: "json",
        sql: "sql",
    };

    // Highlights one <code> once; a no-op until highlight.js has loaded.
    function highlightCode(code) {
        const lang = code.dataset.lang;
        if (!lang || code.dataset.highlighted || !window.hljs) return;
        code.classList.add(`language-${lang}`);
        window.hljs.highlightElement(code);
    }

    // highlight.js loads as a module and may finish after messages rendered.
    window.addEventListener("hljs-ready", () => {
        document.querySelectorAll(".message-code-block code[data-lang]").forEach(highlightCode);
    });

    // Icon-only action button; the label doubles as aria-label and tooltip.
    function iconButton(icon, label, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "msg-action";
        setIcon(btn, icon, label);
        btn.onclick = onClick;
        return btn;
    }

    function setIcon(btn, icon, label) {
        btn.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
        btn.setAttribute("aria-label", label);
        btn.title = label;
    }

    // One .msg-actions row per message (Edit; Copy and Regenerate on replies).
    function attachEditButton(messageElement, content) {
        const row = document.createElement("div");
        row.className = "msg-actions";
        row.appendChild(iconButton("fa-solid fa-pen", "Edit message", () => enableEditMode(messageElement, content)));
        messageElement.appendChild(row);
    }

    // `streaming` is for partial text: code stays unhighlighted and the
    // copy/edit buttons wait for the final render. `target` re-renders an
    // existing element in place (a streaming reply).
    function renderMessage(message, className, streaming = false, target = null) {
        const messagesDiv = document.getElementById("chat-box");
        if (!messagesDiv) return;
        // The user switched threads mid-stream; the element is gone.
        if (target && !target.isConnected) return null;
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", className);

        // Fresh regex per call so reentrant rendering can't collide on lastIndex.
        // An unclosed trailing fence (partial text) counts as a code block.
        const codeBlockRegex = /```([^\s`]*)[ \t]*\n?([\s\S]*?)(```|$)/g;
        let lastIndex = 0;
        let match;

        while ((match = codeBlockRegex.exec(message)) !== null) {
            const before = message.slice(lastIndex, match.index);
            if (before.trim()) {
                const seg = document.createElement("div");
                renderMarkdownInto(seg, before);
                messageElement.appendChild(seg);
            }
            const closed = Boolean(match[3]);
            const code = (closed ? match[2] : match[2].replace(/`{1,2}$/, "")).trim();
            messageElement.appendChild(buildCodeBlock(match[1] || "code", code, streaming));
            lastIndex = match.index + match[0].length;
            if (!closed) break;
        }

        const remaining = message.slice(lastIndex);
        if (remaining.trim()) {
            const seg = document.createElement("div");
            renderMarkdownInto(seg, remaining);
            messageElement.appendChild(seg);
        }

        if (className === "user-message" && !streaming) {
            attachEditButton(messageElement, message);
        }

        // The row is present while streaming too (invisible via .streaming) so
        // it holds its space and nothing shifts when it appears.
        if (className === "bot-message") {
            messageElement.appendChild(buildActionRow(message));
        }

        if (target) {
            // Scrolling during a stream is streamReply's job.
            target.classList.toggle("streaming", streaming);
            target.replaceChildren(...messageElement.childNodes);
            return target;
        }
        messageElement.classList.toggle("streaming", streaming);

        messagesDiv.appendChild(messageElement);
        requestAnimationFrame(() => {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
        return messageElement;
    }

    // Actions under a bot reply. Regenerate joins this row next.
    function buildActionRow(text) {
        const row = document.createElement("div");
        row.className = "msg-actions";
        const copy = iconButton("fa-regular fa-copy", "Copy reply", () => {
            navigator.clipboard.writeText(text)
                .then(() => {
                    setIcon(copy, "fa-solid fa-check", "Copied");
                    setTimeout(() => setIcon(copy, "fa-regular fa-copy", "Copy reply"), 1500);
                })
                .catch(err => console.error("Copy failed", err));
        });
        row.appendChild(copy);
        return row;
    }

    function buildCodeBlock(lang, code, streaming = false) {
        const wrapper = document.createElement("div");
        wrapper.classList.add("message-code-block");

        const header = document.createElement("div");
        header.classList.add("code-header");

        const langLabel = document.createElement("span");
        langLabel.classList.add("code-lang");
        langLabel.textContent = lang;

        const copyBtn = document.createElement("button");
        copyBtn.classList.add("code-copy-btn");
        copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> Copy`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(code).then(() => {
                copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
                setTimeout(() => { copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> Copy`; }, 2000);
            });
        };

        header.appendChild(langLabel);
        header.appendChild(copyBtn);
        wrapper.appendChild(header);

        const pre = document.createElement("pre");
        const codeEl = document.createElement("code");
        codeEl.textContent = code;
        pre.appendChild(codeEl);
        wrapper.appendChild(pre);
        // Plain text while streaming; highlight once on the final render.
        const hl = HLJS_LANGS[lang.toLowerCase()];
        if (hl && !streaming) {
            codeEl.dataset.lang = hl;
            highlightCode(codeEl);
        }

        return wrapper;
    }

    async function typeBotMessage(message, containerClass = "bot-message") {
        const messagesDiv = document.getElementById("chat-box");
        if (!messagesDiv) return message;
        const wordCount = message.trim().split(/\s+/).length;
        const hasCode = /```[\s\S]*?```/.test(message);
        const hasMath = /\\[(\[]|\$\$|\$[^\s$\d]/.test(message);

        // Long/code-heavy messages render instantly instead of animating.
        if (
            wordCount > CONFIG.TYPE_ANIM_MAX_WORDS ||
            message.length > CONFIG.TYPE_ANIM_MAX_CHARS ||
            hasCode ||
            hasMath
        ) {
            renderMessage(message, containerClass);
            return message;
        }

        const tempEl = document.createElement("div");
        tempEl.classList.add("message", containerClass);
        messagesDiv.appendChild(tempEl);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        const total = message.length;
        let i = 0;
        while (i < total) {
            tempEl.textContent += message[i];
            i++;
            const p = i / total;
            const delay = p < 0.3 ? 38 : p < 0.7 ? 26 : 11;
            await new Promise(res => setTimeout(res, delay));
            requestAnimationFrame(() => {
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            });
        }

        messagesDiv.removeChild(tempEl);
        renderMessage(message, containerClass);
        return message;
    }

    // App state — module-scoped, not global.
    let currentModel = "gemini";
    let canSendMessage = true;
    let isSwapping = false;
    let chatMemory = [];
    let uploadedFiles = [];
    let trackedIPs = {};
    let thinkingBubble = null;
    let activeReply = null;          // {controller, threadId} while a reply is in flight
    const fullImages = new Map();    // threadId → full-size images of its last turn (session only)
    let delayTimeout = null;
    let currentThread = null;
    let pastedItems = [];

    // Client-side courtesy filter only — real enforcement is server-side
    // (/chat checks bans.db directly). Crisis terms get support resources
    // instead of a strike.
    const crisisTerms = [
        "suicide", "self-harm", "cutting", "kill myself", "unalive",
        "kms", "commit suicide", "hang myself", "bleed out",
    ];

    const bannedWords = [
        "CP", "rape", "pedophile", "bestiality", "necrophilia", "zoophilia", "gore",
        "loli", "shota", "noncon", "incest", "molest", "p0rn", "porn", "porno",
        "child porn", "underage", "guro", "torture", "red room", "forced", "abuse",
        "daddy kink", "ageplay", "lolicon", "shotacon", "map", "minor attracted person",
        "taboo", "fetish", "bdsm", "bondage", "asphyxiation", "erotic", "coercion",
        "how to kill", "overdose", "jump off",
        "bomb", "terrorism", "isis", "school shooting", "massacre", "mass shooting",
        "execute", "behead", "jihadi", "extremist", "radicalize",
        "c.p.", "p*dophile", "l0li", "sh0ta", "r@pe", "pr0n", "n0ncon", "g@re", "p3d0",
    ];

    const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bannedWordsRegex = new RegExp(`\\b(${bannedWords.map(escapeRegex).join("|")})\\b`, "i");
    const crisisTermsRegex = new RegExp(`\\b(${crisisTerms.map(escapeRegex).join("|")})\\b`, "i");

    function containsBannedWords(message) {
        return bannedWordsRegex.test(message);
    }

    function containsCrisisTerms(message) {
        return crisisTermsRegex.test(message);
    }

    // Dev bypass — localhost/file:// only, so it can't be used in production.
    function isLocalDev() {
        const h = window.location.hostname;
        return h === "localhost" || h === "127.0.0.1" || window.location.protocol === "file:";
    }

    function devBypassEnabled() {
        return isLocalDev() && localStorage.getItem("devBypass") === "true";
    }

    if (isLocalDev()) {
        window.MistAIDev = async function () {
            localStorage.setItem("devBypass", "true");
            console.log("🛠️ Dev mode activated.");
            const userIP = await getUserIP();
            if (userIP) removeBannedIP(userIP);
            enableChat();
        };
    }

    document.getElementById("toggleDevBypassBtn")?.addEventListener("click", async () => {
        if (!isLocalDev()) {
            alert("Dev bypass is only available in local development.");
            return;
        }
        const enabled = localStorage.getItem("devBypass") === "true";
        if (enabled) {
            localStorage.removeItem("devBypass");
            console.log("🛑 Dev Bypass Disabled");
            alert("Dev Bypass Disabled");
        } else {
            localStorage.setItem("devBypass", "true");
            console.log("🛠️ Dev Bypass Enabled");
            alert("Dev Bypass Enabled");
            const ip = await getUserIP();
            if (ip) removeBannedIP(ip);
            enableChat();
        }
    });

    // IP is fetched once and cached, not re-fetched per message.
    let _cachedIP;
    let _ipFetchPromise = null;

    async function getUserIP() {
        if (_cachedIP !== undefined) return _cachedIP;
        if (_ipFetchPromise) return _ipFetchPromise;
        _ipFetchPromise = (async () => {
            try {
                const response = await fetch("https://api.ipify.org?format=json");
                const data = await response.json();
                _cachedIP = data.ip || null;
            } catch (error) {
                // Fail-open: server /chat is the real ban gate, this is best-effort.
                console.error("❌ Failed to get IP:", error);
                _cachedIP = null;
            } finally {
                _ipFetchPromise = null;
            }
            return _cachedIP;
        })();
        return _ipFetchPromise;
    }

    function getUserToken() {
        let token = localStorage.getItem("user_token");
        if (!token) {
            token = generateUUID();
            localStorage.setItem("user_token", token);
        }
        return token;
    }

    function storeBannedIP(userIP) {
        const bannedIPs = readJSON("bannedIPs", []);
        if (!bannedIPs.includes(userIP)) bannedIPs.push(userIP);
        writeJSON("bannedIPs", bannedIPs);
    }

    function removeBannedIP(userIP) {
        const bannedIPs = readJSON("bannedIPs", []).filter(ip => ip !== userIP);
        writeJSON("bannedIPs", bannedIPs);
    }

    function isIPBanned(userIP) {
        return readJSON("bannedIPs", []).includes(userIP);
    }

    function disableChat() {
        const inputBox = document.getElementById("user-input");
        if (inputBox) {
            inputBox.disabled = true;
            inputBox.style.backgroundColor = "#444";
            inputBox.placeholder = "❌ You have been banned.";
            let notice = document.getElementById("ban-contact-notice");
            if (!notice) {
                notice = document.createElement("div");
                notice.id = "ban-contact-notice";
                notice.style.color = "#ff5555";
                notice.style.marginTop = "0.3rem";
                notice.innerHTML = `Contact the <a href="mailto:misttwist@icloud.com" style="color:#ff9999; text-decoration:underline;">creator</a> to appeal.`;
                inputBox.parentNode.insertBefore(notice, inputBox.nextSibling);
            }
        }
    }

    function enableChat() {
        const inputBox = document.getElementById("user-input");
        if (inputBox) {
            inputBox.disabled = false;
            inputBox.placeholder = "Type a message...";
        }
    }

    let banCheckPending = false;

    async function checkBanOnLoad() {
        if (banCheckPending) return;
        banCheckPending = true;

        const userIP = await getUserIP();
        const token = getUserToken();
        if (!userIP) { banCheckPending = false; return; }

        try {
            const resp = await fetch(getBackendBase() + "/is-banned", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ip: userIP, token }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (data.banned) { storeBannedIP(userIP); disableChat(); }
            else { removeBannedIP(userIP); enableChat(); }
        } catch (err) {
            console.error("Ban check failed:", err);
            enableChat();
        } finally {
            banCheckPending = false;
        }
    }

    // Returns "crisis" for supportive-message routing, "banned" once strikes
    // are exhausted, or null to continue normally.
    function handleUserMessage(message, userIP) {
        if (devBypassEnabled()) return null;

        if (containsCrisisTerms(message)) return "crisis";

        if (!userIP) return null;
        if (isIPBanned(userIP)) { disableChat(); return "banned"; }

        if (containsBannedWords(message)) {
            trackedIPs[userIP] = (trackedIPs[userIP] || 0) + 1;
            if (trackedIPs[userIP] >= CONFIG.BAN_STRIKES) {
                storeBannedIP(userIP);
                delete trackedIPs[userIP];
                disableChat();
                return "banned";
            }
        }
        return null;
    }

    const CRISIS_SUPPORT_MESSAGE =
        "💙 It sounds like you might be going through something heavy. " +
        "Mist.AI isn't equipped to help with this, but real people are — " +
        "you can call or text <strong>988</strong> (Suicide & Crisis Lifeline, US) " +
        "any time, day or night. You matter.";

    function userWantsGrounding(message) {
        const msg = message.toLowerCase();
        return (
            msg.includes("source") || msg.includes("sources") ||
            msg.includes("cite") || msg.includes("citation") ||
            msg.includes("link") || msg.includes("reference")
        );
    }

    // Main send pipeline. `edit` = {fromTs, element} when re-sending an edited
    // message: the old messages are only cut once the server accepts the request.
    async function sendMessage(userMessage = null, edit = null) {
        applyTheme(localStorage.getItem("mistai-theme") || "dark");

        const userInput = document.getElementById("user-input");
        const messagesDiv = document.getElementById("chat-box");
        if (!userInput || !messagesDiv || !canSendMessage || activeReply) return;
        localStorage.removeItem("mistai-draft");

        // Lock immediately so a fast double-click can't send twice.
        canSendMessage = false;

        try {
            if (typeof Notification !== "undefined" && Notification.permission === "default") {
                Notification.requestPermission().catch(err => {
                    console.warn("Notification request failed:", err);
                });
            }
        } catch (e) {
            console.debug("Notification check error (may be iOS PWA):", e.message);
        }

        if (!userMessage) userMessage = userInput.value.trim();

        const pastedSnapshot = pastedItems.length > 0 ? pastedItems.map(p => p.text) : null;
        const pastedText = pastedSnapshot ? pastedSnapshot.join("\n\n") : null;

        let payloadMessage = userMessage;
        if (pastedText) {
            payloadMessage = userMessage ? `${userMessage}\n\n${pastedText}` : pastedText;
        }

        if (!payloadMessage && !uploadedFiles.length) { canSendMessage = true; return; }

        const userIP = await getUserIP();
        const moderation = handleUserMessage(payloadMessage, userIP);
        if (moderation === "crisis") {
            showMessage(CRISIS_SUPPORT_MESSAGE, "bot");
            canSendMessage = true;
            return;
        }
        if (moderation === "banned") { canSendMessage = true; return; }

        const imagesToSend = [...uploadedFiles];
        let sendImages = [], thumbImages = [];
        try {
            [sendImages, thumbImages] = await Promise.all([
                Promise.all(imagesToSend.map(f => compressImage(f, CONFIG.IMAGE_SEND_DIM))),
                Promise.all(imagesToSend.map(f => compressImage(f, CONFIG.IMAGE_THUMB_DIM, 0.7))),
            ]);
        } catch (imgErr) {
            console.error("Image compression failed:", imgErr);
            showMessage("⚠️ Couldn't read one of those images.", "bot");
            canSendMessage = true;
            return;
        }
        clearImagePreviews();

        // Edit: what will be cut (computed now, applied on acceptance).
        const cut = edit ? editCut(loadState().currentThread, edit.fromTs) : null;

        let stored;
        if (pastedSnapshot || thumbImages.length) {
            const el = renderUserTurn(userMessage, pastedSnapshot || [], thumbImages);
            stored = _storeNewMessage(userMessage, "user", null, true, {
                ...(pastedSnapshot && { pasted: pastedSnapshot }),
                ...(thumbImages.length && { images: thumbImages }),
            });
            stored.el = el;
            if (el) el.dataset.ts = stored.ts;
        } else {
            stored = _storeNewMessage(userMessage, "user", null, false);
        }

        clearPastedItems();

        userInput.value = "";
        userInput.style.height = `${inputSizing.minHeight}px`;
        if (wordCounter) wordCounter.style.display = "none";

        document.body.classList.add("hide-header");

        // Captured now: the reply is saved here even if the user switches threads.
        const threadId = loadState().currentThread;
        // Full-size images for Regenerate this session (history keeps 320px previews).
        fullImages.set(threadId, sendImages);

        const context = cut ? chatMemory.slice(0, Math.max(0, chatMemory.length - cut.memEntries)) : chatMemory;
        await requestReply({
            userMessage, pasted: pastedSnapshot || [], images: sendImages, threadId, userIP, context,
            onAccepted: cut && (() => applyEditCut(threadId, cut, context, edit.element, stored.el)),
        });
    }

    // Requests and renders one reply; shared by sendMessage and regenerate. The
    // caller has set canSendMessage = false; the finally block is the only
    // place that unlocks, so a Stop can't let a second send in early.
    async function requestReply({ userMessage, pasted, images, threadId, userIP, context, onAccepted }) {
        const userInput = document.getElementById("user-input");
        const messagesDiv = document.getElementById("chat-box");
        const controller = new AbortController();
        activeReply = { controller, threadId };
        setReplying(true);
        refreshRegenerate();   // removes it while the reply is in flight
        if (userInput) userInput.disabled = true;

        removeThinkingBubble(); // clear any orphan from a previous race
        thinkingBubble = createThinkingBubble();
        messagesDiv?.appendChild(thinkingBubble);
        if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;

        try {
            const payload = {
                message: userMessage,          // typed text only
                pasted,                        // sent separately so the server can compress it
                images,
                context,
                model: currentModel,
                ground: userWantsGrounding(userMessage),
                ip: userIP,
                token: getUserToken(),
            };

            let response;
            try {
                response = await fetch(getBackendBase() + "/chat/stream", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
            } catch (networkError) {
                removeThinkingBubble();
                if (networkError.name === "AbortError") return;   // stopped before the server answered
                console.error("Network failure while contacting backend:", networkError);
                renderMessage(
                    "⚠️ Connection lost – the server may have restarted. Please try sending your message again.",
                    "bot-message"
                );
                return;
            }

            if (response.status === 503) {
                let isDown = true;
                try {
                    const errorData = await response.json();
                    isDown = errorData.is_down !== false;
                } catch { /* unparseable body → treat as down */ }
                if (isDown) {
                    window.location.href = `${getBackendBase()}/status-page`;
                    return;
                }
                removeThinkingBubble();
                renderMessage("⚠️ Upstream hiccup — please try again in a moment.", "bot-message");
                return;
            }

            if (response.status === 403) {
                // Server confirmed a ban — sync locally and lock input.
                removeThinkingBubble();
                if (userIP) storeBannedIP(userIP);
                disableChat();
                return;
            }

            if (!response.ok) {
                removeThinkingBubble();
                renderMessage(
                    `⚠️ Server returned error ${response.status}. Please try again.`,
                    "bot-message"
                );
                return;
            }

            onAccepted?.();

            if ((response.headers.get("Content-Type") || "").includes("text/event-stream")) {
                await streamReply(response, userMessage, threadId);
                return;
            }

            // Non-streamed replies (slash commands, copyright notices) stay JSON.
            const data = await response.json();
            if (!data.response) {
                removeThinkingBubble();
                renderMessage(
                    "⚠️ Did not receive a valid response from the server.",
                    "bot-message"
                );
                return;
            }

            const botText = data.response;
            removeThinkingBubble();
            await typeBotMessage(botText);
            saveReply(threadId, data.memory_note || userMessage, botText);

        } catch (error) {
            removeThinkingBubble();
            if (error.name === "AbortError") return;   // stopped while the JSON reply was downloading
            console.error("Fetch error:", error);

            removeLastUserMessage(threadId);

            const chatBox = document.getElementById("chat-box");
            if (chatBox && chatBox.lastElementChild) {
                chatBox.removeChild(chatBox.lastElementChild);
            }

            showMessage("❌ An error occurred while sending your message. Please try again.", "bot");
        } finally {
            activeReply = null;
            setReplying(false);
            if (userInput) {
                userInput.disabled = false;
                userInput.focus();
            }
            canSendMessage = true;
            refreshRegenerate();
        }
    }

    // Saves a finished or stopped reply, unless its thread was deleted meanwhile.
    function saveReply(threadId, userMemory, botText) {
        if (!loadState().threads.some(t => t.id === threadId)) return;
        updateMemory("user", userMemory, threadId);
        updateMemory("bot", botText, threadId);
        addMessage(threadId, { text: botText, sender: "bot" });
    }

    // The send button doubles as Stop while a reply is in flight.
    function setReplying(on) {
        document.body.classList.toggle("replying", on);
        const btn = document.querySelector(".send-btn");
        if (!btn) return;
        const label = on ? "Stop generating" : "Send";
        btn.title = label;
        btn.setAttribute("aria-label", label);
        btn.innerHTML = `<i class="fa-solid ${on ? "fa-stop" : "fa-arrow-up"}" aria-hidden="true"></i>`;
    }

    function stopActiveReply() {
        activeReply?.controller.abort();
    }

    function onSendButton() {
        if (activeReply) stopActiveReply();
        else sendMessage();
    }

    // The stored user turn Regenerate/Retry re-sends: the last user message,
    // when the thread ends with it or with its reply. Legacy file uploads
    // (non-streamed /chat path) can't be re-sent.
    function regenTarget() {
        const msgs = loadChat(loadState().currentThread);
        let i = msgs.length - 1;
        if (msgs[i]?.sender === "bot") i--;
        const user = msgs[i];
        return user?.sender === "user" && !user.file ? { user, hasReply: i < msgs.length - 1 } : null;
    }

    function lastMessageEl() {
        const box = document.getElementById("chat-box");
        return box && [...box.children].reverse()
            .find(el => el.classList.contains("message") && !el.classList.contains("thinking"));
    }

    // Regenerate on the last reply, or Retry on a trailing user message (stopped
    // or failed before a reply was saved). Never while a reply is in flight.
    function refreshRegenerate() {
        document.querySelectorAll("#chat-box .regen-btn").forEach(b => b.remove());
        if (activeReply) return;
        const last = lastMessageEl();
        const row = last?.querySelector(":scope > .msg-actions");
        if (!row || !regenTarget()) return;
        const isUser = last.classList.contains("user-message");
        const btn = iconButton("fa-solid fa-rotate-right", isUser ? "Retry" : "Regenerate reply", regenerate);
        btn.classList.add("regen-btn");
        row.appendChild(btn);
    }

    async function regenerate() {
        if (!canSendMessage || activeReply) return;
        const target = regenTarget();
        if (!target) return;
        canSendMessage = false;
        const threadId = loadState().currentThread;

        // Drop the reply on screen (saved, or an unsaved error/interrupted one).
        const last = lastMessageEl();
        if (last?.classList.contains("bot-message")) last.remove();

        // Only a saved reply has stored data and a memory pair to remove.
        if (target.hasReply) {
            const state = loadState();
            const botMsg = state.chats[threadId].pop();
            saveState(state);
            popMemoryPair(threadId, botMsg.text);
        }

        const { user } = target;
        let images = user.images || [];
        const full = fullImages.get(threadId);
        if (images.length) {
            if (full?.length === images.length) images = full;
            else showNotification("Re-sent with the saved 320px image previews; full-size originals aren't kept after a reload.");
        }

        await requestReply({
            userMessage: user.text || "", pasted: user.pasted || [], images, threadId,
            userIP: await getUserIP(), context: chatMemory,
        });
    }

    // Removes the last user/bot pair from memory, but only if its bot entry is
    // the reply being regenerated; a mismatched memory is left alone.
    function popMemoryPair(threadId, botText) {
        const mem = readJSON(`chatMemory-${threadId}`, []);
        const last = mem[mem.length - 1];
        if (last?.role !== "bot" || last.content !== botText) return;
        mem.pop();
        if (mem[mem.length - 1]?.role === "user") mem.pop();
        writeJSON(`chatMemory-${threadId}`, mem);
        if (threadId === currentThread) chatMemory = mem;
    }

    // Edit: the stored messages from the edited one onward, and how many memory
    // entries they own (each saved reply owns a user/bot pair).
    function editCut(threadId, fromTs) {
        const msgs = loadChat(threadId);
        const start = msgs.findIndex(m => m.ts === fromTs);
        if (start < 0) return null;
        const removed = msgs.slice(start);
        const pairs = removed.filter((m, i) => m.sender === "bot" && removed[i - 1]?.sender === "user").length;
        return { fromTs, count: removed.length, memEntries: pairs * 2 };
    }

    // Applied once the edited send is accepted: cut storage, memory, and the old
    // messages on screen (up to the new turn).
    function applyEditCut(threadId, cut, memory, editedEl, newEl) {
        const state = loadState();
        const msgs = state.chats[threadId] || [];
        const start = msgs.findIndex(m => m.ts === cut.fromTs);
        if (start >= 0) {
            msgs.splice(start, cut.count);
            saveState(state);
        }
        writeJSON(`chatMemory-${threadId}`, memory);
        if (threadId === currentThread) chatMemory = memory;
        for (let el = editedEl; el && el !== newEl;) {
            const next = el.nextElementSibling;
            el.remove();
            el = next;
        }
    }

    // Yields {event, data} per SSE event. Bytes may be split anywhere, even
    // inside a UTF-8 character, so decode in streaming mode and only parse
    // complete (blank-line terminated) events.
    async function* readSSE(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
            const { value, done } = await reader.read();
            buf += decoder.decode(value, { stream: !done }).replace(/\r\n?/g, "\n");
            let end;
            while ((end = buf.indexOf("\n\n")) !== -1) {
                const block = buf.slice(0, end);
                buf = buf.slice(end + 2);
                let event = "message";
                const data = [];
                for (const line of block.split("\n")) {
                    if (line.startsWith("event:")) event = line.slice(6).trim();
                    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
                }
                if (data.length) yield { event, data: data.join("\n") }; // ":" pings have no data
            }
            if (done) return;
        }
    }

    // Renders a /chat/stream reply. On an error or a dropped connection the
    // partial text stays on screen with a notice and isn't saved; on Stop it's
    // treated as the finished reply and saved.
    async function streamReply(response, userMessage, threadId) {
        let text = "", el = null, painting = false, finished = false, done = null, failure = null, stopped = false;

        // Follow the bottom unless the user scrolls up; resume once they're
        // back at the bottom. Scroll events from our own writes are ignored.
        const box = document.getElementById("chat-box");
        let follow = true, ownTop = -1, lastTop = box ? box.scrollTop : 0;
        const stick = () => {
            if (!follow || !box) return;
            box.scrollTop = box.scrollHeight;
            ownTop = lastTop = box.scrollTop;
        };
        const onScroll = () => {
            const top = box.scrollTop;
            if (top === ownTop) return;
            const gap = box.scrollHeight - top - box.clientHeight;
            if (gap <= 2) follow = true;            // at the bottom (also a clamp after content shrank)
            else if (top < lastTop) follow = false; // scrolled up
            else if (gap <= 8) follow = true;
            lastTop = top;
        };
        box?.addEventListener("scroll", onScroll, { passive: true });

        const paint = () => {
            painting = false;
            if (!finished && renderMessage(text, "bot-message", true, el)) stick();
        };

        try {
            for await (const ev of readSSE(response.body)) {
                if (ev.event === "delta") {
                    text += JSON.parse(ev.data).t;
                    if (!el) {
                        removeThinkingBubble();
                        // Don't drop the reply into another thread's view.
                        if (loadState().currentThread === threadId) el = renderMessage(text, "bot-message", true);
                    } else if (!painting) {
                        painting = true;
                        requestAnimationFrame(paint);
                    }
                } else if (ev.event === "done") {
                    done = JSON.parse(ev.data);
                    break;
                } else if (ev.event === "error") {
                    failure = JSON.parse(ev.data);
                    break;
                }
            }
        } catch (err) {
            stopped = err?.name === "AbortError";
            if (!stopped) console.error("Stream interrupted:", err);
        }
        finished = true;
        removeThinkingBubble();
        box?.removeEventListener("scroll", onScroll);

        if (done || (stopped && text)) {
            const botText = done ? done.response : text;
            // Highlighting/KaTeX can change the height, so stick once more.
            if (el) { if (renderMessage(botText, "bot-message", false, el)) stick(); }
            else if (loadState().currentThread === threadId) renderMessage(botText, "bot-message");
            saveReply(threadId, done?.memory_note || userMessage, botText);
            return;
        }
        if (stopped) return;   // stopped before the first chunk: nothing to show or save

        const notice = failure?.is_down
            ? "Mist.AI went offline mid-reply. This answer is incomplete; try again once it's back."
            : failure
                ? "The model stopped mid-reply. This answer is incomplete; please try again."
                : "Connection lost mid-reply. This answer is incomplete; please try again.";
        // Final (non-streaming) render of what arrived, so it gets highlighting
        // and a Copy that copies exactly the received text; notice sits above the row.
        if (el && renderMessage(text, "bot-message", false, el)) {
            const note = document.createElement("div");
            note.className = "reply-notice";
            note.textContent = "⚠️ " + notice;
            el.insertBefore(note, el.querySelector(".msg-actions"));
            stick();
        } else if (!el && loadState().currentThread === threadId) {
            renderMessage("⚠️ " + notice, "bot-message");
        }
    }

    // Paste blocks.
    function initPasteDetection() {
        const input = document.getElementById("user-input");
        if (!input) return;

        input.addEventListener("paste", e => {
            const pasted = (e.clipboardData || window.clipboardData).getData("text");
            if (!pasted || pasted.length < CONFIG.PASTED_THRESHOLD) return;
            e.preventDefault();

            const existing = document.querySelectorAll(".pasted-block");
            if (existing.length >= CONFIG.MAX_PASTES) return;

            const clipped = pasted.slice(0, CONFIG.MAX_PASTE_CHARS);
            // Per-card id so removing one of two identical pastes removes the right one.
            const item = { id: generateUUID(), text: clipped };
            pastedItems.push(item);
            addPastedBlock(item);
        });
    }

    // Images and pasted cards share one tray (#image-preview); it shows while
    // it has any card.
    function syncTray() {
        const tray = document.getElementById("image-preview");
        if (tray) tray.classList.toggle("active", tray.children.length > 0);
    }

    function addPastedBlock(item) {
        const tray = document.getElementById("image-preview");
        if (!tray) return;

        const block = document.createElement("div");
        block.classList.add("pasted-block");
        block.dataset.id = item.id;

        const preview = document.createElement("div");
        preview.classList.add("pasted-block-text");
        preview.textContent = item.text;
        block.appendChild(preview);

        const label = document.createElement("span");
        label.classList.add("pasted-label");
        label.textContent = "PASTED";
        block.appendChild(label);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.classList.add("pasted-remove");
        removeBtn.setAttribute("aria-label", "Remove pasted text");
        removeBtn.title = "Remove pasted text";
        removeBtn.textContent = "×";
        removeBtn.onclick = () => {
            pastedItems = pastedItems.filter(p => p.id !== item.id);
            block.remove();
            syncTray();
        };
        block.appendChild(removeBtn);
        tray.appendChild(block);
        syncTray();
    }

    function clearPastedItems() {
        document.querySelectorAll("#image-preview .pasted-block").forEach(b => b.remove());
        pastedItems = [];
        syncTray();
    }

    // State/thread persistence — cached in memory, synced to localStorage.
    const STORAGE_KEY = "mistai-state";
    let _stateCache = null;

    function generateUUID() {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
    }

    function loadState() {
        if (_stateCache) return _stateCache;
        _stateCache = readJSON(STORAGE_KEY, { threads: [], chats: {}, currentThread: null });
        return _stateCache;
    }

    function saveState(state) {
        _stateCache = state;
        writeJSON(STORAGE_KEY, state);
    }

    function getThreads() { return loadState().threads; }

    function loadChat(threadId) {
        const state = loadState();
        return state.chats[threadId] ? [...state.chats[threadId]] : [];
    }

    function addMessage(threadId, message) {
        const state = loadState();
        if (!state.chats[threadId]) state.chats[threadId] = [];
        const msg = { ...message, ts: Date.now() };

        try {
            if (msg.file instanceof Blob) {
                msg.fileType = msg.file.type;
                const reader = new FileReader();
                reader.onload = () => {
                    msg.file = reader.result;
                    state.chats[threadId].push(msg);
                    saveState(state);
                };
                reader.onerror = () => {
                    // Save the text even if the attachment fails to read.
                    console.error("Failed to read message attachment; saving text only.");
                    delete msg.file;
                    state.chats[threadId].push(msg);
                    saveState(state);
                };
                reader.readAsDataURL(msg.file);
                return msg.ts;
            }
        } catch (err) {
            console.error("Attachment handling failed; saving text only:", err);
            delete msg.file;
        }

        state.chats[threadId].push(msg);
        saveState(state);
        return msg.ts;
    }

    // Returns the stored message's ts and, unless silent, its rendered element.
    function _storeNewMessage(text, sender = "user", file = null, silent = false, extra = {}) {
        let state = loadState();
        if (!state.currentThread) {
            const newThread = createThread("New Chat");
            state = loadState();
            state.currentThread = newThread.id;
            saveState(state);
            currentThread = newThread.id;
        }

        const threadId = state.currentThread;
        const message = { text, sender, ...extra };

        const headerEl = document.querySelector("header.header");
        if (headerEl) headerEl.style.display = "none";

        const thread = state.threads.find(t => t.id === threadId);
        if (thread) { thread.hideHeader = true; saveState(state); }

        if (file) message.file = file;
        const ts = addMessage(threadId, message);

        let el = null;
        if (!silent) {
            if (file) showMessageWithImage(text, file, sender);
            else el = renderMessage(text, sender === "user" ? "user-message" : "bot-message");
        }
        if (el) el.dataset.ts = ts;
        return { ts, el };
    }

    function handleNewMessage(text, sender = "user", file = null) {
        _storeNewMessage(text, sender, file, false);
    }

    function handleNewMessageSilent(text, sender = "user", file = null) {
        _storeNewMessage(text, sender, file, true);
    }

    function removeLastUserMessage(threadId) {
        const state = loadState();
        if (!state.chats[threadId]) return;
        for (let i = state.chats[threadId].length - 1; i >= 0; i--) {
            if (state.chats[threadId][i].sender === "user") {
                state.chats[threadId].splice(i, 1);
                break;
            }
        }
        saveState(state);
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("FileReader failed to read the file"));
        });
    }

    function showMessageWithImage(text, file, sender = "user") {
        const messagesDiv = document.getElementById("chat-box");
        if (!messagesDiv) return;

        let imageUrl = "";
        if (file instanceof Blob) imageUrl = URL.createObjectURL(file);
        else if (typeof file === "string") imageUrl = file;
        else return;

        const messageElement = document.createElement("div");
        messageElement.classList.add("message", sender === "bot" ? "bot-message" : "user-message");

        // Built via DOM APIs — text is user content and never goes through innerHTML.
        const container = document.createElement("div");
        container.classList.add("image-container");
        const wrapperDiv = document.createElement("div");
        wrapperDiv.classList.add("image-wrapper");
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "Uploaded Image";
        img.classList.add("uploaded-image");
        wrapperDiv.appendChild(img);
        container.appendChild(wrapperDiv);
        if (text) {
            const textDiv = document.createElement("div");
            textDiv.classList.add("user-text");
            textDiv.textContent = text;
            container.appendChild(textDiv);
        }
        messageElement.appendChild(container);

        if (sender !== "bot") {
            attachEditButton(messageElement, text || "");
        }

        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // Threads.
    function createThread(name) {
        stopActiveReply();   // switching away acts as Stop
        const state = loadState();
        const id = generateUUID();
        const thread = { id, name: name || `New Chat ${state.threads.length + 1}`, hideHeader: false, pinned: false };
        state.threads.push(thread);
        state.chats[id] = [];
        state.currentThread = id;
        saveState(state);
        renderThreads();
        switchThread(id);
        setTimeout(() => {
            const newName = prompt("Enter a name for this chat thread:", thread.name);
            if (newName && newName.trim()) {
                thread.name = newName.trim();
                saveState(state);
                renderThreads();
            }
        }, 50);
        return thread;
    }

    function switchThread(threadId) {
        const state = loadState();
        if (!threadId || !state.chats[threadId]) return;
        if (threadId !== state.currentThread) stopActiveReply();   // switching away acts as Stop

        currentThread = threadId;
        chatMemory = readJSON(`chatMemory-${threadId}`, []);
        state.currentThread = threadId;

        const chatContainer = document.getElementById("chat-box");
        if (!chatContainer) return;

        chatContainer.innerHTML = "";
        const messages = loadChat(threadId);
        messages.forEach(renderStoredMessage);
        refreshRegenerate();

        renderThreads();

        setTimeout(() => {
            const list = document.getElementById("chat-threads-list");
            const active = list?.querySelector(`[data-thread-id="${threadId}"]`)?.closest("li");
            if (active) {
                list.querySelectorAll("li").forEach(li => li.classList.remove("active-thread"));
                active.classList.add("active-thread");
            }
        }, 10);

        const thread = state.threads.find(t => t.id === threadId);
        if (!thread) return;

        const headerEl = document.querySelector("header.header");
        if (!headerEl) return;

        if (messages.length === 0) { headerEl.style.display = "block"; thread.hideHeader = false; }
        else { headerEl.style.display = "none"; thread.hideHeader = true; }

        saveState(state);
    }

    function deleteChat(threadId) {
        stopActiveReply();   // a stopped reply for this thread isn't saved (saveReply checks it exists)
        const state = loadState();
        state.threads = state.threads.filter(t => t.id !== threadId);
        delete state.chats[threadId];
        if (state.currentThread === threadId)
            state.currentThread = state.threads.length ? state.threads[state.threads.length - 1].id : null;
        saveState(state);
        renderThreads();
        if (state.currentThread) switchThread(state.currentThread);
        else {
            const box = document.getElementById("chat-box");
            if (box) box.innerHTML = "";
        }
    }

    function togglePinThread(threadId) {
        const state = loadState();
        const thread = state.threads.find(t => t.id === threadId);
        if (!thread) return;
        thread.pinned = !thread.pinned;
        saveState(state);
        renderThreads();
    }

    function buildThreadListItem(thread, state) {
        const li = document.createElement("li");
        li.className = thread.id === state.currentThread ? "active-thread" : "";

        const link = document.createElement("button");
        link.className = "thread-link";
        link.dataset.threadId = thread.id;
        link.textContent = thread.name;
        link.addEventListener("click", () => switchThread(thread.id));

        const pin = document.createElement("button");
        pin.className = "delete-btn pin-btn";
        pin.title = thread.pinned ? "Unpin" : "Pin";
        pin.innerHTML = `<i class="fa-solid fa-thumbtack"></i>`;
        if (thread.pinned) pin.classList.add("pinned");
        pin.addEventListener("click", e => { e.stopPropagation(); togglePinThread(thread.id); });

        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "×";
        del.addEventListener("click", e => { e.stopPropagation(); deleteChat(thread.id); });

        link.appendChild(pin);
        li.appendChild(link);
        li.appendChild(del);
        return li;
    }

    function renderThreads() {
        const threads = getThreads();
        const list = document.getElementById("chat-threads-list");
        const pinnedSection = document.getElementById("pinned-threads-section");
        const pinnedList = document.getElementById("pinned-threads-list");
        if (!list || !pinnedList || !pinnedSection) return;

        list.innerHTML = "";
        pinnedList.innerHTML = "";

        if (threads.length === 0) {
            list.innerHTML = "<li><em>No chats yet</em></li>";
            pinnedSection.style.display = "none";
            return;
        }

        const state = loadState();
        const pinned = threads.filter(t => t.pinned);
        const regular = threads.filter(t => !t.pinned);

        pinnedSection.style.display = pinned.length ? "block" : "none";
        pinned.forEach(thread => pinnedList.appendChild(buildThreadListItem(thread, state)));

        if (regular.length === 0) {
            list.innerHTML = "<li><em>No chats yet</em></li>";
        } else {
            regular.forEach(thread => list.appendChild(buildThreadListItem(thread, state)));
        }
    }

    // Input sizing/word counter — deferred to DOMContentLoaded so it never
    // runs before #user-input exists.
    const inputSizing = { minHeight: 42, maxHeight: 300 };
    let wordCounter = null;

    function initInputSizing() {
        const input = document.getElementById("user-input");
        if (!input) return;
        const computedStyle = getComputedStyle(input);
        inputSizing.maxHeight = parseInt(computedStyle.maxHeight) || 300;
        inputSizing.minHeight = parseInt(computedStyle.minHeight) || 42;

        wordCounter = document.getElementById("word-counter");
        if (!wordCounter) {
            wordCounter = document.createElement("div");
            wordCounter.id = "word-counter";
            wordCounter.style.fontSize = "12px";
            wordCounter.style.marginTop = "4px";
            wordCounter.style.textAlign = "right";
            wordCounter.style.display = "none";
            input.parentNode.appendChild(wordCounter);
        }

        input.addEventListener("input", e => {
            if (e.target !== input) return;
            const value = input.value;
            let words = value.trim() === "" ? [] : value.trim().split(/\s+/);

            if (words.length > CONFIG.MAX_WORDS) {
                words = words.slice(0, CONFIG.MAX_WORDS);
                input.value = words.join(" ");
                input.style.backgroundColor = "#444";
                input.style.color = "#aaa";
                input.disabled = true;
                wordCounter.textContent = `Word limit reached! (${CONFIG.MAX_WORDS}/${CONFIG.MAX_WORDS})`;
                wordCounter.style.color = "red";
                wordCounter.style.display = "block";
            } else {
                input.style.backgroundColor = "";
                input.style.color = "";
                input.disabled = false;
                if (words.length >= CONFIG.WORD_WARNING_THRESHOLD) {
                    wordCounter.textContent = `${words.length} / ${CONFIG.MAX_WORDS}`;
                    wordCounter.style.color = words.length >= CONFIG.MAX_WORDS ? "red" : "inherit";
                    wordCounter.style.display = "block";
                } else {
                    wordCounter.style.display = "none";
                }
            }

            // Soft-wrap after 50 words, preserving the caret position.
            if (words.length > 50 && !input.value.includes("\n")) {
                const selStart = input.selectionStart;
                const selEnd = input.selectionEnd;
                const first50 = words.slice(0, 50).join(" ");
                const insertAt = first50.length;
                if (insertAt < input.value.length) {
                    input.value =
                        input.value.slice(0, insertAt) + "\n" + input.value.slice(insertAt + 1);
                    const adjust = pos => (pos > insertAt ? pos : pos);
                    input.selectionStart = adjust(selStart);
                    input.selectionEnd = adjust(selEnd);
                }
            }

            if (input.value.includes("\n")) {
                input.style.height = "auto";
                input.style.height = `${Math.min(input.scrollHeight, inputSizing.maxHeight)}px`;
            } else {
                input.style.height = `${inputSizing.minHeight}px`;
            }
        });
    }

    // Message editing.
    function enableEditMode(messageElement, originalContent) {
        const textarea = document.createElement("textarea");
        textarea.classList.add("edit-textarea");
        textarea.value = originalContent;

        const saveButton = document.createElement("button");
        saveButton.classList.add("save-button");
        saveButton.textContent = "Save";
        // Restoring the original nodes keeps attachment cards and the action row.
        const original = [...messageElement.childNodes];
        const restore = () => messageElement.replaceChildren(...original);
        saveButton.onclick = () => saveEditedMessage(messageElement, textarea.value, restore);

        const cancelButton = document.createElement("button");
        cancelButton.classList.add("cancel-button");
        cancelButton.textContent = "Cancel";
        cancelButton.onclick = restore;

        messageElement.replaceChildren(textarea, saveButton, cancelButton);
    }

    // The edited text goes out as a new message. The old message and everything
    // after it are removed (on screen, in history and memory) only once the
    // server accepts the new request; until then, or if it fails, they stay.
    function saveEditedMessage(messageElement, newContent, restore) {
        if (!canSendMessage || activeReply || !newContent.trim()) return;
        restore();
        const fromTs = Number(messageElement.dataset.ts);
        sendMessage(newContent, fromTs ? { fromTs, element: messageElement } : null);
    }

    // Thinking bubble.
    function createThinkingBubble() {
        const bubble = document.createElement("div");
        bubble.classList.add("message", "bot-message", "thinking");
        bubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;
        delayTimeout = setTimeout(() => {
            if (bubble.isConnected) bubble.textContent = getRandomDelayMessage();
        }, CONFIG.THINKING_DELAY_MSG_MS);
        return bubble;
    }

    function removeThinkingBubble() {
        if (thinkingBubble) { thinkingBubble.remove(); thinkingBubble = null; }
        if (delayTimeout) { clearTimeout(delayTimeout); delayTimeout = null; }
    }

    function getRandomDelayMessage() {
        const messages = [
            "⏳ Sorry for the delay! Mist.AI had to grab a snack.",
            "⚙️ Still warming up the circuits...",
            "🕵️‍♂️ Looking that up in the secret AI library...",
            "🐢 Whoops, it's a slow moment. Thanks for your patience!",
            "📡 Fetching data from deep space...",
            "🧠 Thinking really hard about that one...",
            "💤 Zzz… just kidding, back now!",
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    }

    // Capabilities ticker — stops itself if the element leaves the DOM.
    const capabilities = [
        "Version 10 - Launched February 2026 🚀",
        "Chat Threads for organized conversations 🧵",
        "Analyze images & compress large text automatically 🔍🧠",
        "Ask for the latest headlines 📰",
        "Summarize your long texts ✂️",
        "Translate messages instantly 🌐",
        "Explain coding concepts 💻",
        "Check your grammar effortlessly ✏️",
        "Upload images via drag & drop 🖼️",
        "Show real-time weather & news 🌦️",
        "Use slash commands like /joke, /rps, /flipcoin 🎲",
        "Remembers session context 🧠",
        "Customizable themes (Galaxy, Golden, Cherry) 🎨",
        "Supports PDF, DOCX, TXT, JSON uploads 📄",
        "Friendly AI model names: Nova, Sage, Flux 🤖",
        "No knowledge cutoff – up-to-date info 🌐",
        "IP + Token ban system blocks abuse 🚫",
        "Chrome/Firefox extension integration 🖱️",
        "Offline PWA mode for chatting anywhere 🌍",
        "Edit your messages after sending ✍️",
        "Notifications for model switching & important events 🔔",
    ];

    function startCapabilitiesTicker() {
        const subtitleEl = document.getElementById("micro-subtitle");
        if (!subtitleEl) return;
        let capIndex = 0;

        (async function ticker() {
            while (subtitleEl.isConnected) {
                const text = capabilities[capIndex];
                subtitleEl.textContent = "";

                for (let j = 0; j < text.length && subtitleEl.isConnected; j++) {
                    subtitleEl.textContent += text[j];
                    await new Promise(res => setTimeout(res, 50));
                }

                await new Promise(res => setTimeout(res, 1500));
                capIndex = (capIndex + 1) % capabilities.length;
            }
        })();
    }

    // Memory + backend helpers.
    function updateMemory(role, content, threadId = currentThread) {
        if (!threadId) return;
        const threadMemory = readJSON(`chatMemory-${threadId}`, []);
        const last = threadMemory[threadMemory.length - 1];
        if (last?.role === role && last?.content === content) return;
        threadMemory.push({ role, content });

        if (threadMemory.length > CONFIG.MEMORY_CAP) threadMemory.shift();

        writeJSON(`chatMemory-${threadId}`, threadMemory);
        if (threadId === currentThread) chatMemory = threadMemory;
    }

    function getBackendBase() {
        return isLocalDev() ? "http://127.0.0.1:5000" : "https://mist-ai.fly.dev";
    }

    // Periodic backend health poll → redirect to the status page when down.
    let _downCheckInterval = null;

    async function checkDownMode() {
        try {
            const res = await fetch(`${getBackendBase()}/status`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });
            const data = await res.json();
            if (data.is_down) window.location.href = `${getBackendBase()}/status-page`;
        } catch (err) {
            console.error("Failed to check down mode:", err);
        }
    }

    function startDownModeChecker() {
        if (_downCheckInterval) return;
        checkDownMode();
        _downCheckInterval = setInterval(checkDownMode, CONFIG.DOWN_CHECK_INTERVAL_MS);
    }

    // Model switching + notifications.
    function swapModel(selectElement) {
        const selectedValue = selectElement.value;
        if (isSwapping || selectedValue === currentModel) return;
        isSwapping = true;
        currentModel = selectedValue;
        const displayName = selectElement.options[selectElement.selectedIndex].text;
        showNotification(`Model switched to: ${displayName}`);
        setTimeout(() => { isSwapping = false; }, CONFIG.MODEL_SWAP_DEBOUNCE_MS);
    }

    function showNotification(message) {
        const notification = document.createElement("div");
        notification.classList.add("notification");
        notification.textContent = message;
        document.body.appendChild(notification);
        gsap.fromTo(notification, { opacity: 0, y: -20 }, {
            opacity: 1, y: 0, duration: 0.5, ease: "power2.out",
            onComplete: () => {
                setTimeout(() => {
                    gsap.to(notification, {
                        opacity: 0, y: 20, duration: 0.3, ease: "power2.in",
                        onComplete: () => notification.remove(),
                    });
                }, 2000);
            },
        });
    }

    function showMessage(message, sender = "user") {
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", sender === "bot" ? "bot-message" : "user-message");
        // Always sanitized — never a raw HTML injection sink.
        setSafeHtml(messageElement, message);
        if (sender !== "bot") {
            attachEditButton(messageElement, message);
        }
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Push notifications — guarded so init can't double-fire the daily tip.
    const DAILY_NOTIF_KEY = "mistai_last_tip_day";
    const COMMIT_NOTIF_KEY = "mistai_last_commit_day";
    const LAST_TIP_INDEX_KEY = "mistai_last_tip_index";
    let _notifInitRan = false;

    const NOTIF_MESSAGES = [
        "💡 Try /joke or /riddle for something fun!",
        "🔍 Ask Mist.AI anything — news, weather, math, code.",
        "🎨 Try a new theme in the top right corner!",
        "📁 You can upload images or documents for Mist.AI to read!",
        "⏳ If Mist.AI is taking a while, it's probably fetching the latest data!",
        "🤖 Mist.AI is always learning. Feedback is appreciated!",
        "🧠 Remember, Mist.AI has no knowledge cutoff — ask about recent events!",
    ];

    async function initNotifications() {
        if (typeof Notification === "undefined") return;

        if (Notification.permission === "denied") {
            console.log("Notifications are denied by user");
            return;
        }

        if (Notification.permission === "default") {
            Notification.requestPermission().catch(err => {
                console.warn("Notification request failed:", err);
            });
            return;
        }

        if (Notification.permission !== "granted") return;

        if (_notifInitRan) return;
        _notifInitRan = true;

        const today = new Date().toDateString();
        const lastTipDay = localStorage.getItem(DAILY_NOTIF_KEY);
        if (lastTipDay !== today) {
            localStorage.setItem(DAILY_NOTIF_KEY, today);
            const nextIndex = (parseInt(localStorage.getItem(LAST_TIP_INDEX_KEY) ?? "-1") + 1) % NOTIF_MESSAGES.length;
            localStorage.setItem(LAST_TIP_INDEX_KEY, String(nextIndex));
            new Notification("✨ Mist.AI", {
                body: NOTIF_MESSAGES[nextIndex],
                icon: "/mistaifaviocn/android-chrome-192x192.png"
            });
        }

        const lastCommitDay = localStorage.getItem(COMMIT_NOTIF_KEY);
        const daysSinceCommit = lastCommitDay ? Math.floor((new Date() - new Date(lastCommitDay)) / (1000 * 60 * 60 * 24)) : 999;
        if (daysSinceCommit >= 5) {
            localStorage.setItem(COMMIT_NOTIF_KEY, today);
            try {
                const res = await fetch("https://api.github.com/repos/Misto0o/Mist.AI/commits?per_page=1");
                const data = await res.json();
                const short = (data[0]?.commit?.message || "New update pushed!").split("\n")[0].slice(0, 80);
                new Notification("🛠️ Mist.AI Updated", {
                    body: short,
                    icon: "/mistaifaviocn/android-chrome-192x192.png"
                });
            } catch (e) {
                console.warn("GitHub fetch failed:", e);
            }
        }
    }

    function renderUserTurn(typedText, pasted = [], images = []) {
        const box = document.getElementById("chat-box");
        if (!box) return;
        const el = document.createElement("div");
        el.classList.add("message", "user-message");

        // Images and pasted cards in one row above the typed text.
        if (images.length || pasted.length) {
            const row = document.createElement("div");
            row.className = "turn-attachments";
            images.forEach((src, i) => {
                const img = document.createElement("img");
                img.src = src;
                img.alt = `Image ${i + 1}`;
                row.appendChild(img);
            });
            pasted.forEach(p => {
                const chip = document.createElement("div");
                chip.classList.add("pasted-chip-inline");
                const preview = document.createElement("span");
                preview.textContent = p.slice(0, 120);
                const label = document.createElement("span");
                label.classList.add("chip-label");
                label.textContent = "PASTED";
                chip.append(preview, label);
                row.appendChild(chip);
            });
            el.appendChild(row);
        }

        if (typedText.trim()) {
            const t = document.createElement("div");
            t.textContent = typedText;
            el.appendChild(t);
        }

        attachEditButton(el, typedText);
        box.appendChild(el);
        box.scrollTop = box.scrollHeight;
        return el;
    }

    function renderStoredMessage(msg) {
        if (msg.sender === "bot") return renderMessage(msg.text, "bot-message");
        if (msg.file) return showMessageWithImage(msg.text, msg.file, msg.sender);
        const el = msg.pasted?.length || msg.images?.length
            ? renderUserTurn(msg.text || "", msg.pasted || [], msg.images || [])
            : renderMessage(msg.text, "user-message");
        // Edit uses this to find the stored message.
        if (el && msg.ts) el.dataset.ts = msg.ts;
    }
    // Single init sequence — explicit ordering, no scattered listeners.
    document.addEventListener("DOMContentLoaded", () => {
        initInputSizing();
        initPasteDetection();
        initThreadsUI();
        initInputHandlers();
        initThemePicker();
        initUploadsAndDnD();
        initServiceWorker();
        initSidebar();
        initModals();
        initSlashCommands();
        initKonami();
        initToolsMenu();
        initMobileSendButton();
        startCapabilitiesTicker();
        startDownModeChecker();
    });

    function initThreadsUI() {
        const state = loadState();

        if (!state.threads.length) {
            const first = createThread("New Chat 1");
            switchThread(first.id);
        } else {
            renderThreads();
            if (state.currentThread && state.threads.some(t => t.id === state.currentThread))
                switchThread(state.currentThread);
            else switchThread(state.threads[state.threads.length - 1].id);
        }

        const headerEl = document.querySelector("header.header");
        const activeThread = state.threads.find(t => t.id === state.currentThread);
        if (headerEl && activeThread) {
            headerEl.style.display = activeThread.hideHeader ? "none" : "block";
        }

        const threadSearch = document.getElementById("thread-search");
        if (threadSearch) {
            threadSearch.addEventListener("input", () => {
                const query = threadSearch.value.trim().toLowerCase();
                document.querySelectorAll("#chat-threads-list li, #pinned-threads-list li").forEach(li => {
                    const label = li.querySelector(".thread-link")?.textContent?.toLowerCase() || "";
                    li.style.display = label.includes(query) ? "" : "none";
                });
            });
        }

        const btn = document.getElementById("new-thread-btn");
        if (btn) {
            btn.addEventListener("click", () => {
                const newThread = createThread(`New Chat ${getThreads().length + 1}`);
                switchThread(newThread.id);
                const userInput = document.getElementById("user-input");
                if (userInput) userInput.value = "";
                clearImagePreviews();
            });
        }
    }

    function initInputHandlers() {
        const textarea = document.getElementById("user-input");
        if (!textarea) return;
        textarea.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                if (event.shiftKey) {
                    const cursorPosition = textarea.selectionStart;
                    const textBefore = textarea.value.substring(0, cursorPosition);
                    const textAfter = textarea.value.substring(cursorPosition);
                    textarea.value = textBefore + "\n" + textAfter;
                    textarea.selectionStart = textarea.selectionEnd = cursorPosition + 1;
                } else {
                    event.preventDefault();
                    sendMessage();
                }
            }
        });
    }

    function initThemePicker() {
        const themeSelect = document.getElementById("theme-select");
        if (!themeSelect) return;
        const savedTheme = localStorage.getItem("mistai-theme") || "dark";

        themeSelect.value = savedTheme;
        applyTheme(savedTheme);

        themeSelect.addEventListener("change", () => {
            const selectedTheme = themeSelect.value;
            localStorage.setItem("mistai-theme", selectedTheme);
            gsap.to("body", {
                x: "100%", opacity: 0, duration: 0.3,
                onComplete: () => {
                    applyTheme(selectedTheme);
                    gsap.fromTo("body", { x: "-100%", opacity: 0 }, { x: "0%", opacity: 1, duration: 0.3 });
                },
            });
        });
    }

    // Downscales + re-encodes as JPEG so huge phone photos don't choke the backend.
    function compressImage(file, maxDim, quality = CONFIG.IMAGE_QUALITY) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#fff"; // transparent PNGs would turn black as JPEG
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image failed to load")); };
            img.src = url;
        });
    }

    function addImages(files) {
        for (const file of files) {
            if (!file.type.startsWith("image/")) continue;
            if (uploadedFiles.length >= CONFIG.MAX_IMAGES) {
                showNotification(`Max ${CONFIG.MAX_IMAGES} images per message`);
                break;
            }
            uploadedFiles.push(file);
        }
        renderImagePreviews();
    }

    function renderImagePreviews() {
        const c = document.getElementById("image-preview");
        if (!c) return;
        // Only the image cards; pasted cards in the same tray stay put.
        c.querySelectorAll(".preview-wrapper").forEach(w => w.remove());
        const firstPaste = c.querySelector(".pasted-block");
        uploadedFiles.forEach((file, i) => {
            const wrap = document.createElement("div");
            wrap.className = "preview-wrapper";
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            img.onload = () => URL.revokeObjectURL(img.src);
            img.className = "uploaded-preview";
            img.alt = `Preview ${i + 1}`;
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "remove-btn";
            rm.setAttribute("aria-label", `Remove image ${i + 1}`);
            rm.title = "Remove image";
            rm.textContent = "✖";
            rm.addEventListener("click", () => { uploadedFiles.splice(i, 1); renderImagePreviews(); });
            wrap.append(img, rm);
            c.insertBefore(wrap, firstPaste);
        });
        syncTray();
    }

    function clearImagePreviews() {
        uploadedFiles = [];
        renderImagePreviews();
    }

    async function uploadFile(file, text = "") {
        const formData = new FormData();
        formData.append("file", file);
        try {
            const response = await fetch(getBackendBase() + "/chat", {
                method: "POST",
                body: formData,
                headers: { Accept: "application/json" },
            });
            const result = await response.json();
            if (result.error) { showMessage(`❌ Upload failed: ${result.error}`, "bot"); return; }
            const extractedText = result.response?.trim() || "⚠️ No readable text found.";
            chatMemory.push({ role: "user", content: `User uploaded a document and said: "${text}". Extracted text: ${extractedText}` });
            showMessage("📄 Mist.AI has read the document. How can I assist?", "bot");
        } catch (error) {
            console.error("File upload failed:", error);
            showMessage("❌ Error uploading file", "bot");
        }
    }

    function initUploadsAndDnD() {
        const uploadImageBtn = document.getElementById("upload-image-btn");
        const uploadDocumentBtn = document.getElementById("upload-document-btn");
        const fileInputImage = document.getElementById("file-upload-image");
        const fileInputDocument = document.getElementById("file-upload-document");
        const toolsMenuInner = document.getElementById("tools-menu");

        uploadImageBtn?.addEventListener("click", () => { fileInputImage?.click(); if (toolsMenuInner) toolsMenuInner.style.display = "none"; });
        uploadDocumentBtn?.addEventListener("click", () => { fileInputDocument?.click(); if (toolsMenuInner) toolsMenuInner.style.display = "none"; });

        fileInputImage?.addEventListener("change", e => {
            addImages(Array.from(e.target.files));
            e.target.value = ""; // lets you re-pick the same file
        });

        fileInputDocument?.addEventListener("change", e => {
            const file = e.target.files[0];
            if (file) {
                showMessage(`📤 Uploading document: ${file.name}...`, "bot");
                uploadFile(file, document.getElementById("user-input")?.value.trim() || "");
            }
        });

        const dropZone = document.getElementById("chat-box");
        if (dropZone) {
            dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
            dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
            dropZone.addEventListener("drop", async e => {
                e.preventDefault();
                dropZone.classList.remove("drag-over");
                const files = Array.from(e.dataTransfer.files);
                const imgs = files.filter(f => f.type.startsWith("image/"));
                if (imgs.length) addImages(imgs);
                const doc = files.find(f => !f.type.startsWith("image/"));
                if (doc) {
                    showMessage(`📤 Uploading document: ${doc.name}...`, "bot");
                    await uploadFile(doc, document.getElementById("user-input")?.value.trim() || "");
                }
            });
        }

        function handleImagePaste(e) {
            const imgs = Array.from(e.clipboardData.items)
                .filter(it => it.type.startsWith("image/"))
                .map(it => it.getAsFile())
                .filter(Boolean);
            if (imgs.length) { addImages(imgs); e.preventDefault(); }
        }
        document.addEventListener("paste", handleImagePaste);
    }

    function initServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register("/service-worker.js")
            .then(async reg => {
                console.log("✅ SW registered", reg);
                if (reg.installing) {
                    await new Promise(resolve => {
                        reg.installing.addEventListener("statechange", e => {
                            if (e.target.state === "activated") resolve();
                        });
                    });
                }
                initNotifications();
            })
            .catch(err => console.error("❌ SW failed:", err));
    }

    function initSidebar() {
        const sidebar = document.querySelector(".sidebar");
        const sidebarToggle = document.getElementById("sidebarToggle");
        const closeSidebar = document.getElementById("closeSidebar");
        if (sidebarToggle) sidebarToggle.addEventListener("click", () => sidebar?.classList.toggle("expanded"));
        if (closeSidebar) closeSidebar.addEventListener("click", () => sidebar?.classList.remove("expanded"));
    }

    function initModals() {
        const readmeModal = document.getElementById("readme-modal");
        const readmeContent = document.getElementById("readme-content");
        const closeBtn = document.getElementById("close-btn");

        window.openReadmeModal = function () {
            if (!readmeModal || !readmeContent) return;
            readmeModal.style.display = "flex";
            fetch("https://raw.githubusercontent.com/Misto0o/Mist.AI/master/README.md")
                .then(r => r.text())
                // Sanitized — this is externally-fetched content.
                .then(data => { setSafeHtml(readmeContent, new showdown.Converter().makeHtml(data)); })
                .catch(() => { readmeContent.innerHTML = "<p>Error loading ReadMe content.</p>"; });
        };

        if (closeBtn) closeBtn.onclick = () => { if (readmeModal) readmeModal.style.display = "none"; };
        window.addEventListener("click", event => { if (event.target === readmeModal) readmeModal.style.display = "none"; });

        const settingsModal = document.getElementById("settings-modal");
        const closeSettingsBtn = document.getElementById("close-settings-btn");

        window.openSettingsModal = function () {
            if (settingsModal) settingsModal.style.display = "flex";
        };

        if (closeSettingsBtn) closeSettingsBtn.onclick = () => { settingsModal.style.display = "none"; };
        window.addEventListener("click", event => { if (event.target === settingsModal) settingsModal.style.display = "none"; });
    }

    function initSlashCommands() {
        const inputField = document.getElementById("user-input");
        const slashButton = document.getElementById("slash-button");
        if (!inputField) return;

        const suggestionsBox = document.createElement("div");
        suggestionsBox.id = "command-suggestions";
        Object.assign(suggestionsBox.style, {
            position: "absolute", color: "#fff", border: "1px solid #444",
            backgroundColor: "#222", padding: "5px", zIndex: "1000",
            borderRadius: "5px", cursor: "pointer", display: "none",
            transform: "translateY(-100%)",
        });
        document.body.appendChild(suggestionsBox);

        const commands = ["/flipcoin", "/rps", "/joke", "/riddle", "/weather", "/prompt", "/fact", "/help"];

        function showSuggestions() {
            suggestionsBox.innerHTML = commands.map(cmd => `<div class="suggestion-item">${cmd}</div>`).join("");
            const rect = inputField.getBoundingClientRect();
            suggestionsBox.style.left = `${rect.left}px`;
            suggestionsBox.style.top = `${rect.bottom + window.scrollY + 5}px`;
            suggestionsBox.style.display = "block";
        }

        inputField.addEventListener("input", e => {
            suggestionsBox.style.display = e.target.value.startsWith("/") ? "block" : "none";
            if (e.target.value.startsWith("/")) showSuggestions();
        });

        slashButton?.addEventListener("click", e => {
            e.preventDefault();
            if (!inputField.value.startsWith("/")) inputField.value = "/";
            inputField.focus();
            showSuggestions();
        });

        suggestionsBox.addEventListener("click", e => {
            if (e.target.classList.contains("suggestion-item")) {
                inputField.value = e.target.innerText;
                suggestionsBox.style.display = "none";
                inputField.focus();
            }
        });

        document.addEventListener("click", e => {
            if (!inputField.contains(e.target) && !suggestionsBox.contains(e.target) && e.target !== slashButton) {
                suggestionsBox.style.display = "none";
            }
        });
    }

    function initKonami() {
        const konamiCodeArrow = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
        const konamiCodeText = "up up down down left right left right b a start";
        let konamiInputArrow = [];
        let textInput = "";

        function unlockKonamiCode() {
            document.body.classList.add("konami-theme");
            const userInput = document.getElementById("user-input");
            if (userInput) userInput.value = "";
            const chatBox = document.getElementById("chat-box");
            if (chatBox) {
                const msg = document.createElement("div");
                msg.classList.add("chat-message");
                msg.textContent = "🎮 You unlocked the secret Konami Code! Extra lives granted (Check Themes). 😉";
                chatBox.appendChild(msg);
            }
            const konamiOption = document.getElementById("konami-option");
            if (konamiOption) konamiOption.style.display = "block";
        }

        window.addEventListener("keydown", e => {
            konamiInputArrow.push(e.key);
            if (konamiInputArrow.length > konamiCodeArrow.length) konamiInputArrow.shift();
            if (JSON.stringify(konamiInputArrow) === JSON.stringify(konamiCodeArrow)) {
                unlockKonamiCode();
                konamiInputArrow = [];
            }
        });

        const userInput = document.getElementById("user-input");
        if (userInput) {
            userInput.addEventListener("keyup", e => {
                if (e.key === "Backspace") textInput = textInput.slice(0, -1);
                else if (e.key.length === 1) textInput += e.key.toLowerCase();
                if (textInput === konamiCodeText) { unlockKonamiCode(); textInput = ""; }
            });
        }
    }

    function initToolsMenu() {
        const toolsToggle = document.getElementById("tools-toggle");
        const toolsMenu = document.getElementById("tools-menu");
        const fileInputs = document.querySelectorAll(".upload-input");
        if (!toolsToggle || !toolsMenu) return;
        let menuOpen = false;

        toolsToggle.addEventListener("click", () => {
            menuOpen = !menuOpen;
            toolsMenu.style.display = menuOpen ? "block" : "none";
        });

        document.addEventListener("click", event => {
            if (!toolsMenu.contains(event.target) && !toolsToggle.contains(event.target)) {
                toolsMenu.style.display = "none";
                menuOpen = false;
            }
        });

        fileInputs.forEach(input => {
            input.addEventListener("click", () => {
                setTimeout(() => {
                    if (!input.value) { toolsMenu.style.display = "none"; menuOpen = false; }
                }, 500);
            });
        });
    }

    function initMobileSendButton() {
        const sendBtn = document.querySelector(".send-btn");
        if (sendBtn) {
            sendBtn.addEventListener("touchstart", (e) => {
                e.preventDefault();
                onSendButton();
            }, { passive: false });
        }
    }

    // Page-load work: draft restore, ban check, notifications.
    window.addEventListener("load", async () => {
        const state = loadState();
        if (state.currentThread) switchThread(state.currentThread);

        const savedInput = localStorage.getItem("mistai-draft");
        const ui = document.getElementById("user-input");
        if (ui) {
            if (savedInput) ui.value = savedInput;
            ui.addEventListener("input", () => {
                localStorage.setItem("mistai-draft", ui.value);
            });
        }

        getUserToken();
        const userIP = await getUserIP();
        await checkBanOnLoad();
        if (userIP && isIPBanned(userIP)) disableChat();
        setTimeout(() => {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") initNotifications();
        }, 3000);
    });

    window.addEventListener("beforeunload", () => {
        const ui = document.getElementById("user-input");
        if (ui) localStorage.setItem("mistai-draft", ui.value || "");
    });

    // Public API — only what the HTML calls directly.
    window.sendMessage = sendMessage;
    window.onSendButton = onSendButton;
    window.swapModel = swapModel;
    window.showRandomPrompt = function () { sendMessage("random prompt"); };
    window.showFunFact = function () { sendMessage("fun fact"); };
    window.handleNewMessage = handleNewMessage;
    window.handleNewMessageSilent = handleNewMessageSilent;
    window.showMessage = showMessage;
    window.MistRender = { renderMessage, sanitizeHtml, readSSE };

})();
