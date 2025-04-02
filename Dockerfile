# Use a lightweight Python image
FROM python:3.13-slim

# Set the working directory inside the container
WORKDIR /app

# Copy only the requirements file first (improves caching)
COPY requirements.txt .

RUN apt-get update && apt-get install -y \
    build-essential \
    portaudio19-dev \
    python3-dev \
    gcc

# Install dependencies (using --no-cache-dir for efficiency)
RUN pip3 install --no-cache-dir -r requirements.txt
RUN pip3 install --no-cache-dir PyAudio==0.2.11

# Copy the rest of the application files
COPY . .

# Expose the Fly.io default port
EXPOSE 8080

# Set environment variables
ENV PORT=8080 FLASK_APP=app.py FLASK_ENV=production

# Use Gunicorn for a production-ready server
CMD ["python", "wsgi.py"]
