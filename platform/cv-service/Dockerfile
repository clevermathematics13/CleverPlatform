FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY cv-service/requirements.txt /app/cv-service/requirements.txt
RUN pip install --no-cache-dir -r /app/cv-service/requirements.txt

COPY scripts /app/scripts
COPY cv-service/main.py /app/cv-service/main.py

WORKDIR /app/cv-service

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
