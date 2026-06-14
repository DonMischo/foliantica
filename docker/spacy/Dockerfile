FROM python:3.12-slim

RUN pip install --no-cache-dir fastapi uvicorn "spacy==3.8.*"
RUN python -m spacy download en_core_web_sm

WORKDIR /app
COPY server.py .

EXPOSE 8083
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8083"]
