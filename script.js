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
    const hostname = window.location.hostname;
    const isFileUrl = window.location.protocol === 'file:';

    let backendUrl;

    if (isFileUrl) {
        // For file-based URLs (either local or removable media)
        backendUrl = 'http://127.0.0.1:5000/chat';  // Assuming your Flask app is running locally
    } else if (hostname === 'localhost' || hostname === '127.0.0.1') {
        // For local dev environment
        backendUrl = 'http://127.0.0.1:5000/chat';  // Flask running locally
    } else {
        // For production environments (Netlify frontend, Render backend)
        backendUrl = 'https://mist-ai-64pc.onrender.com/chat';  // Deployed Flask API
    }

    try {
        // Send the message to the backend at /chat
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage })
        });

        const data = await response.json();
        console.log("Backend response:", data); // Log the backend response

        if (response.ok) {
            // Check if Showdown is loaded
            if (typeof showdown !== 'undefined') {
                console.log("Showdown is loaded correctly");

                // Create a Showdown converter
                const converter = new showdown.Converter();

                // Convert the markdown response to HTML using Showdown
                const formattedResponse = converter.makeHtml(data.response || "");

                const botMessageElement = document.createElement("div");
                botMessageElement.innerHTML = "Mist.AI: " + formattedResponse; // Set the HTML content
                messagesDiv.appendChild(botMessageElement);
            } else {
                console.error("Showdown is not a function. Make sure the CDN is correct.");
            }
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
