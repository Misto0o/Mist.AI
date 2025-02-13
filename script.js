// Initialize Showdown converter for markdown
const converter = new showdown.Converter({ simpleLineBreaks: true });

// Default model selection
let currentModel = 'gemini';

// Function to send messages
async function sendMessage(userMessage = null) {
    const userInput = document.getElementById("user-input");
    const messagesDiv = document.getElementById("chat-box");

    if (!userInput || !messagesDiv) return; // Ensure elements exist

    // Handle user input
    if (!userMessage) {
        userMessage = userInput.value.trim();
        if (!userMessage) return;
        userInput.value = ''; // Clear input field
    }

    // Append user message
    const userMessageElement = document.createElement("div");
    userMessageElement.classList.add("message", "user-message");
    userMessageElement.textContent = userMessage;
    messagesDiv.appendChild(userMessageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    gsap.fromTo(userMessageElement, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3 });

    // Append "thinking" indicator
    const thinkingBubble = document.createElement("div");
    thinkingBubble.classList.add("message", "bot-message", "thinking");
    thinkingBubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;
    messagesDiv.appendChild(thinkingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const hostname = window.location.hostname;
    const isFileUrl = window.location.protocol === 'file:';
    let backendUrl = isFileUrl || hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'http://127.0.0.1:5000/chat'
        : 'https://mist-ai-64pc.onrender.com/chat';

    try {
        console.time("API Response Time");
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage, model: currentModel })
        });
        console.timeEnd("API Response Time");

        if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);

        const data = await response.json();
        if (!data.response) throw new Error("No response from API");

        thinkingBubble.remove();

        const botMessageElement = document.createElement("div");
        botMessageElement.classList.add("message", "bot-message");
        botMessageElement.innerHTML = "Mist.AI: " + converter.makeHtml(data.response);

        messagesDiv.appendChild(botMessageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        gsap.fromTo(botMessageElement, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });

    } catch (error) {
        console.error("Fetch error:", error);
        thinkingBubble.remove();
        alert("An error occurred while sending your message. Please try again.");
    }
}

// Send message on Enter key press
document.getElementById("user-input").addEventListener("keypress", function (event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});

document.addEventListener("DOMContentLoaded", function() {
    let isSwapping = false; // Flag to prevent multiple swaps

    function swapContent() {
        const swapButton = document.querySelector(".swap-button");
        
        if (isSwapping) return; // If currently swapping, ignore the click

        isSwapping = true; // Set flag to true to block further swaps

        // Add the 'disabled' class to the button (graying out)
        swapButton.classList.add("disabled");

        currentModel = currentModel === 'gemini' ? 'commandR' : 'gemini';

        const currentOption = document.getElementById("current-option");
        const currentIcon = document.getElementById("current-icon");
        if (!currentOption || !currentIcon) return;

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

        const notification = document.createElement("div");
        notification.classList.add("notification");
        notification.textContent = `Model switched to: ${currentModel === 'commandR' ? 'CommandR' : 'Gemini'}`;
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

        sendMessage(`Model switched to: ${currentModel}`);

        // Set a timeout for the cooldown
        setTimeout(() => {
            isSwapping = false; // Reset the flag after the cooldown period
            swapButton.classList.remove("disabled"); // Remove the 'disabled' class after the cooldown
        }, 4500); // 4.5 seconds cooldown
    }

    // Attach the function to the button
    document.querySelector(".swap-button").onclick = swapContent;
});

// Handle window resize (Fixing the undefined modelContainer issue)
window.addEventListener('resize', () => {
    const modelContainer = document.getElementById("model-container");
    if (!modelContainer) return; // Prevent error if element does not exist

    const width = modelContainer.clientWidth;
    const height = modelContainer.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});