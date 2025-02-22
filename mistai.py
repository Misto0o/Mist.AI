import os
import random
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
import cohere
from dotenv import load_dotenv
import logging
import httpx
import re
from google.cloud import vision
import base64

# Load environment variables
load_dotenv()

# Check if environment variables are set
if not os.getenv("GEMINI_API_KEY") or not os.getenv("COHERE_API_KEY") or not os.getenv("OPENWEATHER_API_KEY"):
    raise ValueError("Missing required API keys in environment variables.")

# Configure APIs
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
cohere_client = cohere.Client(os.getenv("COHERE_API_KEY"))
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

# Weather API Config
API_KEY = os.getenv("OPENWEATHER_API_KEY")
API_BASE_URL = 'https://api.openweathermap.org/data/2.5'
temperatureUnit = 'imperial'

app = Flask(__name__)
CORS(app, origins=[
    "http://127.0.0.1:5500",  # Local dev environment
    "https://mist-ai-64pc.onrender.com",  # Render deployment
    "https://mistai.netlify.app",  # Netlify site
    "file:///D:/Mist.AI",  # Local file URL (Windows)
    "file:///media/removable/SanDisk/Mist.AI",  # Removable media (Linux/Mac)
])

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

def analyze_image(image_data):
    """Analyze image using Google Vision API."""
    try:
        image_content = base64.b64decode(image_data.split(",")[1]) if isinstance(image_data, str) else image_data
        client = vision.ImageAnnotatorClient()
        image = vision.Image(content=image_content)
        response = client.label_detection(image=image)
        labels = [label.description for label in response.label_annotations]
        return f"Detected objects: {', '.join(labels)}" if labels else "No objects detected."
    except Exception as e:
        return f"❌ Image analysis error: {str(e)}"

@app.route('/chat', methods=['POST', 'GET'])
def chat():
    """Handle chat requests, including test pings."""
    try:
        if request.method == "GET":
            return jsonify({"status": "🟢 Mist.AI is awake!"}), 200  # Simple response for GET
        
        # **Handle JSON Text Chat**
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid request data"}), 400

        user_message = data.get("content", "").strip()  # FIXED: Changed "message" to "content"
        model_choice = data.get("model", "gemini")

        if not user_message:
            return jsonify({"error": "Invalid input: 'content' argument must not be empty."}), 400

        # Easter Egg Check
        if (response := check_easter_eggs(user_message)):
            return jsonify({"response": response})

        # Get AI response
        response_content = get_gemini_response(user_message) if "gemini" in model_choice else get_cohere_response(user_message)
        return jsonify({"response": response_content})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

async def handle_command(command):
    """Handles special commands like /rps, /flipcoin, /joke, /riddle, and /weather."""
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
    
    # New weather command handling
    if command.startswith("/weather"):
        city = command.split(" ", 1)[-1].strip()  # Extract city from the command
        if not city:
            return "❌ Please provide a city name. Example: `/weather New York`"
        
        # Fetch weather data
        weather_data = await get_weather_data(city)
        if "error" in weather_data:
            return f"❌ Error: {weather_data['error']}"
        
        return f"The current temperature in {city} is {weather_data['temperature']} with {weather_data['description']}."

    return "❌ Unknown command. Try `/flipcoin`, `/rps`, `/joke`, `/riddle` or '/weather'."

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
            model="command-r-plus-08-2024", prompt=prompt, temperature=0.7, max_tokens=200
        )
        return response.generations[0].text.strip()
    except Exception as e:
        return f"❌ Error fetching from Cohere: {str(e)}"

# Weather-related functions
async def get_weather_data(city):
    if not city:
        return {"error": "Please enter a city name."}

    try:
        async with httpx.AsyncClient() as client:
            # Get weather data from OpenWeather
            response = await client.get(
                f"{API_BASE_URL}/weather?q={city}&appid={API_KEY}&units={temperatureUnit}"
            )
            data = response.json()

            if data.get("cod") != 200:
                return {"error": "City not found."}

            # Get weather data
            weather_info = data.get("main", {})
            description = data["weather"][0]["description"]
            temp = weather_info.get("temp", "N/A")

            # Round the temperature to the nearest whole number
            temp = round(temp)

            return {
                "temperature": f"{temp}°F",  # Keep "°F" here
                "description": description
            }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("🚀 Mist.AI Server is starting...")
    app.run(debug=True, host="0.0.0.0", port=5000)