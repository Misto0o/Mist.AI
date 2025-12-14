from mistai import app
application = app

if __name__ == "__main__":
    # For production, use gunicorn instead of Flask's built-in server
    app.run(host='0.0.0.0', port=5000, debug=False)