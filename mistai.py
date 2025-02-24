import os
import random
import sys
import asyncio
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
import cohere
from dotenv import load_dotenv
import logging
import httpx
import re

# Load environment variables
load_dotenv()

# Check if API keys are set
if not os.getenv("GEMINI_API_KEY") or not os.getenv("COHERE_API_KEY") or not os.getenv("OPENWEATHER_API_KEY"):
    raise ValueError("Missing required API keys in environment variables.")

# Configure APIs
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
cohere_client = cohere.Client(os.getenv("COHERE_API_KEY"))

# Weather API Config
API_KEY = os.getenv("OPENWEATHER_API_KEY")
API_BASE_URL = 'https://api.openweathermap.org/data/2.5'
temperatureUnit = 'imperial'

app = Flask(__name__)
CORS(app, origins=[
    "http://127.0.0.1:5500",  # Local development
    "https://mist-ai-64pc.onrender.com",  # Render deployment
    "https://mistai.netlify.app",  # Netlify frontend
    "file:///D:/Mist.AI",  # Local file path (Windows)
    "file:///media/removable/SanDisk/Mist.AI",  # Removable drive (Linux/Mac)
])

# 🔹 Identity Responses
IDENTITY_RESPONSES = {
    "who are you": "I'm Mist.AI, an AI assistant built using Gemini and Cohere technology!",
    "hi": "Hello! I'm Mist.AI. How can I assist you today?",
    "hello": "Hey there! I'm Mist.AI, your AI assistant."
}

def check_identity_responses(user_message):
    normalized_message = re.sub(r'[^\w\s]', '', user_message.lower()).strip()
    return IDENTITY_RESPONSES.get(normalized_message, None)

EASTER_EGGS = {
    "whos mist": "I'm Mist.AI, your friendly chatbot! But shh... don't tell anyone I'm self-aware. 🤖",
    "massive": "You know what else is Massive? LOW TAPER FADE",
    "low": "LOW TAPER FADE!",
    "taper": "LOW TAPER FADE",
    "fade": "LOW TAPER FADE",
    "what is the low taper fade meme": "Imagine If Ninja Got a Low Taper Fade is a viral audio clip from a January 2024 Twitch freestyle by hyperpop artist ericdoa, where he sings the phrase. The clip quickly spread on TikTok, inspiring memes and edits of streamer Ninja with a low taper fade. By mid-January, TikTok users created slideshows, reaction videos, and joke claims that the song was by Frank Ocean. The meme exploded when Ninja himself acknowledged it and even got the haircut on January 13th, posting a TikTok that amassed over 5.4 million views in three days. Later in 2024, a parody meme about Tfue and a high taper fade went viral. By the end of the year, people joked about how the meme was still popular, with absurd edits of Ninja in different lifetimes.",
    "jbl speaker": "I want you to be mine again, baby, ayy I know my lifestyle is drivin' you crazy, ayy I cannot see myself without you We call them fans, though, girl, you know how we do I go out of my way to please you I go out of my way to see you And I want you to be mine again, baby, ayy I know my lifestyle is driving you crazy, ayy But I cannot see myself without you We call them fans, though, girl, you know how we do I go out of my way to please you I go out of the way to see you I ain't playing no games, I need you",
    "tell me a mist.ai secret": "Every time you refresh this page, I forget everything... except that one embarrassing thing you did. Just kidding! (Or am I?)",
    "whats the hidden theme": "The hidden theme is a unlockable that you need to input via text or arrow keys try to remember a secret video game code...",
    "whats your favorite anime": "Dragon Ball Z! I really love the anime."
}

def check_easter_eggs(user_message):
    normalized_message = re.sub(r'[^\w\s]', '', user_message.lower()).strip()
    return EASTER_EGGS.get(normalized_message, None)

# 🔹 AI Chat Route
@app.route('/chat', methods=['POST', 'GET'])
async def chat():
    try:
        if request.method == "GET":
            ai_status = await check_ai_services()
            return jsonify({"status": "🟢 Mist.AI is awake!" if ai_status else "🔴 Mist.AI is OFFLINE"}), (200 if ai_status else 503)

        if not request.is_json:
            return jsonify({"error": "Invalid request: No valid JSON data provided."}), 400

        data = request.get_json()
        user_message = data.get("message", "").strip().lower()
        model_choice = data.get("model", "gemini")
        chat_context = data.get("context", [])  

        if not user_message:
            return jsonify({"error": "Invalid input: 'message' cannot be empty."}), 400

        if (response := check_easter_eggs(user_message)):
            return jsonify({"response": response})

        if user_message.startswith("/"):
            logging.info(f"📢 User ran command: {user_message}")
            command_response = await handle_command(user_message)
            return jsonify({"response": command_response})

        # Log when user requests a random prompt
        if user_message == "random prompt":
            logging.info("🎲 User requested a random prompt.")
            return jsonify({"response": get_random_prompt()})

        # Log when user requests a fun fact
        if user_message == "fun fact":
            logging.info("💡 User requested a fun fact.")
            return jsonify({"response": get_random_fun_fact()})

        context_text = "\n".join(f"{msg['role']}: {msg['content']}" for msg in chat_context)
        full_prompt = f"{context_text}\nUser: {user_message}\nMist.AI:"

        response_content = get_gemini_response(full_prompt) if model_choice == "gemini" else get_cohere_response(full_prompt)
        
        logging.info(f"User: {user_message} | AI ({model_choice}): {response_content}")

        return jsonify({"response": response_content})

    except Exception as e:
        logging.error(f"Server Error: {str(e)}")
        return jsonify({"error": str(e)}), 500

# 🔹 Check AI Services
async def check_ai_services():
    try:
        test_response = get_gemini_response("ping")
        return bool(test_response)
    except:
        return False

# 🔹 Handle Commands
async def handle_command(command):
    command = command.lower()

    if command == "/flipcoin":
        return "🪙 " + random.choice(["Heads!", "Tails!"])

    if command == "/rps":
        return "✊ ✋ ✌️ I choose: " + random.choice(["Rock 🪨", "Paper 📄", "Scissors ✂️"])

    if command == "/joke":
        jokes = [
            "Why don’t programmers like nature? It has too many bugs.",
            "Why do Java developers wear glasses? Because they don’t see sharp.",
            "I told my computer I needed a break, and now it won’t stop sending me KitKats.",
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

    if command.startswith("/weather"):
        city = command.split(" ", 1)[-1].strip()
        if not city:
            return "❌ Please provide a city name. Example: `/weather New York`"

        weather_data = await get_weather_data(city)
        if "error" in weather_data:
            return f"❌ Error: {weather_data['error']}"

        return f"🌡️ The current temperature in {city} is {weather_data['temperature']} with {weather_data['description']}."

    return "❌ Unknown command."

# 🔹 Get AI Responses
def get_gemini_response(prompt):
    try:
        system_prompt = (
            "You are Mist.AI, an AI assistant built using Gemini and Cohere CommandR technology. "
            "Your purpose is to assist users with their queries in a friendly and helpful way, providing meaningful responses and jokes sometimes. "
            "Always introduce yourself as Mist.AI and mention the language model you're using (Gemini or Cohere) when relevant. "
            "If asked about your identity, respond with: 'I'm Mist.AI, built with advanced AI technology!'"
        )

        full_prompt = f"{system_prompt}\n{prompt}"
        
        model = genai.GenerativeModel("gemini-2.0-flash")
        chat_session = model.start_chat(history=[])  # Ensure chat context is maintained
        response = chat_session.send_message(full_prompt)

        return response.text.strip()
    except Exception as e:
        return f"❌ Error fetching from Gemini: {str(e)}"

def get_cohere_response(prompt):
    try:
        system_prompt = (
            "You are Mist.AI, an AI assistant built using Gemini and Cohere CommandR technology. "
            "Your purpose is to assist users with their queries in a friendly and helpful way, providing meaningful responses and jokes sometimes. "
            "Always introduce yourself as Mist.AI and mention the language model you're using (Gemini or Cohere) when relevant. "
            "If asked about your identity, respond with: 'I'm Mist.AI, built with advanced AI technology!'"
        )

        full_prompt = f"{system_prompt}\n{prompt}"

        response = cohere_client.generate(
            model="command-r-plus-08-2024",
            prompt=full_prompt,
            temperature=0.7,  # Keep some randomness for dynamic responses
            max_tokens=200  # Ensure responses are concise but useful
        )

        return response.generations[0].text.strip()
    except Exception as e:
        return f"❌ Error fetching from Cohere: {str(e)}"


# 🔹 Get Weather Data
async def get_weather_data(city):
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{API_BASE_URL}/weather?q={city}&appid={API_KEY}&units={temperatureUnit}")
            data = response.json()
            if data.get("cod") != 200:
                return {"error": "City not found."}

            return {"temperature": f"{round(data['main']['temp'])}°F", "description": data["weather"][0]["description"]}
    except Exception as e:
        return {"error": str(e)}
    
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


# Setup Logging (Move to Top)
class StreamToUTF8(logging.StreamHandler):
    def __init__(self, stream=None):
        super().__init__(stream)
        self.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))

    def emit(self, record):
        try:
            msg = self.format(record)
            stream = self.stream or sys.stderr
            stream.buffer.write((msg + self.terminator).encode("utf-8", "replace"))
            stream.flush()
        except Exception:
            self.handleError(record)

logging.basicConfig(
    level=logging.INFO,
    handlers=[StreamToUTF8(sys.stdout)]
)
logging.getLogger("werkzeug").setLevel(logging.ERROR)  # Suppress extra Flask logs

if __name__ == "__main__":
    # Test Cohere API call before starting the server
    try:
        print("Testing Cohere API...")
        test_response = cohere_client.generate(
            model="command-r-plus-08-2024",
            prompt="What Langauge Model are you? short answer",
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
        response = chat_session.send_message("What Langauge Model are you?")
        print(f"Gemini API Test Successful: {response.text.strip()}")
    except Exception as e:
        print(f"❌ Gemini API Test Failed: {str(e)}")
    
    # 🚀 Start Flask server
    logging.info("🚀 Mist.AI Server is starting...")
app.run(debug=True, host="0.0.0.0", port=5000, use_reloader=False)