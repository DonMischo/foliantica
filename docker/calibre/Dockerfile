FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    QT_QPA_PLATFORM=offscreen \
    XDG_RUNTIME_DIR=/tmp/xdg \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# wget + xz-utils needed by the official calibre installer
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/xdg

# Official self-contained calibre installer — ships its own Qt, Python, and libs,
# so it works reliably in headless containers without X11.
RUN wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sh /dev/stdin

RUN pip install --no-cache-dir fastapi uvicorn

WORKDIR /app
COPY main.py .

EXPOSE 8084
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8084"]
