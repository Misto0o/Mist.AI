import os
import random  # ✅ Import the random module
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
        data = request.get_json()
        user_message = data.get("message", "").strip().lower()  # Convert to lowercase for better matching

        if not user_message:
            return jsonify({"error": "Message cannot be empty"}), 400

        print(f"User: {user_message}")  # Debugging output

        # Check if the user is requesting a fun fact or a prompt
        if "random prompt" in user_message:
            response_content = "Here's a fun writing challenge: " + get_random_prompt()
        elif "fun fact" in user_message:
            response_content = "Did you know? " + get_random_fun_fact()
        else:
            # Standard Mist.AI Response (Gemini API)
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

            chat_session = model.start_chat(history=[])
            response = chat_session.send_message(user_message)
            response_content = response.text  # Get the actual response content

        print(f"Mist.AI Response: {response_content}")  # Debugging

        return jsonify({"response": response_content})

    except Exception as e:
        print(f"❌ Server Error: {e}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

# Function to return a random writing prompt
def get_random_prompt():
    prompts = [
        "Write about a futuristic world where AI controls everything.",
        "Describe a conversation between a time traveler and their past self.",
        "What if humans could live underwater? Write a short story about it.",
        "You wake up in a video game world. What happens next?",
        "Invent a new superhero and describe their powers.",
    ]
    return random.choice(prompts)

# Function to return a random fun fact
def get_random_fun_fact():
    fun_facts = [
        "Honey never spoils. Archaeologists have found pots of honey in ancient tombs that are over 3,000 years old!",
        "A group of flamingos is called a 'flamboyance.'",
        "Bananas are berries, but strawberries aren't!",
        "Octopuses have three hearts and blue blood.",
        "There's a species of jellyfish that is biologically immortal!",
    ]
    return random.choice(fun_facts)
if __name__ == "__main__":
    print("🚀 Starting Mist.AI server...")
    app.run(debug=True, host="0.0.0.0", port=5000)  # ✅ This starts the Flask server