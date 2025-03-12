from mistai import app  # Import your Flask app

# Gunicorn/AlwaysData looks for a variable named "application"
application = app  # Rename "app" to "application" for WSGI compatibility

if __name__ == "__main__":
    application.run()
