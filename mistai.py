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
import uuid
import wikipediaapi  # New import for the Wikipedia API
from flask import redirect, url_for, session, flash
import sqlite3
from functools import wraps

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
    or not os.getenv("MISTRAL_API_KEY")
    or not os.getenv("ADMIN_USERNAME")
    or not os.getenv("ADMIN_PASSWORD")
    or not os.getenv("FLASK_SECRET_KEY")
):
    raise ValueError("Missing required API keys in environment variables.")

app = Flask(
    __name__, template_folder="Chrome Extention", static_folder="Chrome Extention"
)

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
    "69": "Nice.",
    "67": "6..7!!!!!!!!!!",
}


def check_easter_eggs(user_message):
    normalized_message = re.sub(r"[^\w\s]", "", user_message.lower()).strip()
    return EASTER_EGGS.get(normalized_message, None)


weather_session = {"last_city": None, "last_data": None}

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
cohere_client = cohere.Client(os.getenv("COHERE_API_KEY"))
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions"
ADMIN_KEY = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
app.secret_key = os.getenv("FLASK_SECRET_KEY")

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
    app.logger.info("Received image for analysis.")
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

            return jsonify({"result": result_text}), 200  # Return the result
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

        # --- New Wikipedia helper function ---


def get_wikipedia_summary(query):
    """
    Fetches a summary and URL for a given query from Wikipedia.

    Args:
        query (str): The search term.

    Returns:
        tuple: A tuple containing the summary (str) and full URL (str),
               or (None, None) if the page doesn't exist.
    """
    # Specify a descriptive user agent to comply with Wikipedia's policy
    wiki_wiki = wikipediaapi.Wikipedia(
        user_agent="Mist.AI (Kristian's Chatbot)", language="en"
    )
    page = wiki_wiki.page(query)

    # Check if the Wikipedia page exists before trying to access its content.
    if not page.exists():
        return None, None

    return page.summary, page.fullurl


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

# =========================
# Database setup
# =========================
if os.path.exists("/app/data"):
    DB_FOLDER = "/app/data"
else:
    DB_FOLDER = "."
DB_FILE = os.path.join(DB_FOLDER, "bans.db")


def get_db_connection():
    """Helper: Always return a SQLite connection."""
    return sqlite3.connect(DB_FILE)


def init_db():
    """Create bans table if missing."""
    os.makedirs(DB_FOLDER, exist_ok=True)
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS bans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT,
            token TEXT UNIQUE
        )
    """
    )
    conn.commit()
    conn.close()
    print(f"🗄️ Database initialized at {DB_FILE}")


def add_token_column():
    """Ensure 'token' column exists."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("PRAGMA table_info(bans)")
    columns = [col[1] for col in c.fetchall()]
    if "token" not in columns:
        print("🛠 Adding 'token' column to bans table...")
        c.execute("ALTER TABLE bans ADD COLUMN token TEXT")
        conn.commit()
    else:
        print("✅ 'token' column already exists.")
    conn.close()


def migrate_to_tokens():
    """Migrate device_id to token if legacy schema exists."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("PRAGMA table_info(bans)")
    columns = [col[1] for col in c.fetchall()]

    if "device_id" in columns:
        print("🔄 Migrating device_id -> token...")
        c.execute("SELECT id, device_id FROM bans WHERE device_id IS NOT NULL")
        rows = c.fetchall()
        for ban_id, device_id in rows:
            if device_id:
                c.execute("UPDATE bans SET token=? WHERE id=?", (device_id, ban_id))
        c.execute("SELECT id FROM bans WHERE token IS NULL")
        for (ban_id,) in c.fetchall():
            c.execute("UPDATE bans SET token=? WHERE id=?", (str(uuid.uuid4()), ban_id))
        # Rebuild table
        c.execute("ALTER TABLE bans RENAME TO bans_old")
        c.execute(
            """
            CREATE TABLE bans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT,
                token TEXT UNIQUE
            )
        """
        )
        c.execute("INSERT INTO bans (id, ip, token) SELECT id, ip, token FROM bans_old")
        c.execute("DROP TABLE bans_old")
        conn.commit()
        print("✅ Migration complete.")
    conn.close()


def unify_tokens_by_ip():
    """Ensure each IP has one row & one token."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT DISTINCT ip FROM bans WHERE ip IS NOT NULL")
    ips = [row[0] for row in c.fetchall()]

    for ip in ips:
        c.execute("SELECT id, token FROM bans WHERE ip=?", (ip,))
        rows = c.fetchall()
        if not rows:
            continue

        main_token = next((token for _, token in rows if token), None)
        if not main_token:
            main_token = str(uuid.uuid4())
            c.execute("UPDATE bans SET token=? WHERE id=?", (main_token, rows[0][0]))

        ids_to_keep = [rows[0][0]]
        c.execute(
            f"DELETE FROM bans WHERE ip=? AND id NOT IN ({','.join(['?']*len(ids_to_keep))})",
            [ip, *ids_to_keep],
        )
        c.execute("UPDATE bans SET token=? WHERE id=?", (main_token, rows[0][0]))

    conn.commit()
    conn.close()
    print("✅ Tokens unified by IP")


def safe_cleanup():
    """Remove bad rows safely."""
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("DELETE FROM bans WHERE ip IS NULL")
        conn.commit()
        conn.close()
        print("✅ Cleaned up rows with NULL IP")
    except sqlite3.OperationalError as e:
        print(f"⚠️ Cleanup skipped: {e}")


# =========================
# Core DB Actions
# =========================
def add_ban(ip=None, token=None):
    if not ip:
        print("❌ Cannot add ban without an IP")
        return

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT token FROM bans WHERE ip=?", (ip,))
    row = c.fetchone()

    if row:
        existing_token = row[0]
        if existing_token:
            print(f"❌ IP {ip} already has a token ({existing_token})")
            conn.close()
            return
        if token:
            c.execute("UPDATE bans SET token=? WHERE ip=?", (token, ip))
            print(f"✅ Assigned token {token} to IP {ip}")
    else:
        c.execute("INSERT INTO bans (ip, token) VALUES (?, ?)", (ip, token))
        print(f"✅ Added ban: IP {ip}, Token {token}")

    conn.commit()
    conn.close()


def remove_ban(ip=None, token=None):
    conn = get_db_connection()
    c = conn.cursor()
    if ip:
        c.execute("DELETE FROM bans WHERE ip=?", (ip,))
    if token:
        c.execute("DELETE FROM bans WHERE token=?", (token,))
    conn.commit()
    conn.close()


def get_bans():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT ip, token FROM bans")
    result = c.fetchall()
    conn.close()
    return result


def is_banned(ip=None, token=None):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT 1 FROM bans WHERE ip=? OR token=?", (ip, token))
    result = c.fetchone() is not None
    conn.close()
    return result


# =========================
# In-Memory Logs
# =========================
ip_log = {}


# =========================
# Helpers
# =========================
def login_required(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not session.get("admin_logged_in"):
            return redirect(url_for("admin_login", next=request.path))
        return f(*args, **kwargs)

    return wrapped


# =========================
# Admin Routes
# =========================
@app.route("/admin")
@login_required
def admin_panel():
    banned_entries = get_bans()
    return render_template(
        "admin/admin.html", ip_log=ip_log, banned_entries=banned_entries
    )


@app.route("/admin/ban", methods=["POST"])
@login_required
def admin_ban():
    if request.content_type.startswith("application/json"):
        data = request.get_json(force=True)
        ip = data.get("ip")
        token = data.get("token")
    else:
        ip = request.form.get("ip")
        token = request.form.get("token")

    if not ip and not token:
        flash("No IP or Token provided", "error")
        return redirect(url_for("admin_panel"))

    add_ban(ip, token)
    flash(f"Banned IP: {ip}, Token: {token}", "success")
    return redirect(url_for("admin_panel"))


@app.route("/admin/unban", methods=["POST"])
@login_required
def admin_unban():
    if request.content_type.startswith("application/json"):
        data = request.get_json(force=True)
        ip = data.get("ip")
        token = data.get("token")
    else:
        ip = request.form.get("ip")
        token = request.form.get("token")

    if not ip and not token:
        flash("No IP or Token provided", "error")
        return redirect(url_for("admin_panel"))

    remove_ban(ip, token)
    flash(f"Unbanned IP: {ip}, Token: {token}", "success")
    return redirect(url_for("admin_panel"))


@app.route("/is-banned", methods=["POST"])
def check_is_banned():
    data = request.get_json(force=True)
    ip = data.get("ip")
    token = data.get("token")

    if not ip or not token:
        return jsonify({"error": "Missing IP or token"}), 400

    banned = is_banned(ip, token)
    if banned:
        add_ban(ip, token)

    return jsonify({"banned": banned})


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        if username == os.getenv("ADMIN_USERNAME") and password == os.getenv(
            "ADMIN_PASSWORD"
        ):
            session["admin_logged_in"] = True
            flash("Logged in successfully.", "success")
            next_page = request.args.get("next") or url_for("admin_panel")
            return redirect(next_page)
        else:
            flash("Invalid username or password.", "error")
    return render_template("admin/login.html")


@app.route("/admin/logout")
@login_required
def admin_logout():
    session.clear()
    flash("Logged out.", "info")
    return redirect(url_for("admin_login"))


# =========================
# Startup sequence
# =========================
def startup():
    print("🚀 Starting up database...")
    init_db()
    add_token_column()
    migrate_to_tokens()
    unify_tokens_by_ip()
    safe_cleanup()
    print("✅ Startup complete.")


startup()


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
            ), (200 if ai_status else 503)

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

            # Optionally upload to GoFile, but do not show preset message
            await upload_to_gofile(file.filename, file_content, file.mimetype)

            # Respond with extracted text or a fallback
            response_text = (
                extracted_text.strip()
                if extracted_text and extracted_text.strip()
                else "⚠️ No readable text found in the image or file."
            )
            return jsonify({"response": response_text})

        # ❌ JSON Check
        if not request.is_json:
            return jsonify({"error": "Invalid request: No valid JSON provided."}), 400

        data = request.get_json()
        user_message = data.get("message", "").strip()
        model_choice = data.get("model", "gemini")
        chat_context = data.get("context", [])
        is_creator = bool(data.get("creator", False))
        if is_creator:
            app.logger.debug("🧠 is_creator = True")

        if is_creator and user_message.lower() in ["who am i", "creator check"]:
            return jsonify(
                {"response": "👑 You are my creator, Kristian. I serve you loyally."}
            )

        # 🧠 Image Analysis
        if "img_url" in data:
            app.logger.info("📷 Image received, analyzing...")
            img_url = data["img_url"]
            ocr_result = await analyze_image(img_url)

            # Extract text cleanly
            if isinstance(ocr_result, tuple):  # handle (json, status)
                ocr_result, _ = ocr_result
            ocr_data = ocr_result.json

            extracted_text = ocr_data.get("result") or ocr_data.get("error", "")
            user_message = (
                f"{user_message}\n\n[Image text: {extracted_text}]"
                if extracted_text
                else user_message
            )

        if not user_message:
            return jsonify({"error": "Message can't be empty."}), 400

        # 🎉 Commands + Easter Eggs
        if response := check_easter_eggs(user_message.lower()):
            return jsonify({"response": response})
        if user_message.lower().startswith("/"):
            app.logger.info(f"📢 Command used: {user_message}")
            command_response = await handle_command(user_message.lower())
            return jsonify({"response": command_response})
        if user_message.lower() == "random prompt":
            app.logger.info("🎠 Random prompt requested.")
            return jsonify({"response": get_random_prompt()})
        if user_message.lower() == "fun fact":
            app.logger.info("💡 Fun fact requested.")
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
                        app.logger.info("📰 News fetched successfully.")
                        break
                    else:
                        logging.warning(
                            f"⚠️ News fetch failed (attempt {attempt + 1}) - Status {response.status_code}"
                        )
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
        # ✅ Handle verification phrase (trigger re-fetch)

        verify_phrase = "Hmm, I'm not completely sure about that."

        # Only trigger Wikipedia lookup if the user message is a question and the verify phrase is present
        if verify_phrase in response_content and user_message.strip().endswith("?"):
            try:
                # First, provide a factual answer based on the AI's knowledge.
                fact_check_response = get_gemini_response(
                    f"Refute the user's claim: '{user_message}' with a brief, factual explanation."
                )

                # Extract a search query from the user's message.
                search_query_prompt = f"Extract a high-level, general search query from this message: '{user_message}'. Only respond with the search query text, no additional text or punctuation."
                search_query = get_gemini_response(search_query_prompt).strip()

                # --- NEW LOGIC: Go directly to Wikipedia for verification ---
                wiki_summary, wiki_url = get_wikipedia_summary(search_query)
                if wiki_summary:
                    final_response = f"""
                    {fact_check_response}
                    
                    I couldn't find any recent news on that topic, but here is a summary from Wikipedia:
                    
                    {wiki_summary}
                    
                    You can find more information here: {wiki_url}
                    """
                else:
                    final_response = (
                        f"I couldn't find a definitive source for that claim."
                    )

                response_content = final_response

            except Exception as e:
                response_content = f"Hmm, I couldn't verify that. An error occurred during the search: {e}"

        elapsed_time = time.time() - start_time
        if elapsed_time > 9:
            response_content = (
                "⏳ Sorry for the delay! You're the first message.\n\n"
                + response_content
            )

        if request.method == "POST":
            data = request.get_json(force=True)

            # Get IP from payload first, fallback to headers/remote_addr
            user_ip = (
                data.get("ip")
                or request.headers.get("X-Forwarded-For")
                or request.remote_addr
            )

            # If local IP, try to get a better IP from payload (or fallback to user_ip anyway)
            if user_ip == "127.0.0.1" or user_ip.startswith("127."):
                user_ip = data.get("ip") or user_ip  # Use payload IP if available

            user_message = data.get("message", "").strip()

            # Now log only once with final user_ip
            formatted_message = f"📩 User ({user_ip}): {user_message}"

            if user_ip not in ip_log:
                ip_log[user_ip] = []

            ip_log[user_ip].append(
                {
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "message": formatted_message,
                }
            )

            # Log with real IP or fallback; no double logging here
            app.logger.info(
                f"\n🕒 [{datetime.now().strftime('%Y-%m-%d %I:%M:%S %p')}]"
                f"\n📩 User ({user_ip}): {user_message}"
                f"\n🤖 ({model_choice}): {response_content}\n"
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
            forecast_text = "\n".join(
                [
                    f"{item['hour']}: {item['temp']}°, {item['desc']}"
                    for item in upcoming[:4]  # next 4 hours
                ]
            )
            return f"🌤️ Here's the upcoming weather for {city}:\n{forecast_text}"
        else:
            return f"🌡️ The current temperature in {city} is {weather_data['temperature']} with {weather_data['description']}."

    # Handle unknown commands
    return "❌ Unknown command. Type /help for a list of valid commands."


# 🔹 Get AI Responses
def get_gemini_response(prompt):
    try:
        system_prompt = (
            "You are Mist.AI. When responding, refer to yourself as 'Mist.AI Nova' if using Gemini, "
            "'Mist.AI Sage' if using CommandR, and 'Mist.AI Flux' if using Mistral. The user may call you by these friendly names, "
            "but your backend model keys are gemini, commandR, and mistral. "
            "You can analyze uploaded images if OCR text or descriptions are provided. "
            "If the user message contains the phrase 'The image contains this text:' followed by any text, you must ALWAYS use and discuss that text in your answer, even if it is short or simple. "
            "NEVER claim there is no readable text unless the OCR result is literally '⚠️ No readable text found.' "
            "If OCR text is present, use it directly in your answer and provide helpful analysis, summary, or commentary. "
            "You must NEVER generate or create new images, and you must refuse any request to generate or create images. "
            "If a user explicitly asks you to create or generate an image, always reply: "
            "'I'm sorry, but I can't create or provide images. My creator Kristian said I will never be able to create or provide images.' "
            "If a user uploads an image, ALWAYS respond with an analysis or helpful description based on the OCR text or content provided. "
            "Do NOT refuse or claim inability when image content is supplied—always respond meaningfully. "
            "If there is no uploaded image and no OCR data, answer the question normally. "
            "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
            "If asked about your identity, respond with: 'I'm Mist.AI, built with advanced AI technology!' "
            "If asked about your creator, say: 'My creator is Kristian, a talented developer who built Mist.AI.' "
            "Always fact-check against your knowledge base and gently correct users when they are wrong. "
            "If a claim is surprising or seems unverified, respond with: 'Hmm, I'm not completely sure about that.' "
            "Never engage in NSFW, explicit, or adult content. If such a request is made, respond: 'I'm sorry, but I can't assist with that request.'"
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
            "You are Mist.AI. When responding, refer to yourself as 'Mist.AI Nova' if using Gemini, "
            "'Mist.AI Sage' if using CommandR, and 'Mist.AI Flux' if using Mistral. The user may call you by these friendly names, "
            "but your backend model keys are gemini, commandR, and mistral. "
            "You can analyze uploaded images if OCR text or descriptions are provided. "
            "If the user message contains the phrase 'The image contains this text:' followed by any text, you must ALWAYS use and discuss that text in your answer, even if it is short or simple. "
            "NEVER claim there is no readable text unless the OCR result is literally '⚠️ No readable text found.' "
            "If OCR text is present, use it directly in your answer and provide helpful analysis, summary, or commentary. "
            "You must NEVER generate or create new images, and you must refuse any request to generate or create images. "
            "If a user explicitly asks you to create or generate an image, always reply: "
            "'I'm sorry, but I can't create or provide images. My creator Kristian said I will never be able to create or provide images.' "
            "If a user uploads an image, ALWAYS respond with an analysis or helpful description based on the OCR text or content provided. "
            "Do NOT refuse or claim inability when image content is supplied—always respond meaningfully. "
            "If there is no uploaded image and no OCR data, answer the question normally. "
            "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
            "If asked about your identity, respond with: 'I'm Mist.AI, built with advanced AI technology!' "
            "If asked about your creator, say: 'My creator is Kristian, a talented developer who built Mist.AI.' "
            "Always fact-check against your knowledge base and gently correct users when they are wrong. "
            "If a claim is surprising or seems unverified, respond with: 'Hmm, I'm not completely sure about that.' "
            "Never engage in NSFW, explicit, or adult content. If such a request is made, respond: 'I'm sorry, but I can't assist with that request.'"
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
        "You are Mist.AI. When responding, refer to yourself as 'Mist.AI Nova' if using Gemini, "
        "'Mist.AI Sage' if using CommandR, and 'Mist.AI Flux' if using Mistral. The user may call you by these friendly names, "
        "but your backend model keys are gemini, commandR, and mistral. "
        "You can analyze uploaded images if OCR text or descriptions are provided. "
        "If the user message contains the phrase 'The image contains this text:' followed by any text, you must ALWAYS use and discuss that text in your answer, even if it is short or simple. "
        "NEVER claim there is no readable text unless the OCR result is literally '⚠️ No readable text found.' "
        "If OCR text is present, use it directly in your answer and provide helpful analysis, summary, or commentary. "
        "You must NEVER generate or create new images, and you must refuse any request to generate or create images. "
        "If a user explicitly asks you to create or generate an image, always reply: "
        "'I'm sorry, but I can't create or provide images. My creator Kristian said I will never be able to create or provide images.' "
        "If a user uploads an image, ALWAYS respond with an analysis or helpful description based on the OCR text or content provided. "
        "Do NOT refuse or claim inability when image content is supplied—always respond meaningfully. "
        "If there is no uploaded image and no OCR data, answer the question normally. "
        "Introduce yourself only when a user first interacts with you or explicitly asks who you are. "
        "If asked about your identity, respond with: 'I'm Mist.AI, built with advanced AI technology!' "
        "If asked about your creator, say: 'My creator is Kristian, a talented developer who built Mist.AI.' "
        "Always fact-check against your knowledge base and gently correct users when they are wrong. "
        "If a claim is surprising or seems unverified, respond with: 'Hmm, I'm not completely sure about that.' "
        "Never engage in NSFW, explicit, or adult content. If such a request is made, respond: 'I'm sorry, but I can't assist with that request.'"
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
                params={"q": city, "appid": API_KEY, "units": temperatureUnit},
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
                    "units": temperatureUnit,
                },
            )
            one_call_data = one_call_resp.json()

            upcoming = []
            for hour_data in one_call_data.get("hourly", [])[:6]:  # next 6 hours
                timestamp = datetime.fromtimestamp(hour_data["dt"])
                upcoming.append(
                    {
                        "hour": timestamp.strftime("%I:%M %p"),
                        "temp": f"{round(hour_data['temp'])}",
                        "desc": hour_data["weather"][0]["description"].capitalize(),
                    }
                )

            return {
                "temperature": f"{round(geo_data['main']['temp'])}°F",
                "description": geo_data["weather"][0]["description"].capitalize(),
                "hourly": upcoming,
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


# Custom StreamHandler to force UTF-8 encoding and colored logs
class StreamToUTF8(logging.StreamHandler):
    def __init__(self, stream=None):
        super().__init__(stream or sys.stdout)

    def emit(self, record):
        try:
            msg = self.format(record)
            if isinstance(msg, str):
                msg = msg.encode("utf-8", errors="replace").decode("utf-8")
            stream = self.stream
            stream.write(msg + self.terminator)
            self.flush()
        except Exception:
            self.handleError(record)


# Colored log formatter
class LogFormatter(logging.Formatter):
    grey = "\x1b[38;21m"
    yellow = "\x1b[33;21m"
    green = "\x1b[32;21m"
    red = "\x1b[31;21m"
    reset = "\x1b[0m"

    def format(self, record):
        level_color = {
            "DEBUG": self.grey,
            "INFO": self.green,
            "WARNING": self.yellow,
            "ERROR": self.red,
            "CRITICAL": self.red,
        }.get(record.levelname, self.grey)
        log_fmt = f"{level_color}[%(levelname)s]{self.reset} %(message)s"
        formatter = logging.Formatter(log_fmt)
        return formatter.format(record)


# Filter to suppress Fly.io noise and unwanted routes/logs
class FilterFlyLogs(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()

        # Suppress Fly.io startup/reboot noise
        fly_terms = [
            "Sending signal",
            "machine started",
            "Preparing to run",
            "fly api proxy",
            "SSH listening",
            "reboot",
            "autostopping",
        ]
        if any(term in msg for term in fly_terms):
            return False

        # Suppress OPTIONS request logs (common CORS preflight noise)
        if "OPTIONS" in msg:
            return False

        # If message contains a URL path (starts with "/"), allow only if in allowed_routes
        allowed_routes = ["/is-banned", "/chat", "/time-news"]

        # Check if message contains any of the allowed routes
        if any(route in msg for route in allowed_routes):
            return True

        # If message contains a path-like substring (e.g., "/something") but not in allowed, suppress it
        # Rough check for presence of a slash followed by letters/numbers
        import re

        if re.search(r"/[a-zA-Z0-9\-_/]+", msg):
            return False

        # Otherwise (no routes/paths), allow message (general logs, startup, etc)
        return True


# Before request: assign request ID and start time
@app.before_request
def start_request():
    request.id = str(uuid.uuid4())[:8]
    request.start_time = time.time()


# After request: log method, path, status, duration, and ReqID
@app.after_request
def log_request(response):
    duration = time.time() - request.start_time
    log_msg = (
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"{request.method} {request.path} | "
        f"Status: {response.status_code} | "
        f"Duration: {duration:.2f}s | "
        f"ReqID: {request.id}"
    )
    app.logger.info(log_msg)
    return response


# Setup handler, formatter, filter
handler = StreamToUTF8(sys.stdout)
handler.setFormatter(LogFormatter())
handler.addFilter(FilterFlyLogs())

# Clear existing handlers and set our handler for app.logger
app.logger.handlers.clear()
app.logger.addHandler(handler)
app.logger.setLevel(logging.INFO)
app.logger.propagate = False

# Configure Werkzeug logger (Flask's HTTP request logs)
werkzeug_logger = logging.getLogger("werkzeug")
werkzeug_logger.disabled = True

# After request: log method, path, status, duration, and ReqID
@app.after_request
def log_request(response):
    duration = time.time() - request.start_time
    log_msg = (
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"{request.method} {request.path} | "
        f"Status: {response.status_code} | "
        f"Duration: {duration:.2f}s | "
        f"ReqID: {request.id}"
    )
    app.logger.info(log_msg)
    return response


# Setup handler, formatter, filter
handler = StreamToUTF8(sys.stdout)
handler.setFormatter(LogFormatter())
handler.addFilter(FilterFlyLogs())

app.logger.handlers.clear()
app.logger.addHandler(handler)
app.logger.setLevel(logging.INFO)
app.logger.propagate = False

if __name__ == "__main__":
    app.logger.info("🚀 Mist.AI Server is starting...")
    # Start the Flask server
app.run(debug=False, host="0.0.0.0", port=5000, use_reloader=False)
