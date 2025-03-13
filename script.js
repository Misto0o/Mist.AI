// Initialize Showdown converter for markdown
const converter = new showdown.Converter({ simpleLineBreaks: true });

// Default settings
let currentModel = 'gemini';
let canSendMessage = true; // Prevent spamming
let isSwapping = false; // Prevent multiple swaps
let chatMemory = []; // Memory resets on refresh
let uploadedFile = null; // ✅ Store the uploaded file globally
let uploadedImageCount = 0;

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

    // Change the message after 9 seconds
    setTimeout(() => {
        thinkingBubble.innerHTML = "⏳ You're the first request, sorry for the wait!";
    }, 9000); // 9 seconds

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
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const isFileUrl = window.location.protocol === 'file:';

    // Return local, Fly.io, or Render URLs based on the environment
    return isFileUrl || isLocal 
        ? 'http://127.0.0.1:5000/chat'  // Local development URL
        : 'https://mist-ai.fly.dev/chat';  // Primary Production URL on Fly.io
        // : 'https://mist-ai-64pc.onrender.com/chat';  // Fallback Production URL on Render
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

        showNotification(`Model switched to: ${currentModel === 'commandR' ? 'CommandR' : 'Gemini'}`);
        sendMessage(`Model switched to: ${currentModel}`);
    }

    setTimeout(() => {
        isSwapping = false;
        swapButton.classList.remove("disabled");
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

    // ✅ Make analyzeUploadedImage GLOBAL
    async function analyzeUploadedImage() {
        if (!uploadedFile) {
            showMessage("⚠️ No image to analyze!", "bot");
            return;
        }

        const reader = new FileReader();

        reader.onloadend = async function () {
            const base64String = reader.result; // ✅ Convert to Base64

            console.log("📤 Sending Image:", base64String.substring(0, 50) + "..."); // ✅ Debugging

            const url = getBackendUrl("analyze");
            const options = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ img_url: base64String }) // ✅ Send Base64
            };

            try {
                showMessage("🔄 Analyzing image...", "bot");

                const response = await fetch(url, options);
                const result = await response.json();

                console.log("📥 API Response:", result); // ✅ Debugging

                if (result.error) {
                    showMessage(`❌ Error: ${result.error}`, "bot");
                    return;
                }

                showMessage(`🧐 Analysis: ${result.result}`, "bot");
                chatMemory.push({ role: "bot", content: `Image Analysis: ${result.result}` });

                // ✅ Update the session memory
                sessionStorage.setItem("chatMemory", JSON.stringify(chatMemory));


            } catch (error) {
                console.error("❌ Fetch Error:", error);
                showMessage("❌ Error analyzing image", "bot");
            }
        };

        reader.readAsDataURL(uploadedFile); // ✅ Read file as Base64
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
                .register('/service-worker.js')  // Path to your service worker file
                .then((registration) => {
                    console.log('Service Worker registered with scope:', registration.scope);
                })
                .catch((error) => {
                    console.error('Service Worker registration failed:', error);
                });
        });
    }

    // ✅ Handle window resize for model container
    window.addEventListener('resize', () => {
        const modelContainer = document.getElementById("model-container");
        if (!modelContainer) return;

        const width = modelContainer.clientWidth;
        const height = modelContainer.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    })
});