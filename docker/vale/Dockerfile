FROM jdkato/vale:latest AS vale

FROM python:3.12-slim

COPY --from=vale /bin/vale /usr/local/bin/vale

RUN pip install --no-cache-dir fastapi uvicorn

WORKDIR /app
COPY main.py .
COPY default.ini .

EXPOSE 8085
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8085"]
