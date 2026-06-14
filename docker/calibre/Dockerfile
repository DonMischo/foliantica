FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    XDG_RUNTIME_DIR=/tmp/xdg \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       calibre \
       python3 \
       python3-pip \
       python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/xdg

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir fastapi uvicorn

WORKDIR /app
COPY main.py .

EXPOSE 8084

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8084"]
