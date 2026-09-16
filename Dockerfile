FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY gembridge/ ./gembridge/
COPY config.example.json ./config.json
EXPOSE 8081

CMD ["python", "-m", "gembridge", "--config", "/app/config.json"]
