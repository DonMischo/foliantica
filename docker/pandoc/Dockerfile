FROM pandoc/latex:3.10-ubuntu

# Install Python, font packages, and curl (for Google Font downloads)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    fontconfig \
    fonts-liberation \
    fonts-noto-core \
    fonts-open-sans \
    fonts-urw-base35 \
    curl \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Install FastAPI / uvicorn in a venv to avoid PEP 668 conflict
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir fastapi uvicorn python-docx

WORKDIR /app
COPY main.py .

# Run as non-root; the app needs write access to the Google-Fonts install dir
RUN useradd -m app \
    && mkdir -p /usr/local/share/fonts/gfonts \
    && chown -R app /usr/local/share/fonts/gfonts
USER app

EXPOSE 8082

# Reset ENTRYPOINT so CMD works as the actual command
ENTRYPOINT []
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8082"]