import os
import random
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
import cohere
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Check if environment variables are set
if not os.getenv("GEMINI_API_KEY") or not os.getenv("COHERE_API_KEY"):
    raise ValueError("Missing required API keys in environment variables.")

# Configure APIs
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
cohere_client = cohere.Client(os.getenv("COHERE_API_KEY"))

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
        user_message = data.get("message", "").strip().lower()
        model_choice = data.get("model", "gemini")

        if not user_message:
            return jsonify({"error": "Message cannot be empty"}), 400

        if "random prompt" in user_message:
            response_content = get_random_prompt()
        elif "fun fact" in user_message:
            response_content = get_random_fun_fact()
        else:
            response_content = (
                get_gemini_response(user_message) if model_choice == "gemini"
                else get_cohere_response(user_message)
            )

        return jsonify({"response": response_content})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_gemini_response(user_message):
    try:
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
        return response.text.strip()

    except Exception as e:
        return f"❌ Error fetching from Gemini: {str(e)}"
    
def get_cohere_response(user_message):
    try:
        response = cohere_client.generate(
            model="command-r-plus-08-2024",
            prompt=user_message,
            temperature=0.7,
            max_tokens=200
        )
        return response.generations[0].text.strip()
    except Exception as e:
        return f"❌ Error fetching from Cohere: {str(e)}"

# 🔹 Function to return a random writing prompt
def get_random_prompt():
    prompts = [
        "Write about a futuristic world where AI controls everything.",
        "Describe a conversation between a time traveler and their past self.",
        "What if humans could live underwater? Write a short story about it.",
        "You wake up in a video game world. What happens next?",
        "Invent a new superhero and describe their powers.",
    ]
    return random.choice(prompts)

# 🔹 Function to return a random fun fact
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
    # This flag will make sure the tests are only run once
    if not hasattr(app, 'has_run'):
        app.has_run = True
        
        print("🚀 Starting Mist.AI server...")
        
        # Test Cohere API call before starting the server
        try:
            print("Testing Cohere API...")
            test_response = cohere_client.generate(
                model="command-r-plus-08-2024",
                prompt="Hello, Cohere!",
                max_tokens=10
            )
            print(f"Cohere API Test Successful: {test_response.generations[0].text.strip()}")
        except Exception as e:
            print(f"❌ Cohere API Test Failed: {str(e)}")

        # Test Gemini API call before starting the server
        try:
            print("Testing Gemini API...")
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
            response = chat_session.send_message("Hello, Gemini!")
            print(f"Gemini API Test Successful: {response.text.strip()}")
        except Exception as e:
            print(f"❌ Gemini API Test Failed: {str(e)}")
    
    # Start Flask app
    app.run(debug=True, host="0.0.0.0", port=5000)
