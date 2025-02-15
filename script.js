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
const commands = ["/flipcoin", "/rps", "/joke", "/riddle"];

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