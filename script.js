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

    try {
        // Send the message to the backend at /chat
        const response = await fetch('http://127.0.0.1:5000/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });

        const data = await response.json();
        
        if (response.ok) {
            // Display the bot's reply
            const botMessageElement = document.createElement("div");
            botMessageElement.textContent = "Bot: " + data.response;
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
