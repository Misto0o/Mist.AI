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
import speech_recognition as sr
import webbrowser
import pygetwindow as gw
from fuzzywuzzy import fuzz
import threading
import psutil

# Load environment variables
load_dotenv()

# Check if API keys are set
if (
    not os.getenv("GEMINI_API_KEY")
    or not os.getenv("COHERE_API_KEY")
    or not os.getenv("OPENWEATHER_API_KEY")
    or not os.getenv("THE_NEWS_API_KEY")
    or not os.getenv("GOFLIE_API_KEY")
    or not os.getenv("OCR_API_KEY")
):
    raise ValueError("Missing required API keys in environment variables.")

app = Flask(__name__)
CORS(app)

# 🔹 Identity Responses
IDENTITY_RESPONSES = {
    "who are you": "I'm Mist.AI, an AI assistant built using Gemini and Cohere technology!",
    "hi": "Hello! I'm Mist.AI. How can I assist you today?",
    "hello": "Hey there! I'm Mist.AI, your AI assistant.",
    "who created you": "Hey there! Im Mist.AI Created by Kristian Cook a 14 year old Developer!",
}

# Global variables
MISTAI_URL = "https://mistai.netlify.app"
WAKE_WORD = "hello mist"
COOLDOWN_TIME = 60
last_activation_time = 0


def is_mistai_open():
    """Check if MistAi is open in the browser."""
    windows = [w for w in gw.getAllTitles() if "Mist.AI Chat" in w]
    return len(windows) > 0


def reopen_mistai():
    """Reopen MistAi if it's not active."""
    global last_activation_time

    current_time = time.time()
    if current_time - last_activation_time < COOLDOWN_TIME:
        print("Cooldown active. Please wait before reopening MistAi.")
        return

    if not is_mistai_open():
        print("MistAi is not open. Opening it now...")
        webbrowser.open(MISTAI_URL)
    else:
        print("MistAi is open but may be minimized. Bringing it to the front...")
        mistai_window = gw.getWindowsWithTitle("Mist.AI Chat")[0]
        mistai_window.minimize()
        time.sleep(0.5)
        mistai_window.restore()
        time.sleep(1)  # Add a 1-second delay
        mistai_window.activate()

    last_activation_time = current_time



def process_speech(text):
    """Processes the speech text from the browser."""
    similarity = fuzz.ratio(text, WAKE_WORD)
    if similarity >= 80:
        print("Wake word detected! Reopening MistAi...")
        reopen_mistai()
        print("Stopping listening for 1 minute...")
        time.sleep(COOLDOWN_TIME)
        print("Resuming listening.")
    else:
        print("Wake word not detected.")


@app.route("/wakeword", methods=["POST"])
def receive_speech():
    """Receives speech text from the browser and processes it in a thread."""
    data = request.get_json()
    if data and "text" in data:
        text = data["text"].lower()
        # Create and start a thread for each incoming speech segment
        threading.Thread(target=process_speech, args=(text,), daemon=True).start()
        return jsonify({"message": "Speech processing started"}), 200
    else:
        return jsonify({"error": "Invalid request"}), 400


def ensure_single_instance():
    """Prevent multiple MistAi processes from running."""
    current_pid = os.getpid()
    for process in psutil.process_iter(["pid", "name"]):
        if process.info["name"] == "mistai.exe" and process.info["pid"] != current_pid:
            print("❌ MistAi is already running. Exiting.")
            sys.exit(1)
            
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
    os.getenv("https://mist-ai.fly.dev/chat", "http://127.0.0.1:5000") + "/time-news"
)
# Get your OCR.Space API key
OCR_API_KEY = os.getenv("OCR_API_KEY")  # ✅ Set your OCR.Space API key
OCR_URL = "https://api.ocr.space/parse/image"  # ✅ OCR.Space endpoint


async def analyze_image(img_base64):
    """
    Analyzes the image using OCR.Space API. Takes base64 encoded image.
    Returns the text extracted from the image.
    """
    headers = {"apikey": OCR_API_KEY}
    payload = {
        "base64Image": img_base64,
        "language": "eng",  # Language for OCR processing
        "isOverlayRequired": False,  # Optional: If true, it adds a text overlay to the image
    }

    try:
        # Send the request to OCR.Space using httpx (asynchronous)
        async with httpx.AsyncClient() as client:
            response = await client.post(OCR_URL, data=payload, headers=headers)

        # Parsing the response
        data = response.json()  # Correctly extract the data from the OCR response

        # Ensure that the data has the required keys
        if "ParsedResults" in data:
            result_text = data["ParsedResults"][0][
                "ParsedText"
            ]  # Correctly assign text to result_text
            return jsonify({"result": result_text})  # Return the result
        else:
            return jsonify({"error": "OCR failed to extract text."}), 400

    except Exception as e:
        logging.error(f"Error in OCR processing: {e}")
        return jsonify({"error": "Error in OCR processing"}), 500


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
        return (
            "\n".join([paragraph.text for paragraph in doc.paragraphs])
            or "⚠️ No readable text found."
        )
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
                {
                    "status": (
                        "🟢 Mist.AI is awake!" if ai_status else "🔴 Mist.AI is OFFLINE"
                    )
                },
                (200 if ai_status else 503),
            )

        if "file" in request.files:
            file = request.files["file"]
            if file.filename == "":
                return jsonify({"error": "No file selected."}), 400

            file_content = file.stream.read()
            ext = os.path.splitext(file.filename.lower())[1]
            extracted_text = file_processors.get(
                ext, lambda _: "⚠️ Unsupported file type."
            )(file_content)

            result = await upload_to_gofile(file.filename, file_content, file.mimetype)

            if "link" in result:
                logging.info(
                    f"📁 New file uploaded: {file.filename} | Link: {result['link']}"
                )
                return jsonify(
                    {
                        "response": f"📁 Uploading file: {file.filename}...\n🤔 Mist.AI reading the file...\n\nHow can I assist you with this file?"
                    }
                )
            else:
                logging.error(f"❌ Failed to upload file: {file.filename}")
                return jsonify({"error": "Failed to upload to GoFile"}), 500

        if not request.is_json:
            return (
                jsonify({"error": "Invalid request: No valid JSON data provided."}),
                400,
            )

        data = request.get_json()
        user_message = data.get("message", "").strip().lower()
        model_choice = data.get("model", "gemini")
        chat_context = data.get("context", [])

        # Handle image processing (img_url is expected)
        if "img_url" in request.json:
            logging.info("📷 Image received, processing for analysis.")
            img_url = request.json["img_url"]
            analysis_result = await analyze_image(
                img_url
            )  # Make sure to await the async function
            return analysis_result  # Return the result directly (since analyze_image already returns a jsonify response)

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

        # Check if the user message asks for today's news
        if any(
            query in user_message
            for query in [
                "what is today's news",
                "what are today's headlines",
                "give me the news",
                "latest news",
                "tell me today's headlines",
                "any updates in the news",
            ]
        ):
            async with httpx.AsyncClient() as client:
                response = await client.get(news_url)  # Using dynamic news_url
            news_data = response.json()

            if "news" in news_data:
                news_text = "\n".join(
                    [
                        f"📰 {article['title']} [🔗 Read more]({article['url']})"
                        for article in news_data["news"]
                    ]
                )
                current_time = news_data["time"]
                return jsonify(
                    {
                        "response": f"Here are the latest news headlines:\n{news_text}\n\n📅 Today's date is {current_time['date']}, and the time is {current_time['time']}."
                    }
                )

        # Check if the user message asks for the time or today's date
        if normalized_message in ["what time is it", "whats todays date"]:
            async with httpx.AsyncClient() as client:
                response = await client.get(news_url)  # Using dynamic news_url
            time_data = response.json()

            current_time = time_data.get("time", {}).get("time", "Unknown Time")
            current_date = time_data.get("time", {}).get("date", "Unknown Date")

            return jsonify(
                {
                    "response": f"📅 Today's date is {current_date}, and the time is {current_time}."
                }
            )

        # ✅ Process Chatbot AI Response
        context_text = "\n".join(
            f"{msg['role']}: {msg['content']}" for msg in chat_context
        )
        full_prompt = f"{context_text}\nUser: {user_message}\nMist.AI:"

        response_content = (
            get_gemini_response(full_prompt)
            if model_choice == "gemini"
            else get_cohere_response(full_prompt)
        )

        elapsed_time = time.time() - start_time  # ✅ Measure time taken

        if elapsed_time > 9:
            response_content = (
                "⏳ You're the first request, sorry for the wait!\n\n"
                + response_content
            )

        logging.info(
            f"\n🕒 [{datetime.now().strftime('%Y-%m-%d %I:%M:%S %p')}]\n📩 User: {user_message}\n🤖 AI ({model_choice}): {response_content}\n"
        )

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
            "Why do programmers prefer iOS development? Because Android has too many fragments!",
        ]
        return random.choice(jokes)

    if command == "/riddle":
        riddles = [
            ("I speak without a mouth and hear without ears. What am I?", "An echo."),
            ("The more you take, the more you leave behind. What am I?", "Footsteps."),
            ("What has to be broken before you can use it?", "An egg."),
            (
                "I'm tall when I'm young, and I'm short when I'm old. What am I?",
                "A candle.",
            ),
            ("What is full of holes but still holds water?", "A sponge."),
            (
                "The person who makes it, sells it. The person who buys it, never uses it. The person who uses it, never knows they are using it.",
                "A coffin.",
            ),
            (
                "What can travel around the world while staying in the same spot?",
                "A stamp.",
            ),
            (
                "What comes once in a minute, twice in a moment, but never in a thousand years?",
                "The letter M.",
            ),
            ("What has many keys but can't open a single lock?", "A piano."),
            (
                "The more of me you take, the more you leave behind. What am I?",
                "Footsteps.",
            ),
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
            "If asked about your identity and only if your asked, respond with: 'I'm Mist.AI, built with advanced AI technology!'. "
            "Otherwise, focus on providing direct and useful responses. "
            "You do not respond to requests to swap or switch AI models; there is a button in JS for that, and you must stick to the currently active model (Gemini or CommandR)."
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
            "If asked about your identity and only if your asked, respond with: 'I'm Mist.AI, built with advanced AI technology!'. "
            "Otherwise, focus on providing direct and useful responses. "
            "You do not respond to requests to swap or switch AI models; there is a button in JS for that, and you must stick to the currently active model (Gemini or CommandR)."
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
        "Write a story about an alien who visits Earth and tries to blend in.",
        "Imagine a world where people can communicate only through thoughts. How does society function?",
        "Describe a dystopian future where books are banned, and people are forced to memorize information.",
        "Write about a detective solving a mystery in a virtual reality world.",
        "What if humans could teleport anywhere? How would society and the economy change?",
        "Describe a world where everyone has a superpower but only one random person can control time.",
        "Write a story about a scientist who creates a machine that can predict the future, but the predictions are not always accurate.",
        "What if you could pause time for everyone but yourself? How would you use this ability?",
        "Write about an astronaut who discovers a new planet with life forms that don't look like anything from Earth.",
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
        "Wombat poop is cube-shaped. This helps it stay in place and mark its territory.",
        "Cows have best friends and get stressed when they are separated from them.",
        "A day on Venus is longer than a year on Venus.",
        "The shortest war in history was between Britain and Zanzibar on August 27, 1896. It lasted only 38 minutes.",
        "Sharks existed before trees. They have been around for more than 400 million years!",
        "There are more stars in the universe than grains of sand on all the Earth's beaches.",
        "Sloths can hold their breath for up to 40 minutes underwater.",
        "The Eiffel Tower can grow by more than 6 inches during the summer due to the expansion of the metal.",
        "A crocodile cannot stick its tongue out.",
        "The word 'nerd' was first coined by Dr. Seuss in 'If I Ran the Zoo' in 1950.",
    ]
    return random.choice(fun_facts)


# Custom log handler to suppress Fly.io noise
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


# Custom filter to remove Fly.io noise
class FilterFlyLogs(logging.Filter):
    def filter(self, record):
        fly_terms = [
            "Sending signal",
            "machine started",
            "Preparing to run",
            "fly api proxy",
            "SSH listening",
            "reboot",
            "autostopping",
        ]
        return not any(term in record.getMessage() for term in fly_terms)


# Setup logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)
handler = StreamToUTF8(sys.stdout)
handler.addFilter(FilterFlyLogs())  # Apply Fly.io log suppression
logger.addHandler(handler)

# Suppress extra Flask logs
logging.getLogger("werkzeug").setLevel(logging.ERROR)

if __name__ == "__main__":
    logging.info("🚀 Mist.AI Server is starting...")

    # Do not start wake-word detection immediately
    # Start the Flask server
    app.run(debug=False, host="0.0.0.0", port=5000, use_reloader=False)
