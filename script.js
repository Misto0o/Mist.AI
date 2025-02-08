async function sendMessage() {
    const userInput = document.getElementById("user-input");
    const userMessage = userInput.value.trim();
    if (userMessage === "") return;

    const messagesDiv = document.getElementById("chat-box");

    // Instantly clear user input field
    userInput.value = '';

    // Create a user message bubble
    const userMessageElement = document.createElement("div");
    userMessageElement.classList.add("message", "user-message");
    userMessageElement.textContent = userMessage;
    messagesDiv.appendChild(userMessageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Create a "thinking" bubble
    const thinkingBubble = document.createElement("div");
    thinkingBubble.classList.add("message", "bot-message", "thinking");
    thinkingBubble.innerHTML = `<span class="dots">Mist.AI is thinking<span>.</span><span>.</span><span>.</span></span>`;
    messagesDiv.appendChild(thinkingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Backend URL logic
    const hostname = window.location.hostname;
    const isFileUrl = window.location.protocol === 'file:';
    let backendUrl = isFileUrl || hostname === 'localhost' || hostname === '127.0.0.1' 
        ? 'http://127.0.0.1:5000/chat' 
        : 'https://mist-ai-64pc.onrender.com/chat';

    try {
        // **Simulate thinking time before fetching response**
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds delay

        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });

        const data = await response.json();
        console.log("Backend response:", data);

        // Remove "thinking..." bubble
        thinkingBubble.remove();

        // AI message container
        const botMessageElement = document.createElement("div");
        botMessageElement.classList.add("message", "bot-message");

        // Typing effect for generative response
        async function typeMessage(element, text) {
            let displayedText = "";
            let speed = Math.random() * 50 + 50; // Randomized speed for each character
            for (let i = 0; i < text.length; i++) {
                displayedText += text[i];
                element.textContent = displayedText;
                await new Promise(resolve => setTimeout(resolve, speed)); // Typing delay for each char
                messagesDiv.scrollTop = messagesDiv.scrollHeight; // Keep scrolling down
            }

            // After a certain point, display the rest of the message at once
            setTimeout(() => {
                element.textContent = text;
            }, 1000); // 1 second after typing finishes, show the rest immediately
        }

        if (data.response.startsWith("```") && data.response.endsWith("```")) {
            // Code block response
            const codeContent = data.response.replace(/```/g, "");
            const codeBlock = document.createElement("pre");
            const codeElement = document.createElement("code");

            codeElement.classList.add("language-javascript");
            await typeMessage(codeElement, codeContent);

            codeBlock.appendChild(codeElement);
            botMessageElement.appendChild(codeBlock);
            hljs.highlightElement(codeElement); // Apply syntax highlighting
        } else {
            // Regular text response with typing effect
            await typeMessage(botMessageElement, "Mist.AI: " + data.response);
        }

        messagesDiv.appendChild(botMessageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

    } catch (error) {
        console.error("Error during fetch:", error);
        alert("An error occurred while sending your message.");
        thinkingBubble.remove();
    }
}


// Send message on Enter key press
document.getElementById("user-input").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});
