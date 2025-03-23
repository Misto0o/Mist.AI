from mistai import app  # Import your Flask app

# Gunicorn/AlwaysData looks for a variable named "application"
application = app  # Expose the "app" as "application" for WSGI compatibility
