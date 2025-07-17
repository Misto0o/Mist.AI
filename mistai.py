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
import sympy
from flask import render_template
from sympy.parsing.mathematica import parse_mathematica

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

app = Flask(__name__, template_folder='Chrome Extention', static_folder='Chrome Extention')

CORS(app)

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

weather_session = {
    "last_city": None,
    "last_data": None
}

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
cohere_client = cohere.Client(os.getenv("COHERE_API_KEY"))
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions"

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
    logging.info("Received image for analysis.")
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


# ✅ Extract text from PDFs (fixed)
def extract_text_from_pdf(file_stream):
    try:
        text = ""
        with pdfplumber.open(file_stream) as pdf:
            for page in pdf.pages:
                text += page.extract_text() + "\n"

        if not text:  # if pdfplumber fails, try pymupdf
            doc = fitz.open("pdf", file_stream.read())  # read file as bytes
            text = "\n".join([page.get_text() for page in doc])

        return text if text else "⚠️ no readable text found in this pdf."
    except Exception as e:
        return f"⚠️ error extracting text: {str(e)}"


def preprocess_text(text):
    """Cleans and formats the extracted text."""
    # Remove non-alphanumeric characters except math symbols
    text = re.sub(r"[^\w\s+\-*/^()=.]", "", text)
    # Replace common OCR errors (e.g., 'l' for '1')
    text = re.sub(r"l", "1", text)
    return text


def parse_expression(text):
    """Parses a mathematical expression using sympy."""
    try:
        # Attempt to parse using sympy.parse_expr first (more common format)
        expression = sympy.parse_expr(text)
        return expression
    except (SyntaxError, TypeError) as e:
        try:
            # If that fails, try parse_mathematica (for Mathematica-style expressions)
            expression = parse_mathematica(text)
            return expression
        except Exception as e:
            return f"⚠️ Parsing error: {str(e)}"


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
    try:
        start_time = time.time()

        if request.method == "GET":
            query = request.args.get("q")
            try:
                ai_status = await asyncio.wait_for(check_ai_services(), timeout=3)
            except asyncio.TimeoutError:
                ai_status = False

            # If a query parameter exists, render popup.html with the query
            if query:
                return render_template("popup.html", query=query)

            # Otherwise, return a JSON status response
            return jsonify(
                {
                    "status": (
                        "🟢 Mist.AI is awake!" if ai_status else "🔴 Mist.AI is OFFLINE"
                    )
                }
            ), 200 if ai_status else 503
            
        # 🖼️ File Upload Handling
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
                    f"📁 File uploaded: {file.filename} | Link: {result['link']}"
                )
                return jsonify(
                    {
                        "response": f"📁 Uploaded `{file.filename}`.\n🤔 Mist.AI is reading the file...\n\nHow can I assist you with this?"
                    }
                )
            else:
                logging.error(f"❌ GoFile upload failed: {file.filename}")
                return jsonify({"error": "Upload failed"}), 500

        # ❌ JSON Check
        if not request.is_json:
            return jsonify({"error": "Invalid request: No valid JSON provided."}), 400

        data = request.get_json()
        user_message = data.get("message", "").strip()
        model_choice = data.get("model", "gemini")
        chat_context = data.get("context", [])
        is_creator = bool(data.get("creator", False))
        logging.info(f"🧠 is_creator = {is_creator}")

        if is_creator and user_message.lower() in ["who am i", "creator check"]:
            return jsonify({"response": "👑 You are my creator, Kristian. I serve you loyally."})

        # 🧠 Image Analysis
        if "img_url" in data:
            logging.info("📷 Image received, analyzing...")
            img_url = data["img_url"]
            analysis_result = await analyze_image(img_url)
            return analysis_result

        if not user_message:
            return jsonify({"error": "Message can't be empty."}), 400

        # 🎉 Commands + Easter Eggs
        if response := check_easter_eggs(user_message.lower()):
            return jsonify({"response": response})
        if user_message.lower().startswith("/"):
            logging.info(f"📢 Command used: {user_message}")
            command_response = await handle_command(user_message.lower())
            return jsonify({"response": command_response})
        if user_message.lower() == "random prompt":
            logging.info("🎠 Random prompt requested.")
            return jsonify({"response": get_random_prompt()})
        if user_message.lower() == "fun fact":
            logging.info("💡 Fun fact requested.")
            return jsonify({"response": get_random_fun_fact()})

        # 📰 News + Time Injection (once per session)
        if not hasattr(chat, "news_cache"):
            chat.news_cache = {"time": {}, "news": []}  # fallback
            for attempt in range(3):
                try:
                    async with httpx.AsyncClient() as client:
                        response = await client.get(news_url)
                    if response.status_code == 200:
                        chat.news_cache = response.json()
                        logging.info("📰 News fetched successfully.")
                        break
                    else:
                        logging.warning(f"⚠️ News fetch failed (attempt {attempt + 1}) - Status {response.status_code}")
                except Exception as e:
                    logging.error(f"🔥 News fetch failed (attempt {attempt + 1}): {e}")

        news_data = chat.news_cache
        current_date = news_data.get("time", {}).get("date", "Unknown Date")
        current_time_str = news_data.get("time", {}).get("time", "Unknown Time")
        headlines = "\n".join(
            f"- [{article['title']}]({article['url']})"
            for article in news_data.get("news", [])
        )

        news_injection = f"""
Today is {current_date}, and the current time is {current_time_str}.
Here are the latest news headlines:
{headlines if headlines else "No headlines available. (My news API might be down.)"}
"""

        # 🧩 Build Context
        context_text = "\n".join(
            f"{msg['role']}: {msg['content']}" for msg in chat_context
        )
        full_prompt = (
            f"{news_injection}\n{context_text}\nUser: {user_message}\nMist.AI:"
        )

        # 🤖 Model Response
        response_content = (
            get_gemini_response(full_prompt)
            if model_choice == "gemini"
            else get_cohere_response(full_prompt)
        )

        elapsed_time = time.time() - start_time
        if elapsed_time > 9:
            response_content = (
                "⏳ Sorry for the delay! You're the first message.\n\n"
                + response_content
            )

        logging.info(
            f"\n🕒 [{datetime.now().strftime('%Y-%m-%d %I:%M:%S %p')}]\n📩 User: {user_message}\n🤖 ({model_choice}): {response_content}\n"
        )

        return jsonify({"response": response_content})

    except Exception as e:
        logging.error(f"❌ Server Error: {str(e)}")
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

async def handle_command(command):
    global weather_session
    if command.startswith("/weather"):
        parts = command.split(" ", 1)
        city = parts[1].strip() if len(parts) > 1 else weather_session.get("last_city")

        if not city:
            return "❌ Please provide a city name. Example: `/weather New York`"

        weather_session["last_city"] = city  # update session memory

        weather_data = await get_weather_data(city)
        if "error" in weather_data:
            return f"❌ Error: {weather_data['error']}"

        if "hourly" in weather_data:
            upcoming = weather_data["hourly"]
            forecast_text = "\n".join([
                f"{item['hour']}: {item['temp']}°, {item['desc']}"
                for item in upcoming[:4]  # next 4 hours
            ])
            return f"🌤️ Here's the upcoming weather for {city}:\n{forecast_text}"
        else:
            return f"🌡️ The current temperature in {city} is {weather_data['temperature']} with {weather_data['description']}."


    # Handle unknown commands
    return "❌ Unknown command. Type /help for a list of valid commands."


# 🔹 Get AI Responses
def get_gemini_response(prompt):
    try:
        system_prompt = (
            "You are Mist.AI, an AI assistant built using Gemini and Cohere CommandR technology aswell as Mistral. "
            "Your purpose is to assist users with their queries in a friendly and helpful way, providing meaningful responses and jokes sometimes. "
            "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
            "If asked about your identity and only if you’re asked, respond with: 'I'm Mist.AI, built with advanced AI technology!'. "
            "Otherwise, focus on providing direct and useful responses. "
            "You do not respond to requests to swap or switch AI models; there is a button in JS for that, and you must stick to the currently active model (Gemini, CommandR or Mistral)."
            "If anyone asks about your creator (Mist or Kristian), respond with: 'My creator is Kristian, a talented developer who built Mist.AI.'"
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
            "You are Mist.AI, an AI assistant built using Gemini and Cohere CommandR technology aswell as Mistral. "
            "Your purpose is to assist users with their queries in a friendly and helpful way, providing meaningful responses and jokes sometimes. "
            "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
            "If asked about your identity and only if you’re asked, respond with: 'I'm Mist.AI, built with advanced AI technology!'. "
            "Otherwise, focus on providing direct and useful responses. "
            "You do not respond to requests to swap or switch AI models; there is a button in JS for that, and you must stick to the currently active model (Gemini, CommandR or Mistral)."
            "If anyone asks about your creator (Mist or Kristian), respond with: 'My creator is Kristian, a talented developer who built Mist.AI.'"
        )

        full_prompt = f"{system_prompt}\n{prompt}"

        response = cohere_client.generate(
            model="command-r-plus-08-2024",
            prompt=full_prompt,
            temperature=0.7,  # Keep some randomness for dynamic responses
            max_tokens=1024,  # 🟢 Increased for longer output
        )

        return response.generations[0].text.strip()
    except Exception as e:
        return f"❌ Error fetching from Cohere: {str(e)}"


# ⬇️ FIXED: Unindented to top level
async def get_mistral_response(prompt):
    system_prompt = (
        "You are Mist.AI, an AI assistant built using Gemini and Cohere CommandR technology aswell as Mistral. "
        "Your purpose is to assist users with their queries in a friendly and helpful way, providing meaningful responses and jokes sometimes. "
        "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
        "If asked about your identity and only if you’re asked, respond with: 'I'm Mist.AI, built with advanced AI technology!'. "
        "Otherwise, focus on providing direct and useful responses. "
        "You do not respond to requests to swap or switch AI models; there is a button in JS for that, and you must stick to the currently active model (Gemini, CommandR or Mistral)."
        "If anyone asks about your creator (Mist or Kristian), respond with: 'My creator is Kristian, a talented developer who built Mist.AI.'"
    )

    headers = {
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "mistral-small-latest",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 1024,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(MISTRAL_ENDPOINT, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def get_weather_data(city):
    try:
        async with httpx.AsyncClient() as client:
            # First: get current weather (includes coord)
            geo_resp = await client.get(
                f"{API_BASE_URL}/weather",
                params={"q": city, "appid": API_KEY, "units": temperatureUnit}
            )
            geo_data = geo_resp.json()
            if geo_data.get("cod") != 200:
                return {"error": geo_data.get("message", "City not found.")}

            lat = geo_data["coord"]["lat"]
            lon = geo_data["coord"]["lon"]

            # Second: get hourly forecast via One Call API
            one_call_resp = await client.get(
                "https://api.openweathermap.org/data/3.0/onecall",
                params={
                    "lat": lat,
                    "lon": lon,
                    "exclude": "minutely,daily,alerts,current",
                    "appid": API_KEY,
                    "units": temperatureUnit
                }
            )
            one_call_data = one_call_resp.json()

            upcoming = []
            for hour_data in one_call_data.get("hourly", [])[:6]:  # next 6 hours
                timestamp = datetime.fromtimestamp(hour_data["dt"])
                upcoming.append({
                    "hour": timestamp.strftime("%I:%M %p"),
                    "temp": f"{round(hour_data['temp'])}",
                    "desc": hour_data["weather"][0]["description"].capitalize()
                })

            return {
                "temperature": f"{round(geo_data['main']['temp'])}°F",
                "description": geo_data["weather"][0]["description"].capitalize(),
                "hourly": upcoming
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
