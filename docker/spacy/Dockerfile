FROM python:3.12-slim

RUN pip install --no-cache-dir fastapi uvicorn "spacy==3.8.*"
# English uses the web model; other languages use news models (~12 MB each)
RUN python -m spacy download en_core_web_sm
RUN python -m spacy download de_core_news_sm
RUN python -m spacy download fr_core_news_sm
RUN python -m spacy download es_core_news_sm
RUN python -m spacy download it_core_news_sm
RUN python -m spacy download nl_core_news_sm
RUN python -m spacy download pt_core_news_sm

WORKDIR /app
COPY server.py .

RUN useradd -m app
USER app

EXPOSE 8083
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8083"]
