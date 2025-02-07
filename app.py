import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure the Gemi API with the API key
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))

# Initialize Flask app
app = Flask(__name__)

# Enable CORS for all routes (local, deployed frontends, and file URLs)
CORS(app, origins=[
    "http://127.0.0.1:5500",  # Local dev environment
    "https://mist-ai-64pc.onrender.com",  # Render deployment
    "https://mistai.netlify.app",  # Netlify site
    "file:///D:/Mist.AI",  # Local file URL (Windows)
    "file:///media/removable/SanDisk/Mist.AI",  # Removable media (Linux/Mac)
])

@app.route('/chat', methods=['POST'])
def chat():
    try:
        # Get the user's message from the request
        data = request.get_json()
        user_message = data.get("message", "").strip()

        if not user_message:
            return jsonify({"error": "Message cannot be empty"}), 400

        print(f"User: {user_message}")  # Debugging output

        # Create the model and configure settings for the Gemi API
        generation_config = {
            "temperature": 1,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 8192,
            "response_mime_type": "text/plain",
        }

        model = genai.GenerativeModel(
            model_name="gemini-2.0-flash", 
            generation_config=generation_config
        )

        # Start a new chat session
        chat_session = model.start_chat(history=[])

        # Send user message to Gemi API and get the response
        response = chat_session.send_message(user_message)

        # If it's a greeting, we provide a custom response
        if user_message.lower() in ["hi", "hello", "hey", "greetings"]:
            response_content = "Hello! I'm Mist.AI, built on Gemini technology. How can I assist you today?"
        else:
            response_content = response.text  # Get the actual response content

        print(f"Gemi Response: {response_content}")  # Log the response for debugging

        # Return the response text from Gemi
        return jsonify({"response": response_content})

    except Exception as e:
        # Log the error and send a response with the error message
        print(f"❌ Server Error: {e}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
