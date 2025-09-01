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

    console.log("Initializing CodeMirror in container:", container);

    const editor = CodeMirror(container, {
        value: code,
        mode: "javascript",
        theme: "dracula",
        readOnly: true
    });

    // Optionally, adjust editor settings, e.g., set an initial cursor position:
    editor.setCursor(0, 0); // Place the cursor at the start

    console.log("CodeMirror initialized successfully.");
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

    // Use unique string placeholders (not HTML) to avoid Showdown mangling
    const codePlaceholders = [];
    codeBlocks.forEach((codeBlock, index) => {
        const placeholder = `__CODEBLOCK_PLACEHOLDER_${index}__`;
        codePlaceholders.push(placeholder);
        processedMessage = processedMessage.replace(codeBlock, placeholder);
    });

    // Process non-code parts with Showdown
    processedMessage = converter.makeHtml(processedMessage);

    // Replace placeholders with <div> containers for CodeMirror
    codePlaceholders.forEach((placeholder, index) => {
        // Use a unique id for each code block container
        processedMessage = processedMessage.replace(placeholder, `<div id="code-block-${index}"></div>`);
    });

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
            const cleanCode = codeBlock.replace(/^```[a-zA-Z]*\n?|```$/g, "").replace(/<code>/g, "").replace(/<\/code>/g, "");

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
        inputBox.placeholder = "Type your message...";
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


async function sendMessage(userMessage = null) {
    const userInput = document.getElementById("user-input");
    const messagesDiv = document.getElementById("chat-box");
    const userIP = await getUserIP();

    if (!userInput || !messagesDiv || !canSendMessage) return;

    if (!userMessage) userMessage = userInput.value.trim();
    if (!userMessage && !uploadedFile) return; // 🔥 Allow sending if image exists

    userInput.value = '';
    await handleUserMessage(userMessage);
    document.body.classList.add("hide-header");

    // Show message in chat
    if (uploadedFile) {
        showMessageWithImage(userMessage, uploadedFile);
    } else {
        showMessage(userMessage, "user");
    }

    // Disable input
    userInput.disabled = true;
    canSendMessage = false;

    // Show "thinking"
    thinkingBubble = createThinkingBubble();
    messagesDiv.appendChild(thinkingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    try {
        // Convert uploaded image to Base64 if exists
        let imgBase64 = null;
        if (uploadedFile) {
            imgBase64 = await fileToBase64(uploadedFile);
        }

        const creatorValue = JSON.parse(localStorage.getItem("creatorMode") || "false");
        const payload = {
            message: userMessage,
            context: chatMemory,
            model: currentModel,
            creator: creatorValue,
            ip: userIP,
            ...(imgBase64 && { img_url: imgBase64 }) // 🔥 Attach image
        };

        const response = await fetch(getBackendUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);
        const data = await response.json();
        if (!data.response) throw new Error("No response from API");

        removeThinkingBubble();
        renderMessage(`Mist.AI: ${data.response}`, "bot-message");
        updateMemory("bot", data.response);

    } catch (error) {
        console.error("Fetch error:", error);
        removeThinkingBubble();
        showMessage("❌ An error occurred while sending your message. Please try again.", "bot");
    }

    // Reset
    uploadedFile = null;
    const previewContainer = document.getElementById("image-preview");
    if (previewContainer) previewContainer.innerHTML = "";
    previewContainer?.classList.remove("active");
    userInput.disabled = false;
    canSendMessage = true;
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

    const imageUrl = URL.createObjectURL(file);
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

// Function to update chat memory
function updateMemory(role, content) {
    chatMemory.push({ role, content });
    if (chatMemory.length > 25) chatMemory.shift(); // Keep last 25 messages for performance
    sessionStorage.setItem("chatMemory", JSON.stringify(chatMemory));
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

function swapModel(selectElement) {
    const selectedValue = selectElement.value;

    if (isSwapping || selectedValue === currentModel) return;
    isSwapping = true;

    currentModel = selectedValue;

    // Grab the display text from the selected option
    const displayName = selectElement.options[selectElement.selectedIndex].text;

    showNotification(`Model switched to: ${displayName}`); // friendly name for UI
    sendMessage(`Model switched to: ${selectedValue}`); // raw key for backend logs
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

document.addEventListener('DOMContentLoaded', () => {
    const toolsMenu = document.getElementById('tools-menu');
    const toggleButton = document.getElementById('tools-toggle');

    toggleButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toolsMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!toolsMenu.contains(e.target) && !toggleButton.contains(e.target)) {
            toolsMenu.classList.remove('show');
        }
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