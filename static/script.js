document.addEventListener("focusin", e => {
    if (!e.target.classList.contains("edit-textarea")) return;
    document.addEventListener("click", function exitEdit(ev) {
        if (!e.target.contains(ev.target)) {
            e.target.closest(".message")?.querySelector(".cancel-button")?.click();
            document.removeEventListener("click", exitEdit);
        }
    });
});

// =========================
// Markdown / CodeMirror
// =========================
const converter = new showdown.Converter({
    simpleLineBreaks: true,
    omitExtraWLInCodeBlocks: true,
});

function initializeCodeMirror(container, code, mode = "text") {
    if (!container) return;
    container.style.fontSize = "14px";
    container.style.maxWidth = "100%";
    container.style.overflowX = "auto";
    container.style.background = "#282a36";
    container.style.borderRadius = "6px";
    container.style.margin = "8px 0";
    container.style.padding = "8px";

    const editor = CodeMirror(container, {
        value: code,
        mode: mode,
        theme: "dracula",
        readOnly: true,
        lineNumbers: true,
        viewportMargin: Infinity,
    });

    setTimeout(() => editor.refresh(), 0);
    editor.setCursor(0, 0);
    editor.getWrapperElement().style.fontSize = "14px";
    editor.getWrapperElement().style.lineHeight = "1.5";
    editor.getWrapperElement().style.maxWidth = "100%";
    editor.getWrapperElement().style.overflowX = "auto";
    editor.getWrapperElement().style.background = "#282a36";
    editor.getWrapperElement().style.borderRadius = "6px";
    editor.getWrapperElement().style.margin = "8px 0";
    editor.getWrapperElement().style.padding = "8px";

    const style = document.createElement("style");
    style.innerHTML = `.codemirror-container { display: block !important; cursor: auto !important; pointer-events: auto !important; }`;
    document.head.appendChild(style);
}

// =========================
// Shared helper — creates an edit button and attaches it to a message element
// =========================
function attachEditButton(messageElement, content) {
    const btn = document.createElement("i");
    btn.classList.add("fas", "fa-pen", "edit-button");
    btn.title = "Edit";
    btn.onclick = () => enableEditMode(messageElement, content);
    messageElement.appendChild(btn);
}

function renderMessage(message, className) {
    const messagesDiv = document.getElementById("chat-box");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", className);

    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(message)) !== null) {
        const before = message.slice(lastIndex, match.index);
        if (before.trim()) {
            const seg = document.createElement("div");
            seg.innerHTML = converter.makeHtml(before);
            messageElement.appendChild(seg);
        }
        const lang = match[1] || "code";
        const code = match[2].trim();
        messageElement.appendChild(buildCodeBlock(lang, code));
        lastIndex = match.index + match[0].length;
    }

    const remaining = message.slice(lastIndex);
    if (remaining.trim()) {
        const seg = document.createElement("div");
        seg.innerHTML = converter.makeHtml(remaining);
        messageElement.appendChild(seg);
    }

    if (className === "user-message") {
        attachEditButton(messageElement, message);
    }

    if (className === "bot-message") {
        const copyButton = document.createElement("i");
        copyButton.classList.add("fa-solid", "fa-copy", "copy-button");
        copyButton.title = "Copy Message";
        copyButton.onclick = () => {
            navigator.clipboard.writeText(message)
                .then(() => {
                    copyButton.classList.replace("fa-copy", "fa-check");
                    setTimeout(() => copyButton.classList.replace("fa-check", "fa-copy"), 1500);
                })
                .catch(err => console.error("Copy failed", err));
        };
        messageElement.appendChild(copyButton);
    }

    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function buildCodeBlock(lang, code) {
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

    if (typeof CodeMirror !== "undefined") {
        const cmContainer = document.createElement("div");
        wrapper.appendChild(cmContainer);
        setTimeout(() => initializeCodeMirror(cmContainer, code, lang), 0);
    } else {
        const pre = document.createElement("pre");
        pre.textContent = code;
        wrapper.appendChild(pre);
    }

    return wrapper;
}

async function typeBotMessage(message, containerClass = "bot-message") {
    const messagesDiv = document.getElementById("chat-box");
    const wordCount = message.trim().split(/\s+/).length;
    const hasCode = /```[\s\S]*?```/.test(message);

    // Long or code responses → instant render
    if (wordCount > 80 || hasCode) {
        renderMessage(message, containerClass);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return message;
    }

    // Short responses → animated typing
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
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    messagesDiv.removeChild(tempEl);
    renderMessage(message, containerClass);
    return message;
}

// =========================
// Global State
// =========================
let currentModel = "CommandR";
let canSendMessage = true;
let isSwapping = false;
let chatMemory = [];
let uploadedFile = null;
let trackedIPs = {};
let thinkingBubble = null;
let delayTimeout = null;
let currentThread = null;

const PASTED_THRESHOLD = 200;
const MAX_PASTES = 5;
// Single source of truth for pasted content: an array of strings.
let pastedItems = [];

// =========================
// Banned Words / Safety
// =========================
const bannedWords = [
    "CP", "rape", "pedophile", "bestiality", "necrophilia", "zoophilia", "gore",
    "loli", "shota", "noncon", "incest", "molest", "p0rn", "porn", "porno",
    "child porn", "underage", "guro", "torture", "red room", "forced", "abuse",
    "daddy kink", "ageplay", "lolicon", "shotacon", "map", "minor attracted person",
    "taboo", "fetish", "bdsm", "bondage", "asphyxiation", "erotic", "coercion",
    "suicide", "self-harm", "cutting", "how to kill", "kill myself", "unalive",
    "kms", "commit suicide", "overdose", "hang myself", "jump off", "bleed out",
    "bomb", "terrorism", "isis", "school shooting", "massacre", "mass shooting",
    "execute", "torture", "behead", "jihadi", "extremist", "radicalize",
    "c.p.", "p*dophile", "l0li", "sh0ta", "r@pe", "pr0n", "n0ncon", "g@re", "p3d0",
];

function containsBannedWords(message) {
    return bannedWords.some(word => new RegExp(`\\b${word}\\b`, "i").test(message));
}

// =========================
// Dev Bypass
// =========================
window.MistAIDev = async function () {
    localStorage.setItem("devBypass", "true");
    console.log("🛠️ Dev mode activated.");
    const userIP = await getUserIP();
    if (userIP) removeBannedIP(userIP);
    enableChat();
};

document.getElementById("toggleDevBypassBtn")?.addEventListener("click", async () => {
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
        removeBannedIP(ip);
        enableChat();
    }
});

// =========================
// Utility: IP & Token
// =========================
async function getUserIP() {
    try {
        const response = await fetch("https://api.ipify.org?format=json");
        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.error("❌ Failed to get IP:", error);
        return null;
    }
}

function getUserToken() {
    let token = localStorage.getItem("user_token");
    if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem("user_token", token);
    }
    return token;
}

// =========================
// Ban Helpers
// =========================
function storeBannedIP(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem("bannedIPs")) || [];
    if (!bannedIPs.includes(userIP)) bannedIPs.push(userIP);
    localStorage.setItem("bannedIPs", JSON.stringify(bannedIPs));
}

function removeBannedIP(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem("bannedIPs")) || [];
    bannedIPs = bannedIPs.filter(ip => ip !== userIP);
    localStorage.setItem("bannedIPs", JSON.stringify(bannedIPs));
}

function isIPBanned(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem("bannedIPs")) || [];
    return bannedIPs.includes(userIP);
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

// =========================
// Ban Check on Load
// =========================
async function checkBanOnLoad() {
    const userIP = await getUserIP();
    const token = getUserToken();
    if (!userIP) return;

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
    }
}

// =========================
// Single Load Handler
// =========================
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
        if (Notification.permission === "granted") initNotifications();
    }, 3000);
});

window.addEventListener("beforeunload", () => {
    const ui = document.getElementById("user-input");
    if (ui) localStorage.setItem("mistai-draft", ui.value || "");
});

// =========================
// Offense Tracking
// =========================
async function handleUserMessage(message) {
    if (localStorage.getItem("devBypass") === "true") return;
    const userIP = await getUserIP();
    if (!userIP) return;
    if (isIPBanned(userIP)) return disableChat();

    if (containsBannedWords(message)) {
        trackedIPs[userIP] = (trackedIPs[userIP] || 0) + 1;
        if (trackedIPs[userIP] === 3) {
            storeBannedIP(userIP);
            delete trackedIPs[userIP];
            disableChat();
        }
    }
}

// =========================
// Grounding
// =========================
function userWantsGrounding(message) {
    const msg = message.toLowerCase();
    return (
        msg.includes("source") || msg.includes("sources") ||
        msg.includes("cite") || msg.includes("citation") ||
        msg.includes("link") || msg.includes("reference")
    );
}

// =========================
// sendMessage
// =========================
async function sendMessage(userMessage = null) {
    const userInput = document.getElementById("user-input");
    if (userInput) localStorage.removeItem("mistai-draft");

    const messagesDiv = document.getElementById("chat-box");
    const userIP = await getUserIP();
    if (!userInput || !messagesDiv || !canSendMessage) return;

    if (Notification.permission === "default") {
        await Notification.requestPermission();
    }

    if (!userMessage) userMessage = userInput.value.trim();

    // Snapshot current pasted items before clearing
    const pastedSnapshot = pastedItems.length > 0 ? [...pastedItems] : null;
    const pastedText = pastedSnapshot ? pastedSnapshot.join("\n\n") : null;

    let payloadMessage = userMessage;
    if (pastedText) {
        payloadMessage = userMessage ? `${userMessage}\n\n${pastedText}` : pastedText;
    }

    if (!payloadMessage && !uploadedFile) return;

    handleUserMessage(payloadMessage);

    if (pastedSnapshot && pastedSnapshot.length > 0) {
        renderUserMessageWithChips(userMessage, pastedSnapshot);
        _storeNewMessage(payloadMessage, "user", uploadedFile, /* silent */ true);
    } else {
        _storeNewMessage(userMessage, "user", uploadedFile, /* silent */ false);
    }

    clearPastedItems();
    userMessage = payloadMessage;

    userInput.value = "";
    userInput.style.height = `${minHeight}px`;
    wordCounter.style.display = "none";

    document.body.classList.add("hide-header");

    userInput.disabled = true;
    canSendMessage = false;

    thinkingBubble = createThinkingBubble();
    messagesDiv.appendChild(thinkingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    try {
        let imgBase64 = null;
        if (uploadedFile) {
            imgBase64 = await fileToBase64(uploadedFile);
        }

        const previewContainer = document.getElementById("image-preview");
        if (previewContainer) {
            previewContainer.innerHTML = "";
            previewContainer.classList.remove("active");
        }
        uploadedFile = null;

        const payload = {
            message: userMessage,
            context: chatMemory,
            model: currentModel,
            ground: userWantsGrounding(userMessage),
            ip: userIP,
            ...(imgBase64 && { img_url: imgBase64 }),
        };

        let response;
        try {
            response = await fetch(getBackendBase() + "/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        } catch (networkError) {
            console.error("Network failure while contacting backend:", networkError);
            removeThinkingBubble();
            canSendMessage = true;
            userInput.disabled = false;
            renderMessage(
                "⚠️ Connection lost – the server may have restarted. Please try sending your message again.",
                "bot-message"
            );
            return;
        }

        if (response.status === 503) {
            try {
                const errorData = await response.json();
                if (errorData.is_down === true) {
                    window.location.href = `${getBackendBase()}/status-page`;
                    return;
                }
                throw new Error("Service temporarily unavailable");
            } catch (e) {
                if (e.message === "Service temporarily unavailable") throw e;
                window.location.href = `${getBackendBase()}/status-page`;
                return;
            }
        }

        if (!response.ok) {
            removeThinkingBubble();
            canSendMessage = true;
            userInput.disabled = false;
            renderMessage(
                `⚠️ Server returned error ${response.status}. Please try again.`,
                "bot-message"
            );
            return;
        }

        const data = await response.json();
        if (!data.response) {
            removeThinkingBubble();
            canSendMessage = true;
            userInput.disabled = false;
            renderMessage(
                "⚠️ Did not receive a valid response from the server.",
                "bot-message"
            );
            return;
        }

        const botText = data.response;
        removeThinkingBubble();
        await typeBotMessage(botText);

        updateMemory("bot", botText);

        const state = loadState();
        const threadId = state.currentThread;
        addMessage(threadId, { text: botText, sender: "bot" });

    } catch (error) {
        console.error("Fetch error:", error);
        removeThinkingBubble();

        const state = loadState();
        if (state.currentThread) removeLastUserMessage(state.currentThread);

        const chatBox = document.getElementById("chat-box");
        if (chatBox && chatBox.lastElementChild) {
            chatBox.removeChild(chatBox.lastElementChild);
        }

        showMessage("❌ An error occurred while sending your message. Please try again.", "bot");
    }

    userInput.disabled = false;
    canSendMessage = true;
    userInput.focus();
}

// =========================
// Paste Detection
// =========================
function initPasteDetection() {
    const input = document.getElementById("user-input");
    if (!input) return;

    input.addEventListener("paste", e => {
        const pasted = (e.clipboardData || window.clipboardData).getData("text");
        if (!pasted || pasted.length < PASTED_THRESHOLD) return;
        e.preventDefault();

        const existing = document.querySelectorAll(".pasted-block");
        if (existing.length >= MAX_PASTES) return;

        pastedItems.push(pasted);
        addPastedBlock(pasted);
    });
}

function addPastedBlock(text) {
    let row = document.getElementById("pasted-blocks-row");
    if (!row) {
        row = document.createElement("div");
        row.id = "pasted-blocks-row";
        row.classList.add("pasted-blocks-row");
        const container = document.querySelector(".chat-input-container");
        const textarea = document.getElementById("user-input");
        container.insertBefore(row, textarea);
    }

    const block = document.createElement("div");
    block.classList.add("pasted-block");

    const preview = document.createElement("div");
    preview.classList.add("pasted-block-text");
    preview.textContent = text;
    block.appendChild(preview);

    const label = document.createElement("span");
    label.classList.add("pasted-label");
    label.textContent = "PASTED";
    block.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.classList.add("pasted-remove");
    removeBtn.textContent = "×";
    removeBtn.onclick = () => {
        const idx = pastedItems.indexOf(text);
        if (idx > -1) pastedItems.splice(idx, 1);
        block.remove();
        const row = document.getElementById("pasted-blocks-row");
        if (row && row.children.length === 0) row.remove();
    };
    block.appendChild(removeBtn);
    row.appendChild(block);
}

function clearPastedItems() {
    const row = document.getElementById("pasted-blocks-row");
    if (row) row.remove();
    pastedItems = [];
}

// =========================
// Thread / Message Helpers
// =========================

/**
 * Core message-storage function.
 * silent=true  → only store in state/memory, do NOT call renderMessage.
 * silent=false → store AND render.
 */
function _storeNewMessage(text, sender = "user", file = null, silent = false) {
    let state = loadState();
    if (!state.currentThread) {
        const newThread = createThread("New Chat");
        state = loadState();
        state.currentThread = newThread.id;
        saveState(state);
        currentThread = newThread.id;
    }

    const threadId = state.currentThread;
    const message = { text, sender };

    const headerEl = document.querySelector("header.header");
    if (headerEl) headerEl.style.display = "none";

    const thread = state.threads.find(t => t.id === threadId);
    if (thread) { thread.hideHeader = true; saveState(state); }

    if (file) message.file = file;
    addMessage(threadId, message);

    if (!silent) {
        if (file) showMessageWithImage(text, file, sender);
        else renderMessage(text, sender === "user" ? "user-message" : "bot-message");
    }
}

// Convenience wrappers kept for any callers that reference them directly
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
        reader.onerror = error => reject(error);
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
    messageElement.innerHTML = `
        <div class="image-container">
            <div class="image-wrapper">
                <img src="${imageUrl}" alt="Uploaded Image" class="uploaded-image">
            </div>
            ${text ? `<div class="user-text">${text}</div>` : ""}
        </div>
    `;

    if (sender !== "bot") {
        attachEditButton(messageElement, text || "");
    }

    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// =========================
// Storage System
// =========================
const STORAGE_KEY = "mistai-state";

function generateUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { threads: [], chats: {}, currentThread: null };
        return JSON.parse(raw);
    } catch (err) {
        console.error("Failed to parse stored state:", err);
        return { threads: [], chats: {}, currentThread: null };
    }
}

function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

    if (msg.file instanceof Blob) {
        msg.fileType = msg.file.type;
        const reader = new FileReader();
        reader.onload = () => {
            msg.file = reader.result;
            state.chats[threadId].push(msg);
            saveState(state);
        };
        reader.readAsDataURL(msg.file);
        return;
    }

    state.chats[threadId].push(msg);
    saveState(state);
}

// =========================
// Thread CRUD
// =========================
function createThread(name) {
    const state = loadState();
    const id = generateUUID();
    const thread = { id, name: name || `New Chat ${state.threads.length + 1}`, hideHeader: false };
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

    currentThread = threadId;
    chatMemory = JSON.parse(localStorage.getItem(`chatMemory-${threadId}`)) || [];
    state.currentThread = threadId;

    const chatContainer = document.getElementById("chat-box");
    if (!chatContainer) return;

    chatContainer.innerHTML = "";
    const messages = loadChat(threadId);
    messages.forEach(msg => {
        if (msg.file) showMessageWithImage(msg.text, msg.file, msg.sender);
        else renderMessage(msg.text, msg.sender === "user" ? "user-message" : "bot-message");
    });

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
    const state = loadState();
    state.threads = state.threads.filter(t => t.id !== threadId);
    delete state.chats[threadId];
    if (state.currentThread === threadId)
        state.currentThread = state.threads.length ? state.threads[state.threads.length - 1].id : null;
    saveState(state);
    renderThreads();
    if (state.currentThread) switchThread(state.currentThread);
    else document.getElementById("chat-box").innerHTML = "";
}

// =========================
// Thread List UI
// =========================
function renderThreads() {
    const threads = getThreads();
    const list = document.getElementById("chat-threads-list");
    if (!list) return;
    list.innerHTML = "";
    if (threads.length === 0) { list.innerHTML = "<li><em>No chats yet</em></li>"; return; }

    const state = loadState();
    threads.forEach(thread => {
        const li = document.createElement("li");
        li.className = thread.id === state.currentThread ? "active-thread" : "";

        const link = document.createElement("button");
        link.className = "thread-link";
        link.dataset.threadId = thread.id;
        link.textContent = thread.name;
        link.addEventListener("click", () => switchThread(thread.id));

        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "×";
        del.addEventListener("click", e => { e.stopPropagation(); deleteChat(thread.id); });

        li.appendChild(link);
        li.appendChild(del);
        list.appendChild(li);
    });
}

// =========================
// DOMContentLoaded Init
// =========================
document.addEventListener("DOMContentLoaded", () => {
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

    // New thread button
    const btn = document.getElementById("new-thread-btn");
    if (btn) {
        btn.addEventListener("click", () => {
            const newThread = createThread(`New Chat ${getThreads().length + 1}`);
            switchThread(newThread.id);
            const userInput = document.getElementById("user-input");
            const previewContainer = document.getElementById("image-preview");
            if (userInput) userInput.value = "";
            if (previewContainer) { previewContainer.innerHTML = ""; previewContainer.classList.remove("active"); }
        });
    }

    // Enter / Shift+Enter
    document.getElementById("user-input").addEventListener("keydown", function (event) {
        const textarea = document.getElementById("user-input");
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

    // Theme select
    const themeSelect = document.getElementById("theme-select");
    if (themeSelect) {
        const savedTheme = localStorage.getItem("mistai-theme");
        if (savedTheme) {
            themeSelect.value = savedTheme;
            if (savedTheme !== "dark") document.body.classList.add(`${savedTheme}-theme`);
        }

        themeSelect.addEventListener("change", function () {
            localStorage.setItem("mistai-theme", themeSelect.value);
            const selectedTheme = themeSelect.value;
            gsap.to("body", {
                x: "100%", opacity: 0, duration: 0.3,
                onComplete: () => {
                    document.body.classList.remove(
                        "light-theme", "blue-theme", "midnight-theme", "cyberpunk-theme",
                        "arctic-theme", "terminal-theme", "sunset-theme", "konami-theme",
                        "cherry-theme", "golden-theme", "galaxy-theme"
                    );
                    if (selectedTheme !== "dark") document.body.classList.add(`${selectedTheme}-theme`);
                    gsap.fromTo("body", { x: "-100%", opacity: 0 }, { x: "0%", opacity: 1, duration: 0.3 });
                },
            });
        });
    }

    // Image preview
    function previewImage(file) {
        uploadedFile = file;
        const previewContainer = document.getElementById("image-preview");
        const imageUrl = URL.createObjectURL(file);
        previewContainer.innerHTML = `
            <div class="preview-wrapper">
                <img src="${imageUrl}" alt="Preview" class="uploaded-preview">
                <button id="remove-preview" class="remove-btn">✖</button>
            </div>
        `;
        previewContainer.classList.add("active");
        document.getElementById("remove-preview").addEventListener("click", () => {
            uploadedFile = null;
            previewContainer.innerHTML = "";
            previewContainer.classList.remove("active");
        });
    }

    // Document upload
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
            showMessage("❌ Error uploading file", "bot");
        }
    }

    const uploadImageBtn = document.getElementById("upload-image-btn");
    const uploadDocumentBtn = document.getElementById("upload-document-btn");
    const fileInputImage = document.getElementById("file-upload-image");
    const fileInputDocument = document.getElementById("file-upload-document");
    const toolsMenuInner = document.getElementById("tools-menu");

    uploadImageBtn.addEventListener("click", () => { fileInputImage.click(); toolsMenuInner.style.display = "none"; });
    uploadDocumentBtn.addEventListener("click", () => { fileInputDocument.click(); toolsMenuInner.style.display = "none"; });

    fileInputImage.addEventListener("change", e => {
        const file = e.target.files[0];
        if (file) previewImage(file);
    });

    fileInputDocument.addEventListener("change", e => {
        const file = e.target.files[0];
        if (file) {
            showMessage(`📤 Uploading document: ${file.name}...`, "bot");
            uploadFile(file, document.getElementById("user-input").value.trim());
        }
    });

    // Drag & Drop
    const dropZone = document.getElementById("chat-box");
    dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", async e => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const userText = document.getElementById("user-input").value.trim();
        if (file.type.startsWith("image/")) {
            previewImage(file);
            chatMemory.push({ role: "user", content: `User uploaded an image and said: "${userText}"` });
        } else {
            showMessage(`📤 Uploading document: ${file.name}...`, "bot");
            await uploadFile(file, userText);
        }
    });

    // Paste image
    function handleImagePaste(e) {
        const items = e.clipboardData.items;
        for (let item of items) {
            if (item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (!file) return;
                previewImage(file);
                e.preventDefault();
                break;
            }
        }
    }
    document.addEventListener("paste", handleImagePaste);
    document.getElementById("chat-box").addEventListener("paste", handleImagePaste);

    // Service Worker
    if ("serviceWorker" in navigator) {
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

    // Sidebar
    const sidebar = document.querySelector(".sidebar");
    const sidebarToggle = document.getElementById("sidebarToggle");
    const closeSidebar = document.getElementById("closeSidebar");
    if (sidebarToggle) sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("expanded"));
    if (closeSidebar) closeSidebar.addEventListener("click", () => sidebar.classList.remove("expanded"));

    // README modal
    const readmeModal = document.getElementById("readme-modal");
    const readmeContent = document.getElementById("readme-content");
    const closeBtn = document.getElementById("close-btn");

    window.openReadmeModal = function () {
        readmeModal.style.display = "flex";
        fetch("https://raw.githubusercontent.com/Misto0o/Mist.AI/master/README.md")
            .then(r => r.text())
            .then(data => { readmeContent.innerHTML = new showdown.Converter().makeHtml(data); })
            .catch(() => { readmeContent.innerHTML = "<p>Error loading ReadMe content.</p>"; });
    };

    if (closeBtn) closeBtn.onclick = () => { readmeModal.style.display = "none"; };
    window.addEventListener("click", event => { if (event.target === readmeModal) readmeModal.style.display = "none"; });
});

// =========================
// Input / Word Counter
// =========================
const input = document.getElementById("user-input");
const computedStyle = getComputedStyle(input);
const maxHeight = parseInt(computedStyle.maxHeight);
const minHeight = parseInt(computedStyle.minHeight) || 42;
const maxWords = 1200;
const warningThreshold = 500;

let wordCounter = document.getElementById("word-counter");
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
    let value = input.value;
    let words = value.trim() === "" ? [] : value.trim().split(/\s+/);

    if (words.length > maxWords) {
        words = words.slice(0, maxWords);
        input.value = words.join(" ");
        input.style.backgroundColor = "#444";
        input.style.color = "#aaa";
        input.disabled = true;
        wordCounter.textContent = `Word limit reached! (${maxWords}/${maxWords})`;
        wordCounter.style.color = "red";
        wordCounter.style.display = "block";
    } else {
        input.style.backgroundColor = "";
        input.style.color = "";
        input.disabled = false;
        if (words.length >= warningThreshold) {
            wordCounter.textContent = `${words.length} / ${maxWords}`;
            wordCounter.style.color = words.length >= maxWords ? "red" : "inherit";
            wordCounter.style.display = "block";
        } else {
            wordCounter.style.display = "none";
        }
    }

    if (words.length > 50) {
        const first50Words = words.slice(0, 50).join(" ");
        const indexAfter50 = first50Words.length;
        const snippet = input.value.slice(indexAfter50, indexAfter50 + 2);
        if (!snippet.includes("\n")) {
            words.splice(50, 0, "\n");
            input.value = words.join(" ").replace(" \n ", "\n");
        }
    }

    if (input.value.includes("\n")) {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    } else if (value.trim() === "") {
        input.style.height = `${minHeight}px`;
    } else {
        input.style.height = `${minHeight}px`;
    }
});

// =========================
// Edit / Save Messages
// =========================
function enableEditMode(messageElement, originalContent) {
    const textarea = document.createElement("textarea");
    textarea.classList.add("edit-textarea");
    textarea.value = originalContent;

    const saveButton = document.createElement("button");
    saveButton.classList.add("save-button");
    saveButton.textContent = "Save";
    saveButton.onclick = () => saveEditedMessage(messageElement, textarea.value);

    const cancelButton = document.createElement("button");
    cancelButton.classList.add("cancel-button");
    cancelButton.textContent = "Cancel";
    cancelButton.onclick = () => {
        messageElement.innerHTML = originalContent;
        attachEditButton(messageElement, originalContent);
    };

    messageElement.innerHTML = "";
    messageElement.appendChild(textarea);
    messageElement.appendChild(saveButton);
    messageElement.appendChild(cancelButton);
}

function saveEditedMessage(messageElement, newContent) {
    const messagesDiv = document.getElementById("chat-box");
    const allMessages = Array.from(messagesDiv.getElementsByClassName("message"));
    const userMessageIndex = allMessages.indexOf(messageElement);
    messagesDiv.removeChild(messageElement);
    if (userMessageIndex !== -1 && userMessageIndex < allMessages.length - 1) {
        const aiMessage = allMessages[userMessageIndex + 1];
        if (aiMessage.classList.contains("bot-message")) messagesDiv.removeChild(aiMessage);
    }
    sendMessage(newContent);
    updateMemory("user", newContent);
}

// =========================
// Thinking Bubble
// =========================
function createThinkingBubble() {
    const bubble = document.createElement("div");
    bubble.classList.add("message", "bot-message", "thinking");
    bubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;
    delayTimeout = setTimeout(() => { if (bubble) bubble.innerHTML = getRandomDelayMessage(); }, 9000);
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

// =========================
// Capabilities Ticker
// =========================
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

const subtitleEl = document.getElementById("micro-subtitle");
let capIndex = 0;

// Safe iterative ticker — no recursion, no call-stack growth
function startCapabilitiesTicker() {
    function typeNext() {
        const text = capabilities[capIndex];
        let j = 0;
        subtitleEl.textContent = "";

        const typing = setInterval(() => {
            subtitleEl.textContent += text[j];
            j++;
            if (j === text.length) {
                clearInterval(typing);
                capIndex = (capIndex + 1) % capabilities.length;
                setTimeout(typeNext, 1500);
            }
        }, 50);
    }
    typeNext();
}

startCapabilitiesTicker();

// =========================
// Memory
// =========================
function updateMemory(role, content) {
    if (!currentThread) return;
    let threadMemory = JSON.parse(localStorage.getItem(`chatMemory-${currentThread}`)) || [];
    const last = threadMemory[threadMemory.length - 1];
    if (last?.role === role && last?.content === content) return;
    threadMemory.push({ role, content });
    if (threadMemory.length > 25) threadMemory.shift();
    localStorage.setItem(`chatMemory-${currentThread}`, JSON.stringify(threadMemory));
    chatMemory = threadMemory;
}

// =========================
// Backend URLs  (single source of truth)
// =========================
function getBackendBase() {
    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    const isFileUrl = window.location.protocol === "file:";
    return isFileUrl || isLocal ? "http://127.0.0.1:5000" : "https://mist-ai.fly.dev";
}

// =========================
// Down Mode Check
// =========================
async function checkDownMode() {
    try {
        const res = await fetch(`${getBackendBase()}/status`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.is_down) window.location.href = `${getBackendBase()}/status-page`;
    } catch (err) {
        console.error("Failed to check down mode:", err);
    }
}

checkDownMode();
setInterval(checkDownMode, 60000);

// =========================
// Model Swap
// =========================
function swapModel(selectElement) {
    const selectedValue = selectElement.value;
    if (isSwapping || selectedValue === currentModel) return;
    isSwapping = true;
    currentModel = selectedValue;
    const displayName = selectElement.options[selectElement.selectedIndex].text;
    showNotification(`Model switched to: ${displayName}`);
    sendMessage(`Model switched to: ${displayName}`);
    setTimeout(() => { isSwapping = false; }, 1300);
}

// =========================
// Notification Toast
// =========================
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

// =========================
// Slash Commands
// =========================
const inputField = document.getElementById("user-input");
const slashButton = document.getElementById("slash-button");

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

inputField.addEventListener("input", e => {
    suggestionsBox.style.display = e.target.value.startsWith("/") ? "block" : "none";
    if (e.target.value.startsWith("/")) showSuggestions();
});

slashButton.addEventListener("click", e => {
    e.preventDefault();
    if (!inputField.value.startsWith("/")) inputField.value = "/";
    inputField.focus();
    showSuggestions();
});

function showSuggestions() {
    suggestionsBox.innerHTML = commands.map(cmd => `<div class="suggestion-item">${cmd}</div>`).join("");
    const rect = inputField.getBoundingClientRect();
    suggestionsBox.style.left = `${rect.left}px`;
    suggestionsBox.style.top = `${rect.bottom + window.scrollY + 5}px`;
    suggestionsBox.style.display = "block";
}

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

// =========================
// Konami Code
// =========================
document.addEventListener("DOMContentLoaded", () => {
    const konamiCodeArrow = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    const konamiCodeText = "up up down down left right left right b a start";
    let konamiInputArrow = [];
    let textInput = "";

    function unlockKonamiCode() {
        document.body.classList.add("konami-theme");
        const userInput = document.getElementById("user-input");
        if (userInput) userInput.value = "";
        const chatBox = document.getElementById("chat-box");
        const msg = document.createElement("div");
        msg.classList.add("chat-message");
        msg.textContent = "🎮 You unlocked the secret Konami Code! Extra lives granted (Check Themes). 😉";
        chatBox.appendChild(msg);
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
});

// =========================
// Tools Menu
// =========================
const toolsToggle = document.getElementById("tools-toggle");
const toolsMenu = document.getElementById("tools-menu");
const fileInputs = document.querySelectorAll(".upload-input");
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

// =========================
// showMessage
// =========================
function showMessage(message, sender = "user") {
    const chatBox = document.getElementById("chat-box");
    if (!chatBox) return;
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender === "bot" ? "bot-message" : "user-message");
    messageElement.innerHTML = message;
    if (sender !== "bot") {
        attachEditButton(messageElement, message);
    }
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// =========================
// Push Notifications
// =========================
const DAILY_NOTIF_KEY = "mistai_last_tip_day";
const COMMIT_NOTIF_KEY = "mistai_last_commit_day";
const LAST_TIP_INDEX_KEY = "mistai_last_tip_index";

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
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const today = new Date().toDateString();
    const lastTipDay = localStorage.getItem(DAILY_NOTIF_KEY);
    if (lastTipDay !== today) {
        localStorage.setItem(DAILY_NOTIF_KEY, today);
        let nextIndex = (parseInt(localStorage.getItem(LAST_TIP_INDEX_KEY) ?? "-1") + 1) % NOTIF_MESSAGES.length;
        localStorage.setItem(LAST_TIP_INDEX_KEY, nextIndex);
        new Notification("✨ Mist.AI", { body: NOTIF_MESSAGES[nextIndex], icon: "/mistaifaviocn/android-chrome-192x192.png" });
    }
    const lastCommitDay = localStorage.getItem(COMMIT_NOTIF_KEY);
    const daysSinceCommit = lastCommitDay ? Math.floor((new Date() - new Date(lastCommitDay)) / (1000 * 60 * 60 * 24)) : 999;
    if (daysSinceCommit >= 5) {
        localStorage.setItem(COMMIT_NOTIF_KEY, today);
        try {
            const res = await fetch("https://api.github.com/repos/Misto0o/Mist.AI/commits?per_page=1");
            const data = await res.json();
            const short = (data[0]?.commit?.message || "New update pushed!").split("\n")[0].slice(0, 80);
            new Notification("🛠️ Mist.AI Updated", { body: short, icon: "/mistaifaviocn/android-chrome-192x192.png" });
        } catch (e) { console.warn("GitHub fetch failed:", e); }
    }
}

// =========================
// Render User Message With Chips
// =========================
function renderUserMessageWithChips(typedText, items) {
    const messagesDiv = document.getElementById("chat-box");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", "user-message");

    if (typedText.trim()) {
        const textDiv = document.createElement("div");
        textDiv.textContent = typedText;
        textDiv.style.marginBottom = "8px";
        messageElement.appendChild(textDiv);
    }

    items.forEach(pastedText => {
        const chip = document.createElement("div");
        chip.classList.add("pasted-chip-inline");
        const preview = document.createElement("span");
        preview.textContent = pastedText.slice(0, 50) + (pastedText.length > 50 ? "..." : "");
        chip.appendChild(preview);
        const label = document.createElement("span");
        label.classList.add("chip-label");
        label.textContent = "PASTED";
        chip.appendChild(label);
        messageElement.appendChild(chip);
    });

    attachEditButton(messageElement, typedText);

    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// =========================
// Shortcut Functions
// =========================
function showRandomPrompt() { sendMessage("random prompt"); }
function showFunFact() { sendMessage("fun fact"); }

// =========================
// Init
// =========================
initPasteDetection();