FROM jdkato/vale:latest AS vale

FROM python:3.12-alpine

COPY --from=vale /bin/vale /usr/local/bin/vale

RUN apk add --no-cache libstdc++ && \
    pip install --no-cache-dir fastapi uvicorn

WORKDIR /app

# Download community style packages at image build time.
# sync.ini lists write-good and proselint under Packages; vale sync fetches them.
COPY sync.ini .vale.ini
RUN mkdir -p styles && vale sync && rm .vale.ini

COPY main.py .
COPY default.ini .

EXPOSE 8085
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8085"]
