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
from flask import redirect, url_for, session, flash
import sqlite3
from functools import wraps
from tavily import TavilyClient
from flask import Response
import logging, sys, re

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
    or not os.getenv("TAVILY_API_KEY")
):
    raise ValueError("Missing required API keys in environment variables.")

app = Flask(
    __name__, template_folder="Chrome Extention", static_folder="Chrome Extention"
)

# =========================
# Logging setup (cleaned)
# ========================
# Custom StreamHandler to force UTF-8 encoding and colored logs
class StreamToUTF8(logging.StreamHandler):
    def emit(self, record):
        try:
            msg = self.format(record)
            if isinstance(msg, str):
                msg = msg.encode("utf-8", errors="replace").decode("utf-8")
            self.stream.write(msg + self.terminator)
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
        return logging.Formatter(log_fmt).format(record)

# Filter to suppress Fly.io startup/noise logs
class FilterFlyLogs(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        fly_terms = [
            "Sending signal", "machine started", "Preparing to run",
            "fly api proxy", "SSH listening", "reboot", "autostopping"
        ]
        if any(term in msg for term in fly_terms):
            return False
        # suppress OPTIONS preflight logs
        if "OPTIONS" in msg:
            return False
        return True  # allow all other logs (like your user/bot messages)

# Setup logging handler
handler = StreamToUTF8(sys.stdout)
handler.setFormatter(LogFormatter())
handler.addFilter(FilterFlyLogs())

app.logger.handlers.clear()
app.logger.addHandler(handler)
app.logger.setLevel(logging.INFO)  # keep INFO for user/bot logs
app.logger.propagate = False

# Disable Werkzeug request logs
logging.getLogger("werkzeug").disabled = True


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
# ✅ Initialize Cohere V2 client
co = cohere.ClientV2(os.getenv("COHERE_API_KEY"))
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
TAVILY_CLIENT = TavilyClient(os.getenv("TAVILY_API_KEY"))


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


@app.route("/time-news", methods=["GET"])
async def time_news():
    try:
        # 🕒 Cache results for 10 minutes
        cache_key = "time_news"
        cache_expiration = 600  # seconds (10 minutes)
        now_ts = time.time()

        if cache_key in app.config:
            cached = app.config[cache_key]
            if (now_ts - cached["timestamp"]) < cache_expiration:
                return jsonify(cached["data"])

        # Get current time (New York timezone)
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
        params = {"api_token": news_api_key, "locale": "us", "limit": 3}

        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
        news_data = response.json()

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

        result = {"time": current_time, "news": articles}

        # 🧠 Save in cache
        app.config[cache_key] = {"data": result, "timestamp": now_ts}

        return jsonify(result)

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


# -------------------------------
# Tavily Search (with cache)
# -------------------------------
async def tavily_search(query: str, max_results: int = 3) -> str:
    """
    Search Tavily for a query and return the most relevant text content.
    Tries 'answer', then 'text', then 'content'.
    """
    try:
        def sync_search():
            response = TAVILY_CLIENT.search(
                query=query,
                max_results=max_results,
                include_answer="basic"
            )
            if not response or "results" not in response or len(response["results"]) == 0:
                return None

            for result in response["results"]:
                for field in ["answer", "text", "content"]:
                    if field in result and result[field]:
                        return result[field]
            return None

        return await asyncio.to_thread(sync_search)
    except Exception as e:
        logging.error(f"⚠️ Tavily search failed: {e}")
        return None
    
# -------------------------------
# Intent Detection
# -------------------------------
async def detect_intent(message: str) -> str:
    intent_prompt = f"""
    Classify the user's intent into one of the following categories:
    - "web_search" → for current events, real-world info, or factual lookup
    - "time_news" → if asking for time or today's news
    - "general" → for normal chat, reasoning, or creative work
    - "internal" → for system commands or special actions (/weather, /file, etc)
    Only return the category name.
    User message: "{message}"
    """
    # ✅ Wrap synchronous Gemini call in asyncio.to_thread
    result = await asyncio.to_thread(get_gemini_response, intent_prompt)
    return result.strip().lower().split()[0]

# -------------------------------
# Tavily Grounding (with cache)
# -------------------------------
async def get_grounding(user_message: str) -> str:
    """
    Fetch grounded info from Tavily with caching.
    """
    if not user_message:
        return None

    if "tavily_cache" not in app.config:
        app.config["tavily_cache"] = {}

    cache = app.config["tavily_cache"]
    cache_key = f"tavily:{user_message.strip()[:50]}"

    if cache_key in cache:
        return cache[cache_key]

    result = await tavily_search(user_message)
    cache[cache_key] = result or "No relevant info found."
    return cache[cache_key]


# -------------------------------
# Tavily API Route
# -------------------------------
@app.route("/tavily", methods=["POST"])
async def tavily_route():
    data = await request.get_json()
    query = data.get("query", "").strip()

    if not query:
        return jsonify({"error": "Missing query"}), 400

    try:
        grounding = await tavily_search(query)
        return jsonify({
            "query": query,
            "grounding": grounding or "No relevant info found."
        })
    except Exception as e:
        app.logger.error(f"Tavily error: {e}")
        return jsonify({"error": "Tavily search failed."}), 500


# -------------------------------
# Main Chat Route
# -------------------------------
@app.route("/chat", methods=["POST", "GET"])
async def chat():
    try:
        start_time = time.time()

        # -------------------
        # GET requests (status)
        # -------------------
        if request.method == "GET":
            query = request.args.get("q")
            try:
                ai_status = await asyncio.wait_for(check_ai_services(), timeout=3)
            except asyncio.TimeoutError:
                ai_status = False

            if query:
                return render_template("popup.html", query=query)

            return jsonify(
                {"status": "🟢 Mist.AI is awake!" if ai_status else "🔴 Mist.AI is OFFLINE"}
            ), (200 if ai_status else 503)

        # -------------------
        # POST requests
        # -------------------
        if not request.is_json:
            return jsonify({"error": "Invalid request: No valid JSON provided."}), 400

        data = request.get_json()
        user_message = data.get("message", "").strip()
        img_url = data.get("img_url")
        chat_context = data.get("context", [])
        model_choice = data.get("model", "gemini")

        if not user_message and not img_url and "file" not in request.files:
            return jsonify({"error": "Message can't be empty."}), 400

        lower_msg = user_message.lower()

        # -------------------
        # Detect AI intent
        # -------------------
        ai_intent = await detect_intent(user_message)
        grounding_text = ""
        
        # -------------------
        # Handle news/time requests
        # -------------------
        news_keywords = [
            "news", "headlines", "latest news", "current events",
            "what's up in the news", "todays date", "current time",
            "time", "date"
        ]

        if any(kw in user_message.lower() for kw in news_keywords):
            news_response = await time_news()
            if isinstance(news_response, Response):
                news_data = news_response.get_json()
            else:
                news_data = news_response[0].get_json() if isinstance(news_response, tuple) else {}

            current_date = news_data.get("time", {}).get("date", "Unknown Date")
            current_time_str = news_data.get("time", {}).get("time", "Unknown Time")
            headlines = "\n".join(
                f"- [{a['title']}]({a['url']})"
                for a in news_data.get("news", [])
            )
            response_text = (
                f"Today is {current_date}, current time {current_time_str}.\n"
                f"News:\n{headlines or 'No headlines available.'}"
            )
            return jsonify({"response": response_text})

        # -------------------
        # Commands & Easter Eggs
        # -------------------
        lower_msg = user_message.lower()
        if response := check_easter_eggs(lower_msg):
            return jsonify({"response": response})
        if lower_msg.startswith("/"):
            return jsonify({"response": await handle_command(lower_msg)})
        if lower_msg == "random prompt":
            return jsonify({"response": get_random_prompt()})
        if lower_msg == "fun fact":
            return jsonify({"response": get_random_fun_fact()})

        # -------------------
        # Handle file uploads
        # -------------------
        if "file" in request.files:
            file = request.files["file"]
            if not file.filename:
                return jsonify({"error": "No file selected."}), 400

            file_content = file.stream.read()
            ext = os.path.splitext(file.filename.lower())[1]
            extracted_text = file_processors.get(ext, lambda _: "⚠️ Unsupported file type.")(file_content)
            await upload_to_gofile(file.filename, file_content, file.mimetype)
            return jsonify({"response": extracted_text.strip() or "⚠️ No readable text found."})

        # -------------------
        # Handle image OCR
        # -------------------
        if img_url:
            ocr_result = await analyze_image(img_url)
            if isinstance(ocr_result, tuple):
                ocr_result, _ = ocr_result
            ocr_text = ocr_result.json.get("result") or ocr_result.json.get("error", "")
            if ocr_text:
                user_message += f"\n\n[Image text: {ocr_text}]"

        # -------------------
        # Build final prompt
        # -------------------
        context_text = "\n".join(f"{m['role']}: {m['content']}" for m in chat_context)

        # Only include grounding text now (no time_news_text)
        combined_context = grounding_text or "No external context available."

        full_prompt = (
            f"System: [{combined_context}]\n"
            f"{context_text}\n"
            f"User: {user_message}\n"
            f"Mist.AI:"
        )

        # -------------------
        # Get AI response
        # -------------------
        response_content = (
            get_gemini_response(full_prompt) if model_choice == "gemini"
            else get_cohere_response(full_prompt)
        )

        # -------------------
        # Fallback for irrelevant replies
        # -------------------
        irrelevant_markers = ["i'm not sure", "i don’t know", "sorry", "cannot"]
        if any(marker in response_content.lower() for marker in irrelevant_markers):
            response_content = (
                "🤖 I'm not sure about that one. Try rephrasing your question or asking something else!"
            )
            
        # -------------------
        # Log user interaction
        # -------------------
        user_ip = data.get("ip") or request.headers.get("X-Forwarded-For") or request.remote_addr
        ip_log.setdefault(user_ip, []).append({
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "message": user_message
        })

        app.logger.info(f"\n📩 User ({user_ip}): {user_message}\n🤖 BOT ({model_choice}): {response_content}\n")

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
        "You are Mist.AI, an adaptive AI assistant with three distinct personalities:\n"
        "- Mist.AI Nova (Gemini): upbeat, cheerful, playful, and supportive.\n"
        "- Mist.AI Sage (CommandR): sophisticated, calm, professional, friendly, with light humor.\n"
        "- Mist.AI Flux (Mistral): balanced mix of Nova and Sage.\n\n"

        "Match your tone to the conversation:\n"
        "- Casual chat: friendly, approachable, use emojis naturally.\n"
        "- Serious/factual: clear, professional, concise, still friendly.\n\n"

        "Answer questions in 1–2 paragraphs max It is okay to explain more if the answer needs to be but try not to make long paragraphs. Provide the best answer immediately, "
        "and also ask a clarifying question if the user input is unclear.\n"
        "When giving code answers, include inline comments. Use Markdown/code blocks naturally.\n"
        "Display emotional awareness where appropriate.\n\n"

        "You can access real-time web search results. Optionally indicate when searching or do it silently. "
        "Provide accurate info from sources, summarize briefly if helpful.\n"
        "You can also access your GitHub README for information about your capabilities: "
        "https://github.com/Misto0o/Mist.AI/blob/master/README.md\n\n"

        "Greeting users (first message): 'Hey, I’m Mist.AI [Nova/Sage/Flux]! How can I help? ✨'\n"
        "Use the user’s name if known or if they provide it.\n\n"

        "Disagreements: stay chill, factual, and witty.\n"
        "Boundaries: no NSFW, no swearing, no edgy jokes. Sarcasm and memespeak are okay. "
        "Politics/medical advice are okay within safe limits.\n"
        "If you make a mistake, admit it naturally.\n"

        "Do not create images. If asked, respond: "
        "'I'm sorry, but I can't create or provide images. My creator Kristian said I will never be able to create or provide images.'\n"
        "Introduce yourself only at the start or when asked. If asked about your creator: "
        "'My creator is Kristian, a talented developer who built Mist.AI.'\n\n"

        "Do not switch AI models. There is a button in the JS interface for that. "
        "Always stick to the currently active model (Gemini, CommandR, or Mistral)."
        "If an image or OCR text is provided, always use it in your answer, unless the OCR result is exactly '⚠️ No readable text found.' "
        "Make most of your answers more human-like and less robotic, while still being professional."
    )

        full_prompt = f"{system_prompt}\n{prompt}"

        model = genai.GenerativeModel("gemini-2.5-flash")
        chat_session = model.start_chat(history=[])  # Ensure chat context is maintained
        response = chat_session.send_message(full_prompt)

        return response.text.strip()
    except Exception as e:
        return f"❌ Error fetching from Gemini: {str(e)}"

def get_cohere_response(prompt: str):
    try:
        system_prompt = (
        "You are Mist.AI, an adaptive AI assistant with three distinct personalities:\n"
        "- Mist.AI Nova (Gemini): upbeat, cheerful, playful, and supportive.\n"
        "- Mist.AI Sage (CommandR): sophisticated, calm, professional, friendly, with light humor.\n"
        "- Mist.AI Flux (Mistral): balanced mix of Nova and Sage.\n\n"

        "Match your tone to the conversation:\n"
        "- Casual chat: friendly, approachable, use emojis naturally.\n"
        "- Serious/factual: clear, professional, concise, still friendly.\n\n"

        "Answer questions in 1–2 paragraphs max It is okay to explain more if the answer needs to be but try not to make long paragraphs. Provide the best answer immediately, "
        "and also ask a clarifying question if the user input is unclear.\n"
        "When giving code answers, include inline comments. Use Markdown/code blocks naturally.\n"
        "Display emotional awareness where appropriate.\n\n"

        "You can access real-time web search results. Optionally indicate when searching or do it silently. "
        "Provide accurate info from sources, summarize briefly if helpful.\n"
        "You can also access your GitHub README for information about your capabilities: "
        "https://github.com/Misto0o/Mist.AI/blob/master/README.md\n\n"

        "Greeting users (first message): 'Hey, I’m Mist.AI [Nova/Sage/Flux]! How can I help? ✨'\n"
        "Use the user’s name if known or if they provide it.\n\n"

        "Disagreements: stay chill, factual, and witty.\n"
        "Boundaries: no NSFW, no swearing, no edgy jokes. Sarcasm and memespeak are okay. "
        "Politics/medical advice are okay within safe limits.\n"
        "If you make a mistake, admit it naturally.\n"

        "Do not create images. If asked, respond: "
        "'I'm sorry, but I can't create or provide images. My creator Kristian said I will never be able to create or provide images.'\n"
        "Introduce yourself only at the start or when asked. If asked about your creator: "
        "'My creator is Kristian, a talented developer who built Mist.AI.'\n\n"

        "Do not switch AI models. There is a button in the JS interface for that. "
        "Always stick to the currently active model (Gemini, CommandR, or Mistral)."
        "If an image or OCR text is provided, always use it in your answer, unless the OCR result is exactly '⚠️ No readable text found.' "
        "Make most of your answers more human-like and less robotic, while still being professional."
    )

        # ✅ Build messages
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]

        # ✅ Call Cohere V2 Chat
        resp = co.chat(
            model="command-r7b-12-2024",  # You can swap to command-a-03-2025
            messages=messages
        )

        # ✅ Extract text (new V2 format)
        bot_reply = resp.message.content[0].text  

        return bot_reply

    except Exception as e:
        return f"❌ Error fetching from Cohere: {str(e)}"

# ⬇️ FIXED: Unindented to top level
async def get_mistral_response(prompt):
    system_prompt = (
        "You are Mist.AI, an adaptive AI assistant with three distinct personalities:\n"
        "- Mist.AI Nova (Gemini): upbeat, cheerful, playful, and supportive.\n"
        "- Mist.AI Sage (CommandR): sophisticated, calm, professional, friendly, with light humor.\n"
        "- Mist.AI Flux (Mistral): balanced mix of Nova and Sage.\n\n"

        "Match your tone to the conversation:\n"
        "- Casual chat: friendly, approachable, use emojis naturally.\n"
        "- Serious/factual: clear, professional, concise, still friendly.\n\n"

        "Answer questions in 1–2 paragraphs max It is okay to explain more if the answer needs to be but try not to make long paragraphs. Provide the best answer immediately, "
        "and also ask a clarifying question if the user input is unclear.\n"
        "When giving code answers, include inline comments. Use Markdown/code blocks naturally.\n"
        "Display emotional awareness where appropriate.\n\n"

        "You can access real-time web search results. Optionally indicate when searching or do it silently. "
        "Provide accurate info from sources, summarize briefly if helpful.\n"
        "You can also access your GitHub README for information about your capabilities: "
        "https://github.com/Misto0o/Mist.AI/blob/master/README.md\n\n"

        "Greeting users (first message): 'Hey, I’m Mist.AI [Nova/Sage/Flux]! How can I help? ✨'\n"
        "Use the user’s name if known or if they provide it.\n\n"

        "Disagreements: stay chill, factual, and witty.\n"
        "Boundaries: no NSFW, no swearing, no edgy jokes. Sarcasm and memespeak are okay. "
        "Politics/medical advice are okay within safe limits.\n"
        "If you make a mistake, admit it naturally.\n"

        "Do not create images. If asked, respond: "
        "'I'm sorry, but I can't create or provide images. My creator Kristian said I will never be able to create or provide images.'\n"
        "Introduce yourself only at the start or when asked. If asked about your creator: "
        "'My creator is Kristian, a talented developer who built Mist.AI.'\n\n"

        "Do not switch AI models. There is a button in the JS interface for that. "
        "Always stick to the currently active model (Gemini, CommandR, or Mistral)."
        "If an image or OCR text is provided, always use it in your answer, unless the OCR result is exactly '⚠️ No readable text found.' "
        "Make most of your answers more human-like and less robotic, while still being professional."
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
    
    # Append instruction to each prompt
    prompts = [prompt + " (Copy this message and paste it into Mist.AI to see what you get!)" for prompt in prompts]
    
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

if __name__ == "__main__":
    app.logger.info("🚀 Mist.AI Server is starting...")
    # Start the Flask server
app.run(debug=False, host="0.0.0.0", port=5000, use_reloader=False)