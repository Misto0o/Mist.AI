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
        user_message = data.get("message", "").strip()
        chat_context = data.get("context", [])  # Get past messages
        model_choice = data.get("model", "gemini")

        if not user_message:
            return jsonify({"error": "Message cannot be empty"}), 400

        # 🔹 Handle special commands
        if user_message.startswith("/"):
            return jsonify({"response": handle_command(user_message)})

        # Format past messages as a conversation history
        context_text = "\n".join(f"{msg['role']}: {msg['content']}" for msg in chat_context)
        full_prompt = f"{context_text}\nUser: {user_message}\nMist.AI:"

        # Get AI response
        response_content = (
            get_gemini_response(full_prompt) if model_choice == "gemini"
            else get_cohere_response(full_prompt)
        )

        # 🔹 Print logs (Visible in Render)
        print("\n🔹 New Chat Interaction 🔹")
        print(f"👤 User: {user_message}")
        print(f"🤖 Mist.AI ({model_choice}): {response_content}\n")

        return jsonify({"response": response_content})

    except Exception as e:
        print(f"❌ Error: {str(e)}")  # Logs errors in Render
        return jsonify({"error": str(e)}), 500


def handle_command(command):
    """Handles special commands like /rps, /flipcoin, /joke, and /riddle."""
    command = command.lower()

    if command == "/flipcoin":
        return "🪙 " + random.choice(["Heads!", "Tails!"])

    if command == "/rps":
        return "✊ ✋ ✌️ I choose: " + random.choice(["Rock 🪨", "Paper 📄", "Scissors ✂️"])

    if command == "/joke":
        jokes = [
            "Why don’t programmers like nature? It has too many bugs.",
            "Why do Java developers wear glasses? Because they don’t see sharp.",
            "I told my computer I needed a break, and now it won’t stop sending me KitKats."
        ]
        return random.choice(jokes)

    if command == "/riddle":
        riddles = [
            ("I speak without a mouth and hear without ears. What am I?", "An echo."),
            ("The more you take, the more you leave behind. What am I?", "Footsteps."),
            ("What has to be broken before you can use it?", "An egg."),
        ]
        riddle = random.choice(riddles)
        return f"🤔 {riddle[0]}\n\n*Answer: {riddle[1]}*"

    return "❌ Unknown command. Try `/flipcoin`, `/rps`, `/joke`, or `/riddle`."

def get_gemini_response(prompt):
    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        chat_session = model.start_chat(history=[])
        response = chat_session.send_message(prompt)
        return response.text.strip()
    except Exception as e:
        return f"❌ Error fetching from Gemini: {str(e)}"

def get_cohere_response(prompt):
    try:
        response = cohere_client.generate(
            model="command-r-plus-08-2024",
            prompt=prompt,
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