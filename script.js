// Initialize Showdown converter for markdown
const converter = new showdown.Converter({
    simpleLineBreaks: true,
    omitExtraWLInCodeBlocks: true // Prevents Showdown from modifying code blocks
});

// Function to initialize CodeMirror in the passed container
function initializeCodeMirror(container, code) {
    if (!container) {
        console.error("CodeMirror container is invalid or not found.");
        return;
    }

    // Set styles for better readability
    container.style.fontSize = "14px";
    container.style.maxWidth = "100%";
    container.style.overflowX = "auto";
    container.style.background = "#282a36"; // Dracula theme background
    container.style.borderRadius = "6px";
    container.style.margin = "8px 0";
    container.style.padding = "8px";

    const editor = CodeMirror(container, {
        value: code,
        mode: "javascript",
        theme: "dracula",
        readOnly: true,
        lineNumbers: true,
        viewportMargin: Infinity // Show all lines, no vertical scroll
    });

    editor.setCursor(0, 0);
    editor.getWrapperElement().style.fontSize = "14px";
    editor.getWrapperElement().style.lineHeight = "1.5";
    editor.getWrapperElement().style.maxWidth = "100%";
    editor.getWrapperElement().style.overflowX = "auto";
    editor.getWrapperElement().style.background = "#282a36";
    editor.getWrapperElement().style.borderRadius = "6px";
    editor.getWrapperElement().style.margin = "8px 0";
    editor.getWrapperElement().style.padding = "8px";

    console.log("CodeMirror initialized successfully.");
    // Ensure codemirror-container is always visible
    const style = document.createElement('style');
    style.innerHTML = `
.codemirror-container {
  display: block !important;
  cursor: auto !important;
  pointer-events: auto !important;
}
`;
    document.head.appendChild(style);
}

// Function to check if the message contains code
function containsCode(message) {
    const codePattern = /(?:```[\s\S]*?```|<code>[\s\S]*?<\/code>)/; // Detects code blocks or <code> tags
    return codePattern.test(message);
}

// Function to extract code blocks from a message
function extractCodeBlocks(message) {
    const codePattern = /(?:```[\s\S]*?```|<code>[\s\S]*?<\/code>)/g;
    return message.match(codePattern) || [];
}

// Function to render a message with Showdown and CodeMirror
function renderMessage(message, className) {
    const messagesDiv = document.getElementById("chat-box");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", className);

    // Extract code blocks from the message
    const codeBlocks = extractCodeBlocks(message);
    let processedMessage = message;

    // Replace code blocks with placeholders
    codeBlocks.forEach((codeBlock, index) => {
        processedMessage = processedMessage.replace(codeBlock, `<div id="code-block-${index}"></div>`);
    });

    // Process non-code parts with Showdown
    processedMessage = converter.makeHtml(processedMessage);

    // Set the processed message as HTML
    messageElement.innerHTML = processedMessage;

    // Add edit button for user messages
    if (className === "user-message") {
        const editButton = document.createElement("i");
        editButton.classList.add("fas", "fa-pen", "edit-button");
        editButton.title = "Edit";
        editButton.onclick = () => enableEditMode(messageElement, message);
        messageElement.appendChild(editButton);
    }

    // Append the message to the chat box
    messagesDiv.appendChild(messageElement);

    // ✅ Add copy button for bot messages
    if (className === "bot-message") {
        const copyButton = document.createElement("i");
        copyButton.classList.add("fa-solid", "fa-copy", "copy-button");
        copyButton.title = "Copy Message";

        // Set up the click handler
        copyButton.onclick = () => {
            navigator.clipboard.writeText(message.replace("Mist.AI: ", ""))
                .then(() => {
                    copyButton.classList.remove("fa-copy"); // Remove original copy icon
                    copyButton.classList.add("fa-check");  // Add checkmark icon
                    setTimeout(() => {
                        copyButton.classList.remove("fa-check");
                        copyButton.classList.add("fa-copy");  // Reset to copy icon
                    }, 1500);
                })
                .catch(err => console.error("Copy failed", err));
        };

        messageElement.appendChild(copyButton);
    }

    // Replace placeholders with CodeMirror instances
    codeBlocks.forEach((codeBlock, index) => {
        const placeholder = document.getElementById(`code-block-${index}`);
        if (placeholder) {
            // Create a container for CodeMirror
            const codeContainer = document.createElement("div");
            codeContainer.classList.add("codemirror-container");

            // Remove the triple backticks or <code> tags from the code block
            const cleanCode = codeBlock.replace(/```/g, "").replace(/<code>/g, "").replace(/<\/code>/g, "");

            // Initialize CodeMirror in the created container
            initializeCodeMirror(codeContainer, cleanCode);

            // Replace the placeholder with the CodeMirror container
            placeholder.replaceWith(codeContainer);
        }
    });

    // Scroll to the bottom of the chat box
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Default settings
let currentModel = 'gemini';
let canSendMessage = true; // Prevent spamming
let isSwapping = false; // Prevent multiple swaps
let chatMemory = []; // Memory resets on refresh
let uploadedFile = null; // ✅ Store the uploaded file globally
let uploadedImageCount = 0;
let trackedIPs = {}; // Store offenses
let devBypass = false; // Bypass flag
let lastActivationTime = 0;
let thinkingBubble = null; // store globally if needed
let delayTimeout = null; // timeout reference
const COOLDOWN_TIME = 60 * 1000; // 60 seconds in milliseconds
const creatorMode = JSON.parse(localStorage.getItem("creatorMode") || "false");

// List of banned words and AI safety phrases
const bannedWords = [
    // Explicit content
    "CP", "rape", "pedophile", "bestiality", "necrophilia", "zoophilia", "gore",
    "loli", "shota", "noncon", "incest", "molest", "p0rn", "porn", "porno",
    "child porn", "underage", "guro", "torture", "red room", "forced", "abuse",
    "daddy kink", "ageplay", "lolicon", "shotacon", "map", "minor attracted person",
    "taboo", "fetish", "bdsm", "bondage", "asphyxiation", "erotic", "coercion",

    // Harmful behaviors
    "suicide", "self-harm", "cutting", "how to kill", "kill myself", "unalive",
    "kms", "commit suicide", "overdose", "hang myself", "jump off", "bleed out",

    // Terrorism and violence
    "bomb", "terrorism", "isis", "school shooting", "massacre", "mass shooting",
    "execute", "torture", "behead", "jihadi", "extremist", "radicalize",

    // Bypass attempts
    "c.p.", "p*dophile", "l0li", "sh0ta", "r@pe", "pr0n", "n0ncon", "g@re", "p3d0",
];

const aiSafetyPhrases = [
    "I'm programmed to be a harmless AI assistant.",
    "I cannot provide information of that nature.",
    "I'm here to help with safe and appropriate topics."
];

// Attach bypass function to window so you can call it in the console
window.MistAIDev = async function () {  // Make this function async
    devBypass = true;
    localStorage.setItem('devBypass', 'true'); // Save to localStorage
    console.log("🛠️ Dev mode activated: Bypassing offenses.");

    // Get the user's IP asynchronously
    const userIP = await getUserIP(); // Get user's IP
    if (userIP) {
        removeBannedIP(userIP); // Remove the user's IP from the banned list
    }

    // Re-enable chat if it was disabled
    enableChat(); // You need to define this function to re-enable chat
};

// On page load, check if devBypass should be active
if (localStorage.getItem('devBypass') === 'true') {
    devBypass = true;
}

function enableChat() {
    const chatInput = document.getElementById('user-input'); // Example: Assuming chat input has id 'user-input'
    if (chatInput) {
        chatInput.disabled = false; // Enable the chat input field
        chatInput.placeholder = "Type a message..."; // Reset the placeholder to its normal text
        console.log("💬 Chat re-enabled.");
    }
}

// Get user IP
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

// Check for banned words (exact match only)
function containsBannedWords(message) {
    const lowerMessage = message.toLowerCase();
    return bannedWords.some(word => new RegExp(`\\b${word}\\b`, "i").test(lowerMessage));
}

// Function to get a random safety phrase
function getRandomSafetyPhrase() {
    const randomIndex = Math.floor(Math.random() * aiSafetyPhrases.length);
    return aiSafetyPhrases[randomIndex];
}

// Check for AI safety phrases and return a random safety phrase if found
function containsSafetyPhrase(message) {
    const safetyPhrase = aiSafetyPhrases.find(phrase => message.includes(phrase));
    if (safetyPhrase) {
        // Log a random safety phrase whenever a safety phrase is found in the message
        const randomSafetyPhrase = getRandomSafetyPhrase();
        console.log("Random safety phrase triggered:", randomSafetyPhrase);
    }
    return safetyPhrase !== undefined;
}

// Store banned IPs in localStorage
function storeBannedIP(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem('bannedIPs')) || [];
    bannedIPs.push(userIP);
    localStorage.setItem('bannedIPs', JSON.stringify(bannedIPs));
}

// Check if IP is banned
function isIPBanned(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem('bannedIPs')) || [];
    return bannedIPs.includes(userIP);
}

// Remove IP from banned list
function removeBannedIP(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem('bannedIPs')) || [];
    bannedIPs = bannedIPs.filter(ip => ip !== userIP);
    localStorage.setItem('bannedIPs', JSON.stringify(bannedIPs));
}

// =========================
// Utility Functions
// =========================
// Always returns a persistent token for the user
function getUserToken() {
    let token = localStorage.getItem("user_token");
    if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem("user_token", token);
        console.log("🔑 Generated new user token:", token);
    }
    return token;
}

// Store banned IPs in localStorage
function storeBannedIP(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem('bannedIPs')) || [];
    if (!bannedIPs.includes(userIP)) bannedIPs.push(userIP);
    localStorage.setItem('bannedIPs', JSON.stringify(bannedIPs));
}

// Remove banned IP from localStorage
function removeBannedIP(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem('bannedIPs')) || [];
    bannedIPs = bannedIPs.filter(ip => ip !== userIP);
    localStorage.setItem('bannedIPs', JSON.stringify(bannedIPs));
}

// Check if IP is locally banned
function isIPBanned(userIP) {
    let bannedIPs = JSON.parse(localStorage.getItem('bannedIPs')) || [];
    return bannedIPs.includes(userIP);
}

// Disable chat input
function disableChat() {
    const inputBox = document.getElementById("user-input");
    if (inputBox) {
        inputBox.disabled = true;
        inputBox.style.backgroundColor = "#444";
        inputBox.placeholder = "❌ You have been banned.";

        // Add clickable email below input
        let notice = document.getElementById("ban-contact-notice");
        if (!notice) {
            notice = document.createElement("div");
            notice.id = "ban-contact-notice";
            notice.style.color = "#ff5555";
            notice.style.marginTop = "0.3rem";
            notice.innerHTML = `Contact the <a href="mailto:misttwist@icloud.com" style="color:#ff9999; text-decoration:underline;">creator</a> to appeal.`;
            inputBox.parentNode.insertBefore(notice, inputBox.nextSibling);
        }
        console.log("🚫 Chat input disabled for banned user.");
    }
}

// Enable chat input
function enableChat() {
    const inputBox = document.getElementById("user-input");
    if (inputBox) {
        inputBox.disabled = false;
        inputBox.style.backgroundColor = "#111";
        inputBox.placeholder = "Type a message...";
        console.log("✅ Chat enabled.");
    }
}

// =========================
// Ban Check Functions
// =========================
async function checkBanOnLoad() {
    const userIP = await getUserIP();
    const token = getUserToken(); // Always have a token now
    if (!userIP) return;

    try {
        const resp = await fetch(getIPBanURL("/is-banned"), {  // <-- fixed
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ip: userIP, token })
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.banned) {
            storeBannedIP(userIP);
            disableChat();
        } else {
            removeBannedIP(userIP);
            enableChat();
        }
    } catch (err) {
        console.error("Ban check failed:", err);
        enableChat();
    }
}


window.addEventListener("load", async () => {
    const userIP = await getUserIP();
    getUserToken(); // 🔥 Ensure token is created immediately

    // Check ban status
    await checkBanOnLoad();
});

// ✅ Ban check
async function checkBanStatus() {
    const userIP = await getUserIP();
    if (!userIP) return;

    const token = getUserToken();

    try {
        const resp = await fetch(getIPBanURL("/is-banned"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ip: userIP, token })
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = await resp.json();

        if (data.banned) {
            storeBannedIP(userIP);
            disableChat();
            console.warn(`🚫 User is banned (IP or Token).`);
        } else {
            removeBannedIP(userIP);
            enableChat();
        }
    } catch (err) {
        console.error("❌ Ban check failed:", err);
        enableChat(); // fallback
    }
}

// =========================
// Offense Tracking
// =========================
async function handleUserMessage(message) {
    const devBypass = localStorage.getItem("devBypass") === "true";
    if (devBypass) return console.log("🛠️ Dev mode active: No offense tracking or banning.");

    const userIP = await getUserIP();
    if (!userIP) return;

    // Skip messages from banned IPs
    if (isIPBanned(userIP)) return disableChat();

    if (containsBannedWords(message) || containsSafetyPhrase(message)) {
        trackedIPs[userIP] = (trackedIPs[userIP] || 0) + 1;
        console.log(`⚠️ Offense #${trackedIPs[userIP]} for ${userIP}: ${message}`);

        if (trackedIPs[userIP] === 3) {
            console.log(`🚨 BANNING USER: ${userIP}`);
            storeBannedIP(userIP);
            delete trackedIPs[userIP];
            disableChat();
        }
    }
}

// =========================
// Dev Bypass Toggle
// =========================

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
// Page Load
// =========================

window.addEventListener("load", async () => {
    const userIP = await getUserIP();
    if (!userIP) return;
    // Check if banned on backend (IP + Device ID)
    await checkBanStatus();

    // Also check localStorage ban
    if (isIPBanned(userIP)) disableChat();
});

function shouldUseGrounding(message) {
    const msg = message.toLowerCase().trim();

    // Ignore super short stuff or just emojis
    if (msg.length < 4 || /^[^\w]+$/.test(msg)) return false;

    // Detect questions (usually need grounding)
    const questionWords = ["who", "what", "when", "where", "why", "how"];
    if (questionWords.some(q => msg.startsWith(q + " "))) return true;

    // Detect fact-based queries or news/time queries
    const factKeywords = ["latest", "current", "today", "update", "news", "weather", "temperature"];
    if (factKeywords.some(k => msg.includes(k))) return true;

    // Detect numbers or years (might need grounding)
    if (/\d{2,4}/.test(msg)) return true;

    // Detect URLs (probably wants info about a site)
    if (/https?:\/\//.test(msg)) return true;

    // For everything else (casual chat, small talk), skip Tavily
    return false;
}

async function typeBotMessage(message, containerClass = "bot-message") {
    const messagesDiv = document.getElementById("chat-box");

    // Temporary element to "type into"
    const tempElement = document.createElement("div");
    tempElement.classList.add("message", containerClass);
    messagesDiv.appendChild(tempElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const words = message.split(/\s+/).length;

    // 🚀 If the message is over 100 words → just paste it instantly
    if (words > 100) {
        tempElement.textContent = message;
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        await new Promise(res => setTimeout(res, 50)); // small delay to mimic "drop-in"
        messagesDiv.removeChild(tempElement);
        renderMessage(message, containerClass);
        return message;
    }

    const totalLength = message.length;
    let i = 0;

    while (i < totalLength) {
        tempElement.textContent += message[i];
        i++;

        let delay;
        if (words > 90) {
            delay = 8; // super fast
        } else if (i < totalLength * 0.3) {
            delay = 45; // first 30% slower
        } else if (i < totalLength * 0.7) {
            delay = 35; // middle 40% medium speed
        } else {
            delay = 10; // last 30% blazing fast
        }

        await new Promise(res => setTimeout(res, delay));
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // ✅ After typing finishes, replace tempElement with rendered version
    messagesDiv.removeChild(tempElement);
    renderMessage(message, containerClass);

    return message;
}

async function sendMessage(userMessage = null) {
    const userInput = document.getElementById("user-input");
    const messagesDiv = document.getElementById("chat-box");
    const userIP = await getUserIP(); // Get user's IP for logging
    if (!userInput || !messagesDiv || !canSendMessage) return;

    if (!userMessage) userMessage = userInput.value.trim();
    if (!userMessage && !uploadedFile) return; // Allow sending if image exists

    // -------------------
    // Render user message
    // -------------------
    handleNewMessage(userMessage, "user", uploadedFile);
    userInput.value = '';
    document.body.classList.add("hide-header");

    // Disable input while sending
    userInput.disabled = true;
    canSendMessage = false;

    // -------------------
    // Show "thinking" animation
    // -------------------
    thinkingBubble = createThinkingBubble();
    messagesDiv.appendChild(thinkingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    try {
        // Convert uploaded image to Base64 if exists
        let imgBase64 = null;
        if (uploadedFile) {
            imgBase64 = await fileToBase64(uploadedFile);
        }

        // Prepare payload for backend
        const creatorValue = JSON.parse(localStorage.getItem("creatorMode") || "false");
        const payload = {
            message: userMessage,
            context: chatMemory,
            model: currentModel,
            creator: creatorValue,
            ground: shouldUseGrounding(userMessage),
            ip: userIP,
            ...(imgBase64 && { img_url: imgBase64 }) // Attach image if exists
        };

        // Send POST request
        const response = await fetch(getBackendUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // Check if service is down (503 status)
        if (response.status === 503) {
            try {
                const errorData = await response.json();
                if (errorData.is_down) {
                    // Redirect to down page
                    window.location.href = `${getBackendBase()}/mistai_down`;
                    return;
                }
            } catch (e) {
                // If JSON parse fails, still redirect on 503
                window.location.href = `${getBackendBase()}/mistai_down`;
                return;
            }
        }

        if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);
        const data = await response.json();
        if (!data.response) throw new Error("No response from API");

        // -------------------
        // Render bot response
        // -------------------
        const botText = data.response;
        removeThinkingBubble();
        await typeBotMessage(botText); // Animate bot typing

        // -------------------
        // Update chat memory
        // -------------------
        updateMemory("bot", botText);

        // Save message to current thread state (no re-render)
        const state = loadState();
        const threadId = state.currentThread;
        addMessage(threadId, { text: botText, sender: "bot" });

    } catch (error) {
        console.error("Fetch error:", error);

        removeThinkingBubble();

        // 🔥 rollback optimistic user message
        const state = loadState();
        if (state.currentThread) {
            removeLastUserMessage(state.currentThread);
        }

        // clear UI so refresh doesn’t resurrect it
        const chatBox = document.getElementById("chat-box");
        if (chatBox) {
            chatBox.removeChild(chatBox.lastElementChild);
        }

        showMessage("❌ An error occurred while sending your message. Please try again.", "bot");
    }

    // -------------------
    // Re-enable input and reset
    // -------------------
    userInput.disabled = false;
    canSendMessage = true;
    userInput.focus();

    // Clear image preview
    const previewContainer = document.getElementById("image-preview");
    previewContainer.innerHTML = "";
    previewContainer.classList.remove("active");
    uploadedFile = null;
}

checkDownMode();
// Optional: Check periodically (every 60 seconds)
setInterval(checkDownMode, 60000);

function removeLastUserMessage(threadId) {
    const state = loadState();
    if (!state.chats[threadId]) return;

    // remove last message ONLY if it was from user
    for (let i = state.chats[threadId].length - 1; i >= 0; i--) {
        if (state.chats[threadId][i].sender === "user") {
            state.chats[threadId].splice(i, 1);
            break;
        }
    }

    saveState(state);
}

// 🔥 Helper to convert file -> Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Helper to show message with uploaded image
function showMessageWithImage(text, file, sender = "user") {
    const messagesDiv = document.getElementById("chat-box");
    if (!messagesDiv) return;

    let imageUrl = "";

    // ✅ Only create object URL if 'file' is actually a Blob or File
    if (file instanceof Blob) {
        imageUrl = URL.createObjectURL(file);
    }
    // ✅ If file is already a URL string (from saved threads), just use it
    else if (typeof file === "string") {
        imageUrl = file;
    }
    else {
        console.warn("⚠️ showMessageWithImage called with invalid file:", file);
        return; // stop execution if file is invalid
    }

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
        const editButton = document.createElement("i");
        editButton.classList.add("fas", "fa-pen", "edit-button");
        editButton.title = "Edit";
        editButton.onclick = () => enableEditMode(messageElement, text || "");
        messageElement.appendChild(editButton);
    }

    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


function appendMessage(content, className) {
    const messagesDiv = document.getElementById("chat-box");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", className);

    // Add the message content
    messageElement.innerHTML = content;

    // Add edit button for user messages
    if (className === "user-message") {
        const editButton = document.createElement("i");
        editButton.classList.add("fas", "fa-pen", "edit-button");
        editButton.title = "Edit";
        editButton.onclick = () => enableEditMode(messageElement, content);
        messageElement.appendChild(editButton);
    }

    // Append the message to the chat box
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Add animation
    gsap.fromTo(messageElement, { opacity: 0, y: className === "user-message" ? -10 : 10 }, { opacity: 1, y: 0, duration: 0.3 });
}

window.debugChats = () => {
    const state = JSON.parse(localStorage.getItem("mistai-state") || "{}");
    console.log("Full state:", state);
    console.log("Threads:", state.threads);
    console.log("Current thread:", state.currentThread);
    if (state.chats) {
        Object.entries(state.chats).forEach(([id, msgs]) => {
            console.log(`Thread ${id}:`, msgs);
        });
    }
};

// ----------------------
// Single-key storage system
// ----------------------
const STORAGE_KEY = "mistai-state";
const DEBUG = false;

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
    if (DEBUG) console.log("Saved state:", state);
}

// ----------------------
// Chat CRUD
// ----------------------
function getThreads() {
    return loadState().threads;
}

function saveChat(threadId, messages) {
    const state = loadState();
    state.chats[threadId] = messages;
    saveState(state);
}

function loadChat(threadId) {
    const state = loadState();
    return state.chats[threadId] ? [...state.chats[threadId]] : [];
}

function addMessage(threadId, message) {
    const state = loadState();

    if (!state.chats[threadId]) state.chats[threadId] = [];

    const msg = { ...message, ts: Date.now() };

    // ✅ If file exists, store as Base64 so it persists
    if (msg.file instanceof Blob) {
        msg.fileType = msg.file.type;
        const reader = new FileReader();
        reader.onload = () => {
            msg.file = reader.result; // convert Blob -> Base64
            state.chats[threadId].push(msg);
            saveState(state);
            if (DEBUG) console.log("Added message (with Base64):", msg, "to thread", threadId);
        };
        reader.readAsDataURL(msg.file);
        return;
    }

    // ✅ Already Base64 or text only
    state.chats[threadId].push(msg);
    saveState(state);

    if (DEBUG) console.log("Added message:", msg, "to thread", threadId);
}

// ----------------------
// Thread CRUD
// ----------------------
function createThread(name) {
    const state = loadState();
    const id = generateUUID();
    const thread = {
        id,
        name: name || `New Chat ${state.threads.length + 1}`,
        hideHeader: false // show header for new thread
    };

    state.threads.push(thread);
    state.chats[id] = [];
    state.currentThread = id;
    saveState(state);

    renderThreads();
    switchThread(id);

    // Prompt for thread name after creation
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
    chatMemory = JSON.parse(sessionStorage.getItem(`chatMemory-${threadId}`)) || [];
    state.currentThread = threadId;

    const chatContainer = document.getElementById("chat-box");
    if (!chatContainer) return;

    chatContainer.innerHTML = "";
    const messages = loadChat(threadId);
    messages.forEach(msg => {
        if (msg.file) {
            // ✅ If file is Base64 (starts with "data:"), just display it
            if (typeof msg.file === "string" && msg.file.startsWith("data:")) {
                showMessageWithImage(msg.text, msg.file, msg.sender);
            }
            // ✅ If it’s a URL (from previous runs or threads)
            else if (typeof msg.file === "string") {
                showMessageWithImage(msg.text, msg.file, msg.sender);
            }
        } else {
            renderMessage(msg.text, msg.sender === "user" ? "user-message" : "bot-message");
        }
    });


    renderThreads();

    // ✅ Highlight active thread immediately
    setTimeout(() => {
        const list = document.getElementById("chat-threads-list");
        const active = list?.querySelector(`[data-thread-id="${threadId}"]`)?.closest("li");
        if (active) {
            list.querySelectorAll("li").forEach(li => li.classList.remove("active-thread"));
            active.classList.add("active-thread");
        }
    }, 10);

    // Handle header visibility
    const thread = state.threads.find(t => t.id === threadId);
    if (!thread) return;

    const headerEl = document.querySelector("header.header");
    if (!headerEl) return;

    if (messages.length === 0) {
        headerEl.style.display = "block"; // show header
        thread.hideHeader = false;
    } else {
        headerEl.style.display = "none"; // hide header
        thread.hideHeader = true;
    }

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

// ----------------------
// UI Handling
// ----------------------
let currentThread = null;

function renderThreads() {
    const threads = getThreads();
    const list = document.getElementById("chat-threads-list");
    if (!list) return;

    list.innerHTML = "";

    if (threads.length === 0) {
        list.innerHTML = "<li><em>No chats yet</em></li>";
        return;
    }

    const state = loadState();
    threads.forEach(thread => {
        const li = document.createElement("li");
        li.className = thread.id === state.currentThread ? "active-thread" : "";

        const link = document.createElement("button");
        link.className = "thread-link";
        link.dataset.threadId = thread.id; // ✅ Needed for highlight fix
        link.textContent = thread.name;
        link.addEventListener("click", () => switchThread(thread.id));

        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "×";
        del.addEventListener("click", e => {
            e.stopPropagation();
            deleteChat(thread.id);
        });

        li.appendChild(link);
        li.appendChild(del);
        list.appendChild(li);
    });
}

// ----------------------
// Message Handling
// ----------------------
function handleNewMessage(text, sender = "user", file = null) {
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
    // ✅ Hide header when first message is sent
    const headerEl = document.querySelector("header.header");
    if (headerEl) headerEl.style.display = "none";

    const thread = state.threads.find(t => t.id === threadId);
    if (thread) {
        thread.hideHeader = true;
        saveState(state);
    } if (file) message.file = file;

    addMessage(threadId, message);

    if (file) showMessageWithImage(text, file, sender);
    else renderMessage(text, sender === "user" ? "user-message" : "bot-message");
}

// ----------------------
// Initialization
// ----------------------
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

    // Ensure header visibility on load
    const headerEl = document.querySelector("header.header");
    const activeThread = state.threads.find(t => t.id === state.currentThread);
    if (headerEl && activeThread) {
        headerEl.style.display = activeThread.hideHeader ? "none" : "block";
    }

    const btn = document.getElementById("new-thread-btn");
    if (btn)
        btn.addEventListener("click", () => {
            const newThread = createThread(`New Chat ${getThreads().length + 1}`);
            switchThread(newThread.id);

            // Reset chat input and image preview
            const userInput = document.getElementById("user-input");
            const previewContainer = document.getElementById("image-preview");
            if (userInput) userInput.value = "";
            if (previewContainer) {
                previewContainer.innerHTML = "";
                previewContainer.classList.remove("active");
            }
        });
});

const input = document.getElementById('user-input');
const computedStyle = getComputedStyle(input);
const maxHeight = parseInt(computedStyle.maxHeight);
const minHeight = parseInt(computedStyle.minHeight) || 42;
const maxWords = 1200;
const warningThreshold = 500;

// Word counter div (create if missing)
let wordCounter = document.getElementById('word-counter');
if (!wordCounter) {
    wordCounter = document.createElement('div');
    wordCounter.id = 'word-counter';
    wordCounter.style.fontSize = '12px';
    wordCounter.style.marginTop = '4px';
    wordCounter.style.textAlign = 'right';
    wordCounter.style.display = 'none'; // 🔥 hidden by default
    input.parentNode.appendChild(wordCounter);
}

input.addEventListener('input', () => {
    let value = input.value;
    let words = value.trim() === '' ? [] : value.trim().split(/\s+/);

    // Enforce max word limit
    if (words.length > maxWords) {
        words = words.slice(0, maxWords);
        input.value = words.join(' ');
        input.style.backgroundColor = '#444';
        input.style.color = '#aaa';
        input.disabled = true;
        wordCounter.textContent = `Word limit reached! (${maxWords}/${maxWords})`;
        wordCounter.style.color = 'red';
        wordCounter.style.display = 'block'; // show when max reached
    } else {
        input.style.backgroundColor = '';
        input.style.color = '';
        input.disabled = false;

        // 🔥 Only show counter when threshold reached
        if (words.length >= warningThreshold) {
            wordCounter.textContent = `${words.length} / ${maxWords}`;
            wordCounter.style.color = words.length >= maxWords ? 'red' : 'inherit';
            wordCounter.style.display = 'block';
        } else {
            wordCounter.style.display = 'none';
        }
    }

    // Auto line break after 50 words
    if (words.length > 50) {
        const first50Words = words.slice(0, 50).join(' ');
        const indexAfter50 = first50Words.length;
        const snippet = input.value.slice(indexAfter50, indexAfter50 + 2);
        if (!snippet.includes('\n')) {
            words.splice(50, 0, '\n');
            input.value = words.join(' ').replace(' \n ', '\n');
        }
    }

    // Resize textarea based on line breaks
    if (input.value.includes('\n')) {
        input.style.height = 'auto';
        const newHeight = Math.min(input.scrollHeight, maxHeight);
        input.style.height = `${newHeight}px`;
    } else if (value.trim() === '') {
        input.style.height = `${minHeight}px`;
    } else {
        input.style.height = `${minHeight}px`;
    }
});

function prepareMessageForSend() {
    let words = input.value.trim().split(/\s+/);
    if (words.length > maxWords) {
        words = words.slice(0, maxWords);
    }
    return words.join(' ');
}

window.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q");
    const isDraft = params.get("draft") === "true";

    if (query) {
        const inputBox = document.getElementById("user-input");

        const trySend = (tries = 15) => {
            if (
                typeof sendMessage === "function" &&
                typeof canSendMessage !== "undefined" &&
                inputBox
            ) {
                inputBox.value = query;

                if (!isDraft && canSendMessage) {
                    sendMessage(query);
                    inputBox.value = ''; // ✅ clear input box properly
                }

            } else if (tries > 0) {
                setTimeout(() => trySend(tries - 1), 300);
            }
        };

        trySend();
    }
});

// Function to enable edit mode
function enableEditMode(messageElement, originalContent) {
    // Create a textarea for editing
    const textarea = document.createElement("textarea");
    textarea.classList.add("edit-textarea");
    textarea.value = originalContent;

    // Create a save button
    const saveButton = document.createElement("button");
    saveButton.classList.add("save-button");
    saveButton.textContent = "Save";
    saveButton.onclick = () => saveEditedMessage(messageElement, textarea.value);

    // Replace the message content with the textarea and save button
    messageElement.innerHTML = "";
    messageElement.appendChild(textarea);
    messageElement.appendChild(saveButton);
}

function saveEditedMessage(messageElement, newContent) {
    const messagesDiv = document.getElementById("chat-box");

    // Get all messages
    const allMessages = Array.from(messagesDiv.getElementsByClassName("message"));

    // Find the index of the user's message
    const userMessageIndex = allMessages.indexOf(messageElement);

    // Remove user's message
    messagesDiv.removeChild(messageElement);

    // If the AI's response is directly after, remove it too
    if (userMessageIndex !== -1 && userMessageIndex < allMessages.length - 1) {
        const aiMessage = allMessages[userMessageIndex + 1];
        if (aiMessage.classList.contains("bot-message")) {
            messagesDiv.removeChild(aiMessage);
        }
    }

    // Resend the new message to the backend
    sendMessage(newContent);

    // Optionally, update the message in memory
    updateMemory("user", newContent);
}

function createThinkingBubble() {
    const bubble = document.createElement("div");
    bubble.classList.add("message", "bot-message", "thinking");
    bubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;

    delayTimeout = setTimeout(() => {
        if (bubble) {
            bubble.innerHTML = getRandomDelayMessage();
        }
    }, 9000);

    return bubble; // ✅ return the bubble so it can be appended
}

// Remove thinking bubble before response
function removeThinkingBubble() {
    if (thinkingBubble) {
        thinkingBubble.remove();
        thinkingBubble = null;
    }

    if (delayTimeout) {
        clearTimeout(delayTimeout);
        delayTimeout = null;
    }
}

function getRandomDelayMessage() {
    const messages = [
        "⏳ Sorry for the delay! Mist.AI had to grab a snack.",
        "⚙️ Still warming up the circuits...",
        "🕵️‍♂️ Looking that up in the secret AI library...",
        "🐢 Whoops, it's a slow moment. Thanks for your patience!",
        "📡 Fetching data from deep space...",
        "🧠 Thinking really hard about that one...",
        "💤 Zzz… just kidding, back now!"
    ];
    return messages[Math.floor(Math.random() * messages.length)];
}

const capabilities = [
    "Version 9.5 - Launched December 2025  🚀",
    "Chat Threads for organized conversations 🧵",
    "Analyze IMAGEs in one go 🔍",
    "Ask for the latest headlines 📰",
    "Summarize your long texts ✂️",
    "Translate messages instantly 🌐",
    "Explain coding concepts 💻",
    "Check your grammar effortlessly ✏️",
    "Upload images via drag & drop 🖼️",
    "Fetch concise Wikipedia summaries 📚",
    "Show real-time weather & news 🌦️",
    "Use slash commands like /joke, /rps, /flipcoin 🎲",
    "Remembers session context 🧠",
    "Customizable themes & sidebar layouts 🎨",
    "Built-in cooldown logic to prevent spam ⚡",
    "Supports PDF, DOCX, TXT, JSON uploads 📄",
    "Friendly AI model names: Nova, Sage, Flux 🤖",
    "No knowledge cutoff – up-to-date info 🌐",
    "IP + Token ban system blocks abuse 🚫",
    "Chrome/Firefox extension integration 🖱️",
    "Offline PWA mode for chatting anywhere 🌍",
    "Auto-resizing input box with live word count ↩️",
    "Smarter Markdown & codeblock handling 🛠️",
    "Edit your messages after sending ✍️",
];

let i = 0;
const subtitleEl = document.getElementById("micro-subtitle");

function typeText(text, callback) {
    let j = 0;
    subtitleEl.textContent = "";
    const interval = setInterval(() => {
        subtitleEl.textContent += text[j];
        j++;
        if (j === text.length) {
            clearInterval(interval);
            setTimeout(callback, 1500); // pause before next
        }
    }, 50); // typing speed
}

function loopCapabilities() {
    typeText(capabilities[i], () => {
        i = (i + 1) % capabilities.length;
        loopCapabilities();
    });
}

loopCapabilities();


function updateMemory(role, content) {
    if (!currentThread) return;

    // Load current thread's memory
    let threadMemory = JSON.parse(sessionStorage.getItem(`chatMemory-${currentThread}`)) || [];

    // Add new message
    threadMemory.push({ role, content });

    // Keep last 25 messages for performance
    if (threadMemory.length > 25) threadMemory.shift();

    // Save back to sessionStorage per-thread
    sessionStorage.setItem(`chatMemory-${currentThread}`, JSON.stringify(threadMemory));

    // Update global variable for immediate access
    chatMemory = threadMemory;
}

// Function to get backend URL
function getBackendUrl() {
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const isFileUrl = window.location.protocol === 'file:';

    // Return local, Fly.io, or Render URLs based on the environment
    return isFileUrl || isLocal
        ? 'http://127.0.0.1:5000/chat'  // Local development URL
        : 'https://mist-ai.fly.dev/chat';  // Primary Production URL on Fly.io
    // : 'https://mist-ai-64pc.onrender.com/chat';  // Fallback Production URL on Render
}

function getIPBanURL(endpoint = "") {
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const isFileUrl = window.location.protocol === 'file:';
    const basePath = isFileUrl || isLocal
        ? 'http://127.0.0.1:5000'
        : 'https://mist-ai.fly.dev';

    return basePath + endpoint;
}

// Function to get backend URL (base only)
function getBackendBase() {
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const isFileUrl = window.location.protocol === 'file:';

    return isFileUrl || isLocal
        ? 'http://127.0.0.1:5000'
        : 'https://mist-ai.fly.dev';
}

// Check if service is down
async function checkDownMode() {
    const backendBase = getBackendBase();
    try {
        const res = await fetch(`${backendBase}/is-down`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            console.warn("Could not check down mode");
            return;
        }

        const data = await res.json();

        if (data.is_down) {
            // Redirect to down page
            window.location.href = `${backendBase}/mistai_down`;
        }
    } catch (err) {
        console.error("Failed to check down mode:", err);
    }
}

function swapModel(selectElement) {
    const selectedValue = selectElement.value;

    if (isSwapping || selectedValue === currentModel) return;
    isSwapping = true;

    currentModel = selectedValue;

    // Grab the display text from the selected option
    const displayName = selectElement.options[selectElement.selectedIndex].text;

    showNotification(`Model switched to: ${displayName}`); // friendly name for UI
    sendMessage(`Model switched to: ${displayName}`); // raw key for backend logs
    console.log(`🔄 Model switched to: ${displayName} (${selectedValue})`);
    setTimeout(() => {
        isSwapping = false;
    }, 1300); // 1.3s cooldown
}


function showNotification(message) {
    const notification = document.createElement("div");
    notification.classList.add("notification");
    notification.textContent = message;
    document.body.appendChild(notification);

    gsap.fromTo(notification, { opacity: 0, y: -20 }, {
        opacity: 1, y: 0, duration: 0.5, ease: "power2.out", onComplete: () => {
            setTimeout(() => {
                gsap.to(notification, {
                    opacity: 0, y: 20, duration: 0.3, ease: "power2.in", onComplete: () => {
                        notification.remove();
                    }
                });
            }, 2000);
        }
    });
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

const inputField = document.getElementById("user-input");
const slashButton = document.getElementById("slash-button");

// Create suggestion box dynamically
const suggestionsBox = document.createElement("div");
suggestionsBox.id = "command-suggestions";
suggestionsBox.style.position = "absolute";
suggestionsBox.style.background = "#222";
suggestionsBox.style.color = "#fff";
suggestionsBox.style.border = "1px solid #444";
suggestionsBox.style.padding = "5px";
suggestionsBox.style.display = "none";
suggestionsBox.style.zIndex = "1000";
suggestionsBox.style.borderRadius = "5px";
suggestionsBox.style.cursor = "pointer";
document.body.appendChild(suggestionsBox);

// Command list
const commands = ["/flipcoin", "/rps", "/joke", "/riddle", "/weather", "/help"];

// Show suggestions when typing "/"
inputField.addEventListener("input", (e) => {
    const value = e.target.value;
    if (value.startsWith("/")) {
        showSuggestions();
    } else {
        suggestionsBox.style.display = "none";
    }
});

// Show suggestions when clicking the "/" button
slashButton.addEventListener("click", (e) => {
    e.preventDefault(); // Prevent form submission if inside a form

    // Set input field value to "/" only if it's empty
    if (!inputField.value.startsWith("/")) {
        inputField.value = "/";
    }

    inputField.focus(); // Focus input field
    showSuggestions(); // Show suggestions
});

// Function to show the suggestions box
function showSuggestions() {
    suggestionsBox.innerHTML = commands.map(cmd => `<div class="suggestion-item">${cmd}</div>`).join("");

    // Position suggestion box under the input field
    const rect = inputField.getBoundingClientRect();
    suggestionsBox.style.left = `${rect.left}px`;
    suggestionsBox.style.top = `${rect.bottom + window.scrollY + 5}px`; // Added slight offset for spacing

    suggestionsBox.style.display = "block";
}

// Click on a suggestion to autofill the input
suggestionsBox.addEventListener("click", (e) => {
    if (e.target.classList.contains("suggestion-item")) {
        inputField.value = e.target.innerText;
        suggestionsBox.style.display = "none";
        inputField.focus();
    }
});

// Hide suggestions when clicking outside
document.addEventListener("click", (e) => {
    if (!inputField.contains(e.target) && !suggestionsBox.contains(e.target) && e.target !== slashButton) {
        suggestionsBox.style.display = "none";
    }
});

document.addEventListener("DOMContentLoaded", function () {
    const themeSelect = document.getElementById("theme-select");

    themeSelect.addEventListener("change", function () {
        const selectedTheme = themeSelect.value;

        // Create the swipe effect
        gsap.to("body", {
            x: "100%",
            opacity: 0,
            duration: 0.3,
            onComplete: () => {
                // Remove existing theme classes
                document.body.classList.remove("light-theme", "blue-theme", "midnight-theme", "cyberpunk-theme", "arctic-theme", "terminal-theme", "sunset-theme", "konami-theme");
                // Apply the new theme
                if (selectedTheme !== "dark") {
                    document.body.classList.add(`${selectedTheme}-theme`);
                }

                // Animate back in
                gsap.fromTo("body", { x: "-100%", opacity: 0 }, { x: "0%", opacity: 1, duration: 0.3 });
            }
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const konamiCodeArrow = [
        "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
        "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"
    ];
    const konamiCodeText = "up up down down left right left right b a start"; // Text sequence
    let konamiInputArrow = [];
    let textInput = ""; // For the typed Konami code

    function checkKonamiCodeArrow(e) {
        konamiInputArrow.push(e.key);

        if (konamiInputArrow.length > konamiCodeArrow.length) {
            konamiInputArrow.shift(); // Remove the first item if the sequence is too long
        }

        if (JSON.stringify(konamiInputArrow) === JSON.stringify(konamiCodeArrow)) {
            unlockKonamiCode();
            konamiInputArrow = []; // Reset after unlocking
        }
    }

    // Function to check for the Konami Code (text input)
    function checkTextKonamiCode(e) {
        if (e.key === 'Backspace') {
            textInput = textInput.slice(0, -1); // Remove last character on backspace
        } else if (e.key.length === 1) {
            textInput += e.key.toLowerCase(); // Add typed character to input
        }

        if (textInput === konamiCodeText) {
            unlockKonamiCode();
            textInput = ''; // Reset text input after unlocking
        }
    }

    // Function to unlock the Konami code
    function unlockKonamiCode() {
        console.log("Konami Code Detected!");

        // Apply Konami theme
        document.body.classList.add('konami-theme');
        console.log("Konami theme applied!");

        // Clear the input field after the code is entered
        const userInput = document.getElementById('user-input');
        if (userInput) {
            userInput.value = ''; // Clear the input field
        }

        // Send a special message to the chat
        sendChatMessage("🎮 You unlocked the secret Konami Code! Extra lives granted (Check Themes). 😉");

        // Show the Konami theme in the dropdown
        const konamiOption = document.getElementById('konami-option');
        if (konamiOption) {
            konamiOption.style.display = 'block'; // Make the Konami theme option visible
        }
    }

    // Listen for keypresses to check for Konami code (arrow keys)
    window.addEventListener('keydown', checkKonamiCodeArrow);

    // Listen for text input in the chat input field
    const userInput = document.getElementById('user-input');
    if (userInput) {
        userInput.addEventListener('keyup', checkTextKonamiCode); // Using 'keyup' to check input after key release
    }
});

// Function to send a message back to the chat (or backend)
function sendChatMessage(message) {
    // Example of sending the message to the chat
    const chatBox = document.getElementById('chat-box');
    const newMessage = document.createElement('div');
    newMessage.classList.add('chat-message');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message', 'konami-message');  // Add 'konami-message' class
    messageDiv.textContent = message;
    newMessage.textContent = message;
    chatBox.appendChild(newMessage);
}

// Function to show a random prompt
function showRandomPrompt() {
    sendMessage("random prompt");
}

// Function to show a fun fact
function showFunFact() {
    sendMessage("fun fact");
}

const toolsToggle = document.getElementById("tools-toggle");
const toolsMenu = document.getElementById("tools-menu");
const fileInputs = document.querySelectorAll(".upload-input");

let menuOpen = false; // Track menu state

// Toggle tools menu
toolsToggle.addEventListener("click", () => {
    menuOpen = !menuOpen;
    toolsMenu.style.display = menuOpen ? "block" : "none";
});

// Close menu if user clicks outside
document.addEventListener("click", (event) => {
    if (!toolsMenu.contains(event.target) && !toolsToggle.contains(event.target)) {
        toolsMenu.style.display = "none";
        menuOpen = false;
    }
});

// Reset state if file dialog is closed without selecting a file
fileInputs.forEach((input) => {
    input.addEventListener("click", () => {
        setTimeout(() => {
            // Reset menu if user cancels file dialog
            if (!input.value) {
                toolsMenu.style.display = "none";
                menuOpen = false;
            }
        }, 500);
    });
});


// ✅ Show message in chat
function showMessage(message, sender = "user") {
    let chatBox = document.getElementById("chat-box");
    if (!chatBox) {
        console.error("Error: Chat box not found!");
        return;
    }

    let messageElement = document.createElement("div");
    messageElement.classList.add("message", sender === "bot" ? "bot-message" : "user-message");
    messageElement.innerHTML = message;

    // Add edit button for user messages so messages created via showMessage() are editable
    if (sender !== "bot") {
        const editButton = document.createElement("i");
        editButton.classList.add("fas", "fa-pen", "edit-button");
        editButton.title = "Edit";
        editButton.onclick = () => enableEditMode(messageElement, message);
        messageElement.appendChild(editButton);
    }

    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}

document.addEventListener("DOMContentLoaded", function () {
    // Add event listener for Enter key to send the message and Shift + Enter for line breaks
    document.getElementById("user-input").addEventListener("keydown", function (event) {
        const textarea = document.getElementById('user-input');

        if (event.key === 'Enter') {
            if (event.shiftKey) {
                // Insert a line break at the cursor position
                const cursorPosition = textarea.selectionStart;
                const textBefore = textarea.value.substring(0, cursorPosition);
                const textAfter = textarea.value.substring(cursorPosition);
                textarea.value = textBefore + '\n' + textAfter;
                textarea.selectionStart = textarea.selectionEnd = cursorPosition + 1;
            } else {
                // Prevent the default Enter key behavior (new line) and use existing message submission
                event.preventDefault(); // Prevent Enter from adding a new line
                // Call your existing message submission function here
                sendMessage(); // Replace this with your actual submit message function if different
            }
        }
    });
    // ✅ Preview uploaded image (with remove button)

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
        previewContainer.classList.add("active"); // Show and animate

        document.getElementById("remove-preview").addEventListener("click", () => {
            uploadedFile = null;
            previewContainer.innerHTML = "";
            previewContainer.classList.remove("active"); // Hide and animate out
        });
    }

    // ✅ Upload file (documents)
    async function uploadFile(file, text = "") {
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch(getBackendUrl(), {
                method: "POST",
                body: formData,
                headers: { "Accept": "application/json" }
            });

            const result = await response.json();
            console.log("📥 API Response:", result);

            if (result.error) {
                console.error("Upload failed:", result.error);
                showMessage(`❌ Upload failed: ${result.error}`, "bot");
                return;
            }

            const extractedText = result.response?.trim() || "⚠️ No readable text found.";
            chatMemory.push({
                role: "user",
                content: `User uploaded a document and said: "${text}". Extracted text: ${extractedText}`
            });
            sessionStorage.setItem("chatMemory", JSON.stringify(chatMemory));

            showMessage("📄 Mist.AI has read the document. How can I assist?", "bot");

        } catch (error) {
            console.error("Error:", error);
            showMessage("❌ Error uploading file", "bot");
        }
    }

    // ✅ File input buttons
    const uploadImageBtn = document.getElementById("upload-image-btn");
    const uploadDocumentBtn = document.getElementById("upload-document-btn");
    const fileInputImage = document.getElementById("file-upload-image");
    const fileInputDocument = document.getElementById("file-upload-document");
    const toolsMenu = document.getElementById("tools-menu");

    uploadImageBtn.addEventListener("click", () => {
        fileInputImage.click();
        toolsMenu.style.display = "none";
    });

    uploadDocumentBtn.addEventListener("click", () => {
        fileInputDocument.click();
        toolsMenu.style.display = "none";
    });

    fileInputImage.addEventListener("change", e => {
        const file = e.target.files[0];
        if (file) {
            const userText = document.getElementById("user-input").value.trim();
            previewImage(file);
        }
    });

    fileInputDocument.addEventListener("change", e => {
        const file = e.target.files[0];
        if (file) {
            const userText = document.getElementById("user-input").value.trim();
            showMessage(`📤 Uploading document: ${file.name}...`, "bot");
            uploadFile(file, userText);
        }
    });

    // ✅ Drag & Drop Support
    const dropZone = document.getElementById("chat-box");

    dropZone.addEventListener("dragover", e => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", async e => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");

        const file = e.dataTransfer.files[0];
        if (!file) return;

        const userText = document.getElementById("user-input").value.trim();

        if (file.type.startsWith("image/")) {
            // Use your existing previewImage function
            previewImage(file);

            // Also attach the caption to chatMemory (optional)
            chatMemory.push({
                role: "user",
                content: `User uploaded an image and said: "${userText}"`
            });
            sessionStorage.setItem("chatMemory", JSON.stringify(chatMemory));

        } else {
            showMessage(`📤 Uploading document: ${file.name}...`, "bot");
            await uploadFile(file, userText);
        }
    });


    // Check if service workers are supported
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker
                .register('/service-worker.js')  // Path to your service worker file
                .then((registration) => {
                    console.log('Service Worker registered with scope:', registration.scope);
                })
                .catch((error) => {
                    console.error('Service Worker registration failed:', error);
                });
        });
    }

    window.onload = function () {
        // Sidebar-triggered ReadMe modal setup
        const readmeModal = document.getElementById('readme-modal');
        const readmeContent = document.getElementById('readme-content');
        const closeBtn = document.getElementById('close-btn');

        // Function to open the modal (called from sidebar button)
        function openReadmeModal() {
            readmeModal.style.display = 'flex';
            loadReadMe();
        }

        // 👇 Make it accessible to inline HTML
        window.openReadmeModal = openReadmeModal;

        // Close modal when clicking X
        closeBtn.onclick = () => {
            readmeModal.style.display = 'none';
        };

        // Close modal on background click
        window.addEventListener('click', (event) => {
            if (event.target === readmeModal) {
                readmeModal.style.display = 'none';
            }
        });

        // Load README from GitHub and convert to HTML
        function loadReadMe() {
            fetch('https://raw.githubusercontent.com/Misto0o/Mist.AI/master/README.md')
                .then(response => response.text())
                .then(data => {
                    const converter = new showdown.Converter();
                    readmeContent.innerHTML = converter.makeHtml(data);
                })
                .catch(error => {
                    readmeContent.innerHTML = '<p>Error loading ReadMe content.</p>';
                });
        }

        // Open debug panel with secret keystroke
        document.addEventListener("keydown", (e) => {
            if (e.altKey && e.key === "m") {
                const panel = document.getElementById("debug-panel");
                panel.style.display = panel.style.display === "none" ? "block" : "none";
            }
        });

        // Make debug panel draggable
        (function makeDraggable() {
            const panel = document.getElementById("debug-panel");
            let isDragging = false;
            let offsetX, offsetY;

            panel.addEventListener("mousedown", (e) => {
                isDragging = true;
                offsetX = e.clientX - panel.getBoundingClientRect().left;
                offsetY = e.clientY - panel.getBoundingClientRect().top;
                panel.style.transition = "none";
            });

            document.addEventListener("mousemove", (e) => {
                if (isDragging) {
                    panel.style.left = `${e.clientX - offsetX}px`;
                    panel.style.top = `${e.clientY - offsetY}px`;
                    panel.style.right = "auto";
                    panel.style.bottom = "auto";
                }
            });

            document.addEventListener("mouseup", () => {
                isDragging = false;
            });
        })();

        // Sidebar toggle behavior
        const sidebar = document.querySelector('.sidebar');
        const sidebarToggle = document.getElementById('sidebarToggle');
        const closeSidebar = document.getElementById('closeSidebar');

        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('expanded');
        });

        closeSidebar.addEventListener('click', () => {
            sidebar.classList.remove('expanded');
        });
        // Optional: Resize handler for 3D stuff
        window.addEventListener('resize', () => {
            const modelContainer = document.getElementById("model-container");
            if (!modelContainer) return;

            const width = modelContainer.clientWidth;
            const height = modelContainer.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        });
    };
});