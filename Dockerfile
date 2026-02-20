FROM python:3.12-slim

WORKDIR /app

# System deps for PyMuPDF + PDF libs
RUN apt-get update && apt-get install -y \
    libglib2.0-0 libgl1 libxrender1 libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "wsgi.py"]