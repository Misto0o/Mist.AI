// Initialize Showdown converter for markdown
const converter = new showdown.Converter({ simpleLineBreaks: true });

// Function to send messages
async function sendMessage(userMessage = null) {
    const userInput = document.getElementById("user-input");
    const messagesDiv = document.getElementById("chat-box");

    // If no user message is provided (normal input case)
    if (!userMessage) {
        userMessage = userInput.value.trim();
        if (userMessage === "") return;

        // Instantly clear user input field
        userInput.value = '';

        // Create a user message bubble
        const userMessageElement = document.createElement("div");
        userMessageElement.classList.add("message", "user-message");
        userMessageElement.textContent = userMessage;
        messagesDiv.appendChild(userMessageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        // Animate user message (GSAP)
        gsap.fromTo(userMessageElement, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3 });
    }

    // Create a "thinking" bubble while waiting for the response
    const thinkingBubble = document.createElement("div");
    thinkingBubble.classList.add("message", "bot-message", "thinking");
    thinkingBubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;
    messagesDiv.appendChild(thinkingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Backend URL logic based on hostname
    const hostname = window.location.hostname;
    const isFileUrl = window.location.protocol === 'file:';
    let backendUrl = isFileUrl || hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'http://127.0.0.1:5000/chat'
        : 'https://mist-ai-64pc.onrender.com/chat';

    try {
        console.time("API Response Time");

        // Fetch response from the backend API
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });

        console.timeEnd("API Response Time");

        const data = await response.json();
        console.log("Raw API response:", response);
        console.log("Parsed JSON data:", data);

        if (!data.response) {
            throw new Error("No response from API");
        }

        // Remove the "thinking..." bubble once the response is ready
        thinkingBubble.remove();

        // Create AI message container
        const botMessageElement = document.createElement("div");
        botMessageElement.classList.add("message", "bot-message");

        // Check if response contains a code block (``` or inline `code`)
        if (data.response.includes("```")) {
            // Extract and display code block content
            const codeContent = data.response.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
            const codeBlock = document.createElement("pre");
            const codeElement = document.createElement("code");
            codeElement.textContent = codeContent ? codeContent[1].trim() : data.response;
            codeBlock.appendChild(codeElement);
            botMessageElement.appendChild(codeBlock);
        } else {
            // Regular Markdown-formatted response
            const formattedResponse = converter.makeHtml(data.response);
            botMessageElement.innerHTML = "Mist.AI: " + formattedResponse;
        }

        // Dynamically adjust the typing animation based on message length
        const stepsCount = botMessageElement.textContent.length;
        botMessageElement.style.animation = `typing ${stepsCount * 0.1}s steps(${stepsCount}) forwards`;

        messagesDiv.appendChild(botMessageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        // ✅ GSAP Animation for bot messages (Smooth Fade-in)
        gsap.fromTo(botMessageElement, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });

    } catch (error) {
        console.error("Error during fetch:", error);
        alert("An error occurred while sending your message.");
        thinkingBubble.remove();
    }
}

// List of random prompts
const prompts = [
    "Write about a futuristic world where AI controls everything.",
    "Describe a conversation between a time traveler and their past self.",
    "What if humans could live underwater? Write a short story about it.",
    "You wake up in a video game world. What happens next?",
    "Invent a new superhero and describe their powers.",
];

// List of fun facts
const funFacts = [
    "Honey never spoils. Archaeologists have found pots of honey in ancient tombs that are over 3,000 years old!",
    "A group of flamingos is called a 'flamboyance.'",
    "Bananas are berries, but strawberries aren't!",
    "Octopuses have three hearts and blue blood.",
    "There's a species of jellyfish that is biologically immortal!",
];

// Function to show a random writing prompt
function showRandomPrompt() {
    const randomIndex = Math.floor(Math.random() * prompts.length);
    const randomPrompt = prompts[randomIndex];
    sendMessage("Random Prompt: " + randomPrompt);
}

// Function to show a fun fact
function showFunFact() {
    const randomIndex = Math.floor(Math.random() * funFacts.length);
    const randomFact = funFacts[randomIndex];
    sendMessage("Fun Fact: " + randomFact);
}

// Send message on Enter key press
document.getElementById("user-input").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
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