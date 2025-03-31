# Use a lightweight Python image for version 3.13
FROM python:3.13-slim

# Install system dependencies required for PyAudio
RUN apt-get update && apt-get install -y \
    build-essential \
    libportaudio2 \
    libsndfile1 \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy only the requirements file first (improves caching)
COPY requirements.txt .

# Install dependencies (using --no-cache-dir for efficiency)
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application files
COPY . .

# Expose the Fly.io default port
EXPOSE 8080

# Set environment variables
ENV PORT=8080 FLASK_APP=app.py FLASK_ENV=production

# Use Gunicorn for a production-ready server
CMD ["python", "wsgi.py"]
