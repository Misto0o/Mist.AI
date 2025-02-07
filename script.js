async function sendMessage() {
    // Get the message from the input field with id "user-input"
    const userMessage = document.getElementById("user-input").value;

    if (userMessage.trim() === "") {
        alert("Please enter a message.");
        return;
    }

    // Get the chat-box container where messages are displayed
    const messagesDiv = document.getElementById("chat-box");

    // Display the user's message
    const userMessageElement = document.createElement("div");
    userMessageElement.textContent = "You: " + userMessage;
    messagesDiv.appendChild(userMessageElement);

    // Dynamically choose the backend URL based on the environment
    const backendUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://127.0.0.1:5000/chat'  // Local dev environment
        : window.location.hostname === 'mistai.netlify.app'
            ? 'https://mistai.netlify.app/chat'  // Netlify site
            : 'https://mist-ai.onrender.com/chat';  // Render deployment


    try {
        // Send the message to the backend at /chat
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });

        const data = await response.json();

        if (response.ok) {
            // Display Mist.AI's reply
            const botMessageElement = document.createElement("div");
            botMessageElement.textContent = "Mist.AI: " + data.response;
            messagesDiv.appendChild(botMessageElement);
        } else {
            console.error("Server error:", data.error);
            alert("Error: " + data.error);
        }


    } catch (error) {
        console.error("Error during fetch:", error);
        alert("An error occurred while sending your message. Please try again.");
    }

    // Clear the input field after sending the message
    document.getElementById("user-input").value = '';
}
