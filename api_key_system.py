# API Key & Rate Limiting System for Mist.AI (Supabase)

import os
import secrets
import time
from datetime import datetime
from functools import wraps
from flask import request, jsonify
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)


# Generates a unique API key with mistai_ prefix
def generate_api_key():
    return f"mistai_{secrets.token_hex(24)}"


def hash_api_key(api_key):
    import hashlib

    return hashlib.sha256(api_key.encode()).hexdigest()


# Fetches API key info from Supabase by key string
def get_api_key_info(api_key: str):
    try:
        res = (
            supabase_client.table("api_keys")
            .select("*")
            .eq("api_key", api_key)
            .single()
            .execute()
        )

        if not res.data:
            return None

        return res.data

    except Exception:
        return None


# Rate limiting per API key (30 requests per minute by default)
def check_rate_limit(api_key: str, limit_per_minute: int = 30):
    bucket = int(time.time() // 60)

    try:
        res = (
            supabase_client.table("rate_limits")
            .select("*")
            .eq("api_key", api_key)
            .eq("minute_bucket", bucket)
            .execute()
        )

        data = res.data
        current = data[0]["request_count"] if data else 0

        if current >= limit_per_minute:
            return False, current, limit_per_minute

        if data:
            supabase_client.table("rate_limits").update(
                {"request_count": current + 1}
            ).eq("api_key", api_key).eq("minute_bucket", bucket).execute()
        else:
            supabase_client.table("rate_limits").insert(
                {"api_key": api_key, "minute_bucket": bucket, "request_count": 1}
            ).execute()

        return True, current + 1, limit_per_minute

    except Exception as e:
        print("Rate limit error:", e)
        return True, 0, limit_per_minute  # fail open


# Logs API usage statistics and increments request count
def log_api_usage(api_key, model, message_len, response_len, status):
    try:
        # Insert usage log
        supabase_client.table("api_usage").insert(
            {
                "api_key": api_key,
                "model": model,
                "message_length": message_len,
                "response_length": response_len,
                "status_code": status,
            }
        ).execute()

        # Increment total request count for this key
        key_data = get_api_key_info(api_key)
        if key_data:
            supabase_client.table("api_keys").update(
                {
                    "requests_total": (key_data.get("requests_total", 0) + 1),
                    "last_used": datetime.utcnow().isoformat(),
                }
            ).eq("api_key", api_key).execute()

    except Exception as e:
        print("Usage log error:", e)


# Deactivates an API key to prevent further use
def revoke_api_key(api_key: str):
    try:
        supabase_client.table("api_keys").update({"is_active": False}).eq(
            "api_key", api_key
        ).execute()
        return True
    except Exception:
        return False


# Flask decorator to validate API key and enforce rate limits on protected routes
def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):

        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return (
                jsonify(
                    {
                        "error": "Missing Authorization header",
                        "example": "Authorization: Bearer mistai_xxxxx",
                    }
                ),
                401,
            )

        api_key = auth.replace("Bearer ", "").strip()

        key = get_api_key_info(api_key)

        if not key or not key.get("is_active"):
            return jsonify({"error": "Invalid or revoked API key"}), 403

        allowed, current, limit = check_rate_limit(api_key)

        if not allowed:
            return (
                jsonify(
                    {"error": "Rate limit exceeded", "current": current, "limit": limit}
                ),
                429,
            )

        request.api_key = api_key
        request.api_key_info = key

        return f(*args, **kwargs)

    return decorated


# Creates a new API key for a user
def create_api_key(name: str):
    api_key = generate_api_key()
    try:
        supabase_client.table("api_keys").insert(
            {
                "api_key": api_key,
                "name": name,
                "is_active": True,
                "requests_total": 0,
            }
        ).execute()
        return api_key, name
    except Exception as e:
        print("Create key error:", e)
        return None, str(e)


def list_api_keys():
    try:
        res = supabase_client.table("api_keys").select(
            "id, user_id, api_key, name, is_active, created_at, last_used, requests_total"
        ).execute()
        return res.data or []
    except Exception:
        return []