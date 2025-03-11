import os
import random
import sys
import pdfplumber
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
import cohere
from dotenv import load_dotenv
import logging
import httpx
import re
from datetime import datetime
import pytz
import requests
import io
import asyncio
import json
from docx import Document
import time
import fitz

# Load environment variables
load_dotenv()

# Check if API keys are set
if (
    not os.getenv("GEMINI_API_KEY")
    or not os.getenv("COHERE_API_KEY")
    or not os.getenv("OPENWEATHER_API_KEY")
    or not os.getenv("THE_NEWS_API_KEY")  
    or not os.getenv("GOFLIE_API_KEY")  
):
    raise ValueError("Missing required API keys in environment variables.")

app = Flask(__name__)
CORS(
    app,
    origins=[
        "http://127.0.0.1:5500",  # Local development
        "https://mist-ai-64pc.onrender.com",  # Render deployment
        "https://mistai.netlify.app",  # Netlify frontend
        "file:///D:/Mist.AI",  # Local file path (Windows)
        "file:///media/removable/SanDisk/Mist.AI",  # Removable drive (Linux/Mac)
    ],
)

# 🔹 Identity Responses
IDENTITY_RESPONSES = {
    "who are you": "I'm Mist.AI, an AI assistant built using Gemini and Cohere technology!",
    "hi": "Hello! I'm Mist.AI. How can I assist you today?",
    "hello": "Hey there! I'm Mist.AI, your AI assistant.",
    "who created you": "Hey there! Im Mist.AI Created by Kristian Cook a 14 year old Developer!",
}

def check_identity_responses(user_message):
    normalized_message = re.sub(r"[^\w\s]", "", user_message.lower()).strip()
    return IDENTITY_RESPONSES.get(normalized_message, None)

EASTER_EGGS = {
    "whos mist": "I'm Mist.AI, your friendly chatbot! But shh... don't tell anyone I'm self-aware. 🤖",
    "massive": "You know what else is Massive? LOW TAPER FADE",
    "low": "LOW TAPER FADE!",
    "taper": "LOW TAPER FADE",
    "fade": "LOW TAPER FADE",
    "what is the low taper fade meme": "Imagine If Ninja Got a Low Taper Fade is a viral audio clip from a January 2024 Twitch freestyle by hyperpop artist ericdoa, where he sings the phrase. The clip quickly spread on TikTok, inspiring memes and edits of streamer Ninja with a low taper fade. By mid-January, TikTok users created slideshows, reaction videos, and joke claims that the song was by Frank Ocean. The meme exploded when Ninja himself acknowledged it and even got the haircut on January 13th, posting a TikTok that amassed over 5.4 million views in three days. Later in 2024, a parody meme about Tfue and a high taper fade went viral. By the end of the year, people joked about how the meme was still popular, with absurd edits of Ninja in different lifetimes.",
    "jbl speaker": "I want you to be mine again, baby, ayy I know my lifestyle is drivin' you crazy, ayy I cannot see myself without you We call them fans, though, girl, you know how we do I go out of my way to please you I go out of my way to see you And I want you to be mine again, baby, ayy I know my lifestyle is driving you crazy, ayy But I cannot see myself without you We call them fans, though, girl, you know how we do I go out of my way to please you I go out of the way to see you I ain't playing no games, I need you",
    "tell me a mistai secret": "Every time you refresh this page, I forget everything... except that one embarrassing thing you did. Just kidding! (Or am I?)",
    "whats the hidden theme": "The hidden theme is a unlockable that you need to input via text or arrow keys try to remember a secret video game code...",
    "whats your favorite anime": "Dragon Ball Z! I really love the anime.",
}

def check_easter_eggs(user_message):
    normalized_message = re.sub(r"[^\w\s]", "", user_message.lower()).strip()
    return EASTER_EGGS.get(normalized_message, None)

# Configure APIs
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY")
RAPIDAPI_HOST = os.getenv("RAPIDAPI_HOST")

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
cohere_client = cohere.Client(os.getenv("COHERE_API_KEY"))

the_news_api_key = os.getenv("THE_NEWS_API_KEY")
goflie_api_key = os.getenv("GOFLIE_API_KEY")
API_KEY = os.getenv("OPENWEATHER_API_KEY")

API_BASE_URL = "https://api.openweathermap.org/data/2.5"
temperatureUnit = "imperial"
news_url = (
    os.getenv("https://mist-ai-64pc.onrender.com/chat", "http://127.0.0.1:5000")
    + "/time-news"
)

@app.route('/analyze', methods=['POST'])
def analyze_image():
    data = request.json
    img_url = data.get('img_url')

    if not img_url:
        return jsonify({"error": "Image URL is required"}), 400

    url = "https://chatgpt-42.p.rapidapi.com/matagvision"
    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "chatgpt-42.p.rapidapi.com",
        "Content-Type": "application/json"
    }
    payload = {
        "messages": [
            {
                "role": "user",
                "content": "What's in the image?",
                "img_url": img_url
            }
        ]
    }

    response = requests.post(url, json=payload, headers=headers)  # ✅ Use requests (not httpx)
    
    try:
        return jsonify(response.json())  # ✅ Properly return JSON response
    except ValueError:
        return jsonify({"error": "Invalid response from API"}), 500

# ✅ Get the best available GoFile server
async def get_best_server():
    response = requests.get("https://api.gofile.io/servers")
    if response.status_code == 200:
        return response.json()["data"]["servers"][0]["name"]
    return None

# ✅ Upload file directly from memory to GoFile
async def upload_to_gofile(filename, file_content, mimetype):
    server = await get_best_server()
    if not server:
        return {"error": "Failed to get server"}

    files = {"file": (filename, io.BytesIO(file_content), mimetype)}
    params = {"token": os.getenv("GOFLIE_API_KEY")}
    upload_url = f"https://{server}.gofile.io/uploadFile"

    response = requests.post(upload_url, files=files, data=params).json()

    if response["status"] == "ok":
        return {"link": response["data"]["downloadPage"]}
    else:
        return {"error": "Upload failed"}
    
# ✅ Extract text from PDFs (Fixed)
def extract_text_from_pdf(file_stream):
    try:
        text = ""
        with pdfplumber.open(file_stream) as pdf:
            for page in pdf.pages:
                text += page.extract_text() + "\n"

        if not text:  # If pdfplumber fails, try PyMuPDF
            doc = fitz.open("pdf", file_stream.read())  # Read file as bytes
            text = "\n".join([page.get_text() for page in doc])

        return text if text else "⚠️ No readable text found in this PDF."
    except Exception as e:
        return f"⚠️ Error extracting text: {str(e)}"
    
@app.route("/time-news", methods=["GET"])
async def time_news():
    try:
        # Get the current time (using New York timezone, adjust as needed)
        now = datetime.now(pytz.timezone("America/New_York"))
        current_time = {
            "date": now.strftime("%A, %B %d, %Y"),
            "time": now.strftime("%I:%M %p %Z"),
        }

        # Fetch news headlines from TheNewsAPI
        news_api_key = os.getenv("THE_NEWS_API_KEY")
        if not news_api_key:
            return jsonify({"error": "News API key not set."}), 500

        url = "https://api.thenewsapi.com/v1/news/top"
        params = {
            "api_token": news_api_key,
            "locale": "us",  # Change locale if needed
            "limit": 3,  # Number of articles per request
        }

        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
        news_data = response.json()

        # Extract headline data
        articles = []
        if "data" in news_data:
            for article in news_data["data"]:
                articles.append(
                    {
                        "title": article.get("title"),
                        "url": article.get("url"),
                        "source": (
                            article.get("source", {}).get("name")
                            if isinstance(article.get("source"), dict)
                            else article.get("source")
                        ),
                    }
                )

        # Return combined time and news data
        return jsonify({"time": current_time, "news": articles})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    # ✅ Function to process different file types
def process_pdf(file_content):
    return extract_text_from_pdf(io.BytesIO(file_content))

def process_txt(file_content):
    return file_content.decode("utf-8", errors="ignore")

def process_json(file_content):
    try:
        json_data = json.loads(file_content.decode("utf-8"))
        return json.dumps(json_data, indent=4)
    except json.JSONDecodeError:
        return "⚠️ Invalid JSON file."

def process_docx(file_content):
    if not file_content:
        return "⚠️ No file content received."

    try:
        text = extract_text_from_docx(io.BytesIO(file_content))
        return text if text.strip() else "⚠️ No readable text found."
    except Exception as e:
        print(f"Error reading DOCX: {e}")  # Debugging
        return f"⚠️ Error reading .docx file: {str(e)}"

def extract_text_from_docx(file_content):
    try:
        doc = Document(file_content)
        return "\n".join([paragraph.text for paragraph in doc.paragraphs]) or "⚠️ No readable text found."
    except Exception as e:
        return f"⚠️ Error reading .docx file: {str(e)}"


# ✅ Mapping file extensions to processing functions
file_processors = {
    ".pdf": process_pdf,
    ".txt": process_txt,
    ".json": process_json,
    ".docx": process_docx,
    ".doc": process_docx,
}
    
@app.route("/chat", methods=["POST", "GET"])
async def chat():
    """
    Handles chat requests for Mist.AI, including:
    - Checking if AI services are online (GET request)
    - File uploads (PDF text extraction + GoFile upload)
    - Processing user messages (including Easter eggs, commands, and chatbot responses)
    """
    try:
        start_time = time.time()  # ✅ Track request start time

        if request.method == "GET":
            try:
                ai_status = await asyncio.wait_for(check_ai_services(), timeout=3)
            except asyncio.TimeoutError:
                ai_status = False  
            return jsonify(
                {"status": "🟢 Mist.AI is awake!" if ai_status else "🔴 Mist.AI is OFFLINE"},
                (200 if ai_status else 503),
            )

        if "file" in request.files:
            file = request.files["file"]
            if file.filename == "":
                return jsonify({"error": "No file selected."}), 400

            file_content = file.stream.read()
            ext = os.path.splitext(file.filename.lower())[1]
            extracted_text = file_processors.get(ext, lambda _: "⚠️ Unsupported file type.")(file_content)

            result = await upload_to_gofile(file.filename, file_content, file.mimetype)

            if "link" in result:
                logging.info(f"📁 New file uploaded: {file.filename} | Link: {result['link']}")
                return jsonify({"response": f"📁 Uploading file: {file.filename}...\n🤔 Mist.AI reading the file...\n\nHow can I assist you with this file?"})
            else:
                logging.error(f"❌ Failed to upload file: {file.filename}")
                return jsonify({"error": "Failed to upload to GoFile"}), 500

        if not request.is_json:
            return jsonify({"error": "Invalid request: No valid JSON data provided."}), 400

        data = request.get_json()
        user_message = data.get("message", "").strip().lower()
        model_choice = data.get("model", "gemini")
        chat_context = data.get("context", [])
        
        if "img_url" in data:
            logging.info("📷 Image received in /chat, redirecting to image analysis.")
            return analyze_image()  # ❌ No 'await' here since analyze_image() is now synchronous

        if not user_message:
            return jsonify({"error": "Invalid input: 'message' cannot be empty."}), 400

        if response := check_easter_eggs(user_message):
            return jsonify({"response": response})

        if user_message.startswith("/"):
            logging.info(f"📢 User ran command: {user_message}")
            command_response = await handle_command(user_message)
            return jsonify({"response": command_response})

        if user_message == "random prompt":
            logging.info("🎠 User requested a random prompt.")
            return jsonify({"response": get_random_prompt()})

        if user_message == "fun fact":
            logging.info("💡 User requested a fun fact.")
            return jsonify({"response": get_random_fun_fact()})
        
        normalized_message = re.sub(r"[^\w\s]", "", user_message.lower()).strip()

        if "what is todays news" in user_message or "what are todays headlines" in user_message:
            async with httpx.AsyncClient() as client:
                news_response = await client.get(news_url)
            news_data = news_response.json()

            if "news" in news_data:
                news_text = "\n".join(
                    [f"📰 {article['title']} [🔗 Read more]({article['url']})" for article in news_data["news"]]
                )
                return jsonify({"response": f"Here are the latest news headlines:\n{news_text}"})

        if normalized_message in ["what time is it", "whats todays date"]:
            async with httpx.AsyncClient() as client:
                time_response = await client.get(news_url)
            time_data = time_response.json()

            current_time = time_data.get("time", {}).get("time", "Unknown Time")
            current_date = time_data.get("time", {}).get("date", "Unknown Date")

            return jsonify({"response": f"📅 Today's date is {current_date}, and the time is {current_time}."})
        
        # ✅ Process Chatbot AI Response
        context_text = "\n".join(f"{msg['role']}: {msg['content']}" for msg in chat_context)
        full_prompt = f"{context_text}\nUser: {user_message}\nMist.AI:"

        response_content = (
            get_gemini_response(full_prompt)
            if model_choice == "gemini"
            else get_cohere_response(full_prompt)
        )

        elapsed_time = time.time() - start_time  # ✅ Measure time taken

        if elapsed_time > 9:
            response_content = "⏳ You're the first request, sorry for the wait!\n\n" + response_content

        logging.info(f"\n🕒 [{datetime.now().strftime('%Y-%m-%d %I:%M:%S %p')}]\n📩 User: {user_message}\n🤖 AI ({model_choice}): {response_content}\n")
        
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

import random

# 🔹 Handle Commands
async def handle_command(command):
    command = command.strip().lower()

    # Handle empty command after "/"
    if command == "/":
        return "❌ Please provide a valid command. Example: `/flipcoin`."
    
    if command == "/help":
        return """
        Available commands:
        /flipcoin - Flip a coin
        /rps - Play rock, paper, scissors
        /joke - Get a random joke
        /riddle - Get a random riddle
        /weather <city> - Get weather information for a city
        """
    if command == "/flipcoin":
        return "🪙 " + random.choice(["Heads!", "Tails!"])

    if command == "/rps":
        return "✊ ✋ ✌️ I choose: " + random.choice(
            ["Rock 🪨", "Paper 📄", "Scissors ✂️"]
        )
        
    if command == "/joke":
        jokes = [
            "Why don’t programmers like nature? It has too many bugs.",
            "Why do Java developers wear glasses? Because they don’t see sharp.",
            "I told my computer I needed a break, and now it won’t stop sending me KitKats.",
            "Why did the computer catch a cold? It left its Windows open!",
            "Why was the JavaScript developer sad? Because he didn’t ‘null’ his problems.",
            "Why did the frontend developer break up with the backend developer? There was no ‘connection’.",
            "Why do Python programmers prefer dark mode? Because light attracts bugs!",
            "Why did the CSS developer go to therapy? Because they had too many margins!",
            "What do you call a computer that sings? A Dell.",
            "Why do programmers prefer iOS development? Because Android has too many fragments!"
        ]
        return random.choice(jokes)

    if command == "/riddle":
        riddles = [
            ("I speak without a mouth and hear without ears. What am I?", "An echo."),
            ("The more you take, the more you leave behind. What am I?", "Footsteps."),
            ("What has to be broken before you can use it?", "An egg."),
            ("I'm tall when I'm young, and I'm short when I'm old. What am I?", "A candle."),
            ("What is full of holes but still holds water?", "A sponge."),
            ("The person who makes it, sells it. The person who buys it, never uses it. The person who uses it, never knows they are using it.", "A coffin."),
            ("What can travel around the world while staying in the same spot?", "A stamp."),
            ("What comes once in a minute, twice in a moment, but never in a thousand years?", "The letter M."),
            ("What has many keys but can't open a single lock?", "A piano."),
            ("The more of me you take, the more you leave behind. What am I?", "Footsteps."),
            ("I have hands, but I cannot clap. What am I?", "A clock."),
            ("What has words, but never speaks?", "A book."),
            ("What is so fragile that saying its name breaks it?", "Silence."),
        ]

        riddle = random.choice(riddles)
        return f"🤔 {riddle[0]}<br><br><span class='hidden-answer' onclick='this.classList.add(\"revealed\")'>Answer: {riddle[1]}</span>"

    if command.startswith("/weather"):
        city = command.split(" ", 1)[-1].strip()
        if not city:
            return "❌ Please provide a city name. Example: `/weather New York`"

        weather_data = await get_weather_data(city)
        if "error" in weather_data:
            return f"❌ Error: {weather_data['error']}"

        return f"🌡️ The current temperature in {city} is {weather_data['temperature']} with {weather_data['description']}."

    # Handle unknown commands
    return "❌ Unknown command. Type /help for a list of valid commands."

# 🔹 Get AI Responses
def get_gemini_response(prompt):
    try:
        system_prompt = (
            "You are Mist.AI, an AI assistant built using Gemini and Cohere CommandR technology. "
            "Your purpose is to assist users with their queries in a friendly and helpful way, providing meaningful responses and jokes sometimes. "
            "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
            "If asked about your identity, respond with: 'I'm Mist.AI, built with advanced AI technology!'. "
            "Otherwise, focus on providing direct and useful responses."
            "Dont respond to things like swap or switch models you have a button in JS that does that for the user only stick with the one thats current like Gemini Or CommandR"
            "Dont respond to the word time unless ur asked what time is it? or what is todays date?"
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
            "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
            "If asked about your identity, respond with: 'I'm Mist.AI, built with advanced AI technology!'. "
            "Otherwise, focus on providing direct and useful responses."
            "Dont respond to things like swap or switch models you have a button in JS that does that for the user only stick with the one thats current like Gemini Or CommandR"
            "Dont respond to the word time unless ur asked what time is it? or what is todays date?"
        )

        full_prompt = f"{system_prompt}\n{prompt}"

        response = cohere_client.generate(
            model="command-r-plus-08-2024",
            prompt=full_prompt,
            temperature=0.7,  # Keep some randomness for dynamic responses
            max_tokens=200,  # Ensure responses are concise but useful
        )

        return response.generations[0].text.strip()
    except Exception as e:
        return f"❌ Error fetching from Cohere: {str(e)}"

# 🔹 Get Weather Data
async def get_weather_data(city):
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{API_BASE_URL}/weather?q={city}&appid={API_KEY}&units={temperatureUnit}"
            )
            data = response.json()
            if data.get("cod") != 200:
                return {"error": "City not found."}

            return {
                "temperature": f"{round(data['main']['temp'])}°F",
                "description": data["weather"][0]["description"],
            }
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
        self.setFormatter(
            logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
        )

    def emit(self, record):
        try:
            msg = self.format(record)
            stream = self.stream or sys.stderr
            stream.buffer.write((msg + self.terminator).encode("utf-8", "replace"))
            stream.flush()
        except Exception:
            self.handleError(record)
            
logging.basicConfig(level=logging.INFO, handlers=[StreamToUTF8(sys.stdout)])
logging.getLogger("werkzeug").setLevel(logging.ERROR)  # Suppress extra Flask logs

if __name__ == "__main__":
    # 🚀 Start Flask server
    logging.info("🚀 Mist.AI Server is starting...")
app.run(debug=True, host="0.0.0.0", port=5000, use_reloader=False)