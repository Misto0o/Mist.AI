# Use a lightweight Python image
FROM python:3.13-slim

# Set the working directory inside the container
WORKDIR /app

# Copy only the requirements file first (improves caching)
COPY requirements.txt .

# Install system dependencies, including build essentials and portaudio
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    gcc \
    libasound2-dev \
    libsndfile1 \
    libportaudio2 \
    libportaudio-dev

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

RUN pip3 install --no-cache-dir PyAudio==0.2.11

# Copy the rest of the application files
COPY . .

# Expose the Fly.io default port
EXPOSE 8080

# Set environment variables
ENV PORT=8080 FLASK_APP=mistai.py FLASK_ENV=production

# Use Gunicorn for a production-ready server
CMD ["python", "wsgi.py"]
