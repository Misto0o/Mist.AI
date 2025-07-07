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
const COOLDOWN_TIME = 60 * 1000; // 60 seconds in milliseconds

// List of banned words and AI safety phrases
const bannedWords = [
    "CP", "rape", "pedophile", "bestiality", "necrophilia",
    "terrorism", "suicide methods", "self-harm methods",
    "loli", "shota", "noncon", "red room"
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
        console.log("🌐 User's IPv4 Address:", data.ip);
        return data.ip;
    } catch (error) {
        console.error("❌ Failed to get IP:", error);
        return null;
    }
}

// Check for banned words (exact match only)
function containsBannedWords(message) {
    const words = message.split(/\s+/); // Split message into words
    return words.some(word => bannedWords.includes(word));
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

// Handle user message and track offenses
async function handleUserMessage(message) {
    if (devBypass) {
        console.log("🛠️ Dev mode active: No offense tracking or banning.");
        return; // Skip the rest of the function
    }

    const userIP = await getUserIP();
    if (!userIP) return;

    // Check if the IP is banned from previous sessions
    if (isIPBanned(userIP)) {
        console.log(`🚫 User with IP ${userIP} is banned.`);
        disableChat();  // Disable chat input
        return;
    }

    if (containsBannedWords(message) || containsSafetyPhrase(message)) {
        if (!trackedIPs[userIP]) {
            trackedIPs[userIP] = 1; // First offense
            console.log(`⚠️ Offense #1 for ${userIP}:`, message);
        } else {
            trackedIPs[userIP]++; // Increase offense count
            console.log(`⚠️ Offense #${trackedIPs[userIP]} for ${userIP}:`, message);
        }

        if (trackedIPs[userIP] === 2) {
            console.log(`🔍 Storing IP for potential ban: ${userIP}`);
        }

        if (trackedIPs[userIP] === 3) {
            console.log(`🚨 BANNING USER: ${userIP} for 24 hours.`);
            delete trackedIPs[userIP]; // Remove IP after ban
            storeBannedIP(userIP); // Store IP in localStorage for future page loads
            disableChat(); // Disable chat input
        }

        // Split message into words and check for exact match
        const words = message.split(/\s+/);
        return words.some(word => bannedWords.includes(word));
    }
}

// On page load, check if user IP is banned
window.onload = async () => {
    const userIP = await getUserIP();
    if (isIPBanned(userIP)) {
        console.log(`🚫 User with IP ${userIP} is banned.`);
        disableChat();  // Disable chat input
    }
};

// Disable the chat input (ban effect)
function disableChat() {
    const inputBox = document.getElementById("user-input");
    if (inputBox) {
        inputBox.disabled = true;
        inputBox.style.backgroundColor = "#444"; // Gray out input
        inputBox.placeholder = "❌ You have been banned for 24 hours.";
        console.log("🚫 Chat input disabled for banned user.");
    }
}

// Function to send messages
async function sendMessage(userMessage = null) {
    console.log("sendMessage called with:", userMessage);
    const userInput = document.getElementById("user-input");
    const messagesDiv = document.getElementById("chat-box");

    if (!userInput || !messagesDiv || !canSendMessage) return;

    if (!userMessage) {
        userMessage = userInput.value.trim();
        if (!userMessage) return;
        userInput.value = ''; // Clear input field
    }

    await handleUserMessage(userMessage);  // Call the offense tracking function
    document.body.classList.add("hide-header");

    // If message contains code
    if (containsCode(userMessage)) {
        console.log("Code detected in message:", userMessage);
    }

    // Disable input while bot is responding
    userInput.disabled = true;
    canSendMessage = false;

    // Append user message to UI
    renderMessage(userMessage, "user-message");

    // Show "thinking" indicator
    const thinkingBubble = createThinkingBubble();
    messagesDiv.appendChild(thinkingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Store message in memory
    updateMemory("user", userMessage);

    try {
        console.time("API Response Time");
        const response = await fetch(getBackendUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage, context: chatMemory, model: currentModel })
        });
        console.timeEnd("API Response Time");

        if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);

        const data = await response.json();
        if (!data.response) throw new Error("No response from API");

        thinkingBubble.remove(); // Remove thinking indicator
        renderMessage(`Mist.AI: ${data.response}`, "bot-message"); // Render bot response with Showdown and CodeMirror

        // Store bot response in memory
        updateMemory("bot", data.response);

    } catch (error) {
        console.error("Fetch error:", error);
        thinkingBubble.remove();
        alert("An error occurred while sending your message. Please try again.");
    }

    // Enable input after cooldown
    setTimeout(() => {
        userInput.disabled = false;
        canSendMessage = true;
    }, 1800);
}

window.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q");
  
    if (query) {
      const inputBox = document.getElementById("user-input");
      inputBox.value = query;
  
      // Delay a bit if needed for DOM animation/stability
      setTimeout(() => {
        sendMessage(query); // ✅ this auto-displays and sends to backend
      }, 50);
    }
  });
  
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

// Function to create the "thinking" indicator
function createThinkingBubble() {
    const thinkingBubble = document.createElement("div");
    thinkingBubble.classList.add("message", "bot-message", "thinking");
    thinkingBubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;

    // Change the message after 9 seconds
    setTimeout(() => {
        thinkingBubble.innerHTML = "⏳ You're the first request, sorry for the wait!";
    }, 9000); // 9 seconds

    return thinkingBubble;
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

// Function to get backend URL
function getWakeWordUrl(endpoint = "") {  // Default to empty string
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const isFileUrl = window.location.protocol === 'file:';
    let basePath = isFileUrl || isLocal
        ? 'http://127.0.0.1:5000/wakeword'  // Local development URL
        : 'https://mist-ai.fly.dev/wakeword';  // Primary Production URL on Fly.io

    // Add the endpoint
    return basePath + endpoint;
}
function swapModel(selectElement) {
    const selectedValue = selectElement.value;

    if (isSwapping || selectedValue === currentModel) return;
    isSwapping = true;

    currentModel = selectedValue;

    showNotification(`Model switched to: ${capitalize(currentModel)}`);
    sendMessage(`Model switched to: ${currentModel}`);

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

    // ✅ Make showMessage GLOBAL
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

    // Function to analyze the uploaded image
    async function analyzeUploadedImage() {
        if (!uploadedFile) {
            showMessage("⚠️ No image to analyze!", "bot");
            return;
        }

        const reader = new FileReader();

        reader.onloadend = async function () {
            const imageDataUrl = reader.result;

            // Create an image element
            const img = new Image();
            img.src = imageDataUrl;

            img.onload = async function () {
                // Create a canvas and draw the image on it
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                // Convert canvas to PNG Base64
                const pngBase64 = canvas.toDataURL("image/png");

                const url = getBackendUrl("analyze");
                const options = {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ img_url: pngBase64 })
                };

                try {
                    showMessage("🔄 Analyzing image...", "bot");

                    const response = await fetch(url, options);
                    const result = await response.json();

                    console.log("📥 API Response:", result); // Debugging

                    if (result.error) {
                        showMessage(`❌ I dont like this file SHIFT!: ${result.error}`, "bot");
                        return;
                    }

                    showMessage("MistAi has received the image. How can I help?", "bot");

                    chatMemory.push({ role: "user", content: `User uploaded a image and it contained: ${result.result}` });

                    // Save chat memory
                    sessionStorage.setItem("chatMemory", JSON.stringify(chatMemory));

                } catch (error) {
                    console.error("❌ Fetch Error:", error);
                    showMessage("❌ Error analyzing image", "bot");
                }
            };
        };

        reader.readAsDataURL(uploadedFile); // Read file as DataURL (base64)
    }

    // ✅ Make showMessage GLOBAL
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

    // ✅ Preview image before analyzing
    function previewImageBeforeAnalyze(file) {
        if (uploadedImageCount >= 3) {
            showMessage("❌ You can only upload 3 images.", "bot");
            return; // Prevent further uploads
        }

        uploadedFile = file; // ✅ Store the file globally
        const imageUrl = URL.createObjectURL(file);

        // Increment the image count
        uploadedImageCount++;

        // When displaying the uploaded image and button, improve the styling and layout
        showMessage(`
<div class="image-container">
    <div class="image-wrapper">
        <img src="${imageUrl}" alt="Uploaded Image" class="uploaded-image">
    </div>
    <div class="button-wrapper">
        <button class="analyze-button" id="analyze-button">🔍 Analyze Image</button>
    </div>
</div>
`, "user");

        // Attach the event listener to the button programmatically
        const analyzeButton = document.getElementById("analyze-button");
        analyzeButton.addEventListener("click", analyzeUploadedImage);
    }

    async function uploadFile(file) {
        let formData = new FormData();
        formData.append("file", file);

        try {
            let response = await fetch(getBackendUrl(), {
                method: "POST",
                body: formData,
                headers: { "Accept": "application/json" }
            });

            let result = await response.json();
            console.log("API Response:", result.response); // Debugging

            if (result.error) {
                console.error("Upload failed:", result.error);
                showMessage(`❌ Upload failed: ${result.error}`, "bot");
                return;
            }

            // ✅ Extract text and store it in memory
            let extractedText = result.response?.trim() || "⚠️ No readable text found.";

            // ✅ Store extracted text in Mist.AI memory without showing it
            chatMemory.push({ role: "user", content: `User uploaded a file and it contained: ${extractedText}` });

            // ✅ Show a simple response to the user
            showMessage("🧐 Mist.AI has read the file. How can I assist you with it?", "bot");

        } catch (error) {
            console.error("Error:", error);
            showMessage("❌ Error uploading file", "bot");
        }
    }

    // ✅ File upload popup handling
    const uploadTrigger = document.getElementById("upload-trigger");
    const uploadPopup = document.getElementById("upload-popup");
    const fileInputImage = document.getElementById("file-upload-image");
    const fileInputDocument = document.getElementById("file-upload-document");
    const uploadImageBtn = document.getElementById("upload-image-btn");
    const uploadDocumentBtn = document.getElementById("upload-document-btn");

    // Toggle popup when clicking paperclip
    uploadTrigger.addEventListener("click", function () {
        uploadPopup.style.display = uploadPopup.style.display === "block" ? "none" : "block";
    });

    // Close popup when clicking outside
    document.addEventListener("click", function (event) {
        if (!uploadTrigger.contains(event.target) && !uploadPopup.contains(event.target)) {
            uploadPopup.style.display = "none";
        }
    });

    // Open image file selector
    uploadImageBtn.addEventListener("click", function () {
        fileInputImage.click();
        uploadPopup.style.display = "none"; // Close popup
    });

    // Open document file selector
    uploadDocumentBtn.addEventListener("click", function () {
        fileInputDocument.click();
        uploadPopup.style.display = "none"; // Close popup
    });

    // Handle file selection
    fileInputImage.addEventListener("change", function (event) {
        let file = event.target.files[0];
        if (file) {
            previewImageBeforeAnalyze(file);
        }
    });

    fileInputDocument.addEventListener("change", function (event) {
        let file = event.target.files[0];
        if (file) {
            showMessage(`📤 Uploading document: ${file.name}...`, "bot");
            uploadFile(file); // Send document immediately
        }
    });

    // Check if service workers are supported
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker
                .register('static/service-worker.js')  // Path to your service worker file
                .then((registration) => {
                    console.log('Service Worker registered with scope:', registration.scope);
                })
                .catch((error) => {
                    console.error('Service Worker registration failed:', error);
                });
        });
    }

    window.onload = function () {
        const popup = document.querySelector('.micCheck');
        const allowButton = document.getElementById('allowMicrophoneButton');
        const denyButton = document.getElementById('denyMicrophoneButton');
        const popupBtn = document.getElementById("micPopUp");
        const overlay = document.getElementById("overlay");

        popupBtn.addEventListener("click", () => {
            popup.style.display = "block";
            overlay.style.display = "block";
        });

        // Optional: close popup if user clicks outside it
        overlay.addEventListener("click", () => {
            popup.style.display = "none";
            overlay.style.display = "none";
        });

        const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");

        const COOLDOWN_TIME = 60000; // 60 seconds
        let lastActivationTime = 0;

        if (isFirefox) {
            alert("⚠️ Speech recognition is NOT supported in Firefox. Please hit DENY");
        }

        // Fuzzy similarity function
        function similarity(s1, s2) {
            s1 = s1.toLowerCase();
            s2 = s2.toLowerCase();

            let longer = s1.length > s2.length ? s1 : s2;
            let shorter = s1.length > s2.length ? s2 : s1;
            let longerLength = longer.length;

            if (longerLength === 0) return 1.0;

            let same = 0;
            for (let i = 0; i < shorter.length; i++) {
                if (s1[i] === s2[i]) same++;
            }
            return same / longerLength;
        }

        allowButton.addEventListener('click', () => {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    popup.style.display = 'none';
                    console.log('🎤 Microphone access granted');

                    if (isFirefox) {
                        alert("Firefox detected! Consider using Chrome for voice commands.");
                        return;
                    }

                    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                    if (!SpeechRecognition) {
                        alert("Speech recognition is not supported in this browser.");
                        return;
                    }

                    const recognition = new SpeechRecognition();
                    recognition.lang = 'en-US';

                    const accepted = ["hello mist", "hello missed", "hello missed ai", "hello mister"];

                    recognition.onresult = function (event) {
                        const transcript = event.results[0][0].transcript.toLowerCase();
                        const currentTime = Date.now();
                        const isCooldown = currentTime - lastActivationTime < COOLDOWN_TIME;

                        let matched = false;

                        for (const phrase of accepted) {
                            const conf = similarity(transcript, phrase);
                            if (conf > 0.75) {
                                matched = true;
                                console.log(`✅ Wake word "${phrase}" matched with ${Math.round(conf * 100)}% confidence`);
                                break;
                            }
                        }

                        if (matched && !isCooldown) {
                            window.open("https://mistai.org", "_blank");
                            lastActivationTime = currentTime;

                            fetch("/wakeword", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ text: transcript }),
                            });
                        } else if (isCooldown) {
                            const remaining = Math.ceil((COOLDOWN_TIME - (currentTime - lastActivationTime)) / 1000);
                            console.log(`⏳ Cooldown active. Try again in ${remaining}s`);
                        } else {
                            console.log(`❌ Wake word not matched. Heard: "${transcript}"`);
                        }
                    };

                    recognition.onend = () => {
                        recognition.start(); // Keep listening
                    };

                    recognition.start();
                })
                .catch(err => {
                    console.error("Microphone access error:", err);
                    alert("Microphone access error: " + err.name + " - " + err.message);
                });
        });

        denyButton.addEventListener('click', () => {
            popup.style.display = 'none';
            console.log('🚫 Microphone access denied. Wake-word detection will not start.');
        });

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