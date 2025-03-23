from mistai import app  # Import your Flask app

# Gunicorn/AlwaysData looks for a variable named "application"
application = app  # Expose the "app" as "application" for WSGI compatibility

if __name__ == "__main__":
    application.run(debug=False, host="0.0.0.0", port=5000, use_reloader=False)
