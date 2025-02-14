// Initialize Showdown converter for markdown
const converter = new showdown.Converter({ simpleLineBreaks: true });

// Default settings
let currentModel = 'gemini';
let canSendMessage = true; // Prevent spamming
let isSwapping = false; // Prevent multiple swaps

// Load previous session memory or create new memory
let chatMemory = []; // Memory resets on refresh

// Function to send messages
async function sendMessage(userMessage = null) {
    const userInput = document.getElementById("user-input");
    const messagesDiv = document.getElementById("chat-box");

    if (!userInput || !messagesDiv || !canSendMessage) return; // Ensure elements exist and prevent spam

    // Handle user input
    if (!userMessage) {
        userMessage = userInput.value.trim();
        if (!userMessage) return;
        userInput.value = ''; // Clear input field
    }

    // Disable input while bot is responding
    userInput.disabled = true;
    canSendMessage = false;

    // Append user message to UI
    appendMessage(userMessage, "user-message");

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
        appendMessage(`Mist.AI: ${converter.makeHtml(data.response)}`, "bot-message");

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

// Function to append a message to the chat UI
function appendMessage(content, className) {
    const messagesDiv = document.getElementById("chat-box");
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", className);
    messageElement.innerHTML = content;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    gsap.fromTo(messageElement, { opacity: 0, y: className === "user-message" ? -10 : 10 }, { opacity: 1, y: 0, duration: 0.3 });
}

// Function to create the "thinking" indicator
function createThinkingBubble() {
    const thinkingBubble = document.createElement("div");
    thinkingBubble.classList.add("message", "bot-message", "thinking");
    thinkingBubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;
    return thinkingBubble;
}

// Function to update chat memory
function updateMemory(role, content) {
    chatMemory.push({ role, content });
    if (chatMemory.length > 10) chatMemory.shift(); // Keep last 10 messages for performance
    sessionStorage.setItem("chatMemory", JSON.stringify(chatMemory));
}

// Function to get backend URL
function getBackendUrl() {
    const hostname = window.location.hostname;
    const isFileUrl = window.location.protocol === 'file:';
    return isFileUrl || hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'http://127.0.0.1:5000/chat'
        : 'https://mist-ai-64pc.onrender.com/chat';
}

// Function to swap models
function swapContent() {
    const swapButton = document.querySelector(".swap-button");

    if (isSwapping) return; // Prevent multiple swaps
    isSwapping = true;
    swapButton.classList.add("disabled");

    currentModel = currentModel === 'gemini' ? 'commandR' : 'gemini';

    const currentOption = document.getElementById("current-option");
    const currentIcon = document.getElementById("current-icon");
    if (currentOption && currentIcon) {
        gsap.to(currentOption, {
            opacity: 0, duration: 0.2, onComplete: () => {
                currentOption.textContent = currentModel === 'commandR' ? 'CommandR' : 'Gemini';
                gsap.to(currentOption, { opacity: 1, duration: 0.2 });
            }
        });

        gsap.to(currentIcon, {
            opacity: 0, duration: 0.2, onComplete: () => {
                currentIcon.textContent = currentModel === 'commandR' ? '🔄' : '⚡';
                gsap.to(currentIcon, { opacity: 1, duration: 0.2 });
            }
        });
    }

    showNotification(`Model switched to: ${currentModel === 'commandR' ? 'CommandR' : 'Gemini'}`);
    sendMessage(`Model switched to: ${currentModel}`);

    setTimeout(() => {
        isSwapping = false;
        swapButton.classList.remove("disabled");
    }, 1300); // 1.3s cooldown
}

// Function to show a random prompt
function showRandomPrompt() {
    sendMessage("random prompt");
}

// Function to show a fun fact
function showFunFact() {
    sendMessage("fun fact");
}

// Attach event listeners
document.addEventListener("DOMContentLoaded", function () {
    document.querySelector(".swap-button").onclick = swapContent;
    document.getElementById("user-input").addEventListener("keypress", function (event) {
        if (event.key === "Enter") sendMessage();
    });
});

// Handle window resize
window.addEventListener('resize', () => {
    const modelContainer = document.getElementById("model-container");
    if (!modelContainer) return;

    const width = modelContainer.clientWidth;
    const height = modelContainer.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});