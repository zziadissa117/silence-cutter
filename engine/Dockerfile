# The Cutter's engine on Railway: Python, ffmpeg (with zimg for the iPhone HDR
# tone-map, freetype for text), and Le plateau's files. Data lives on the
# Railway volume mounted at /data.
FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY plateau ./plateau
COPY engine ./engine

ENV ENGINE_DATA=/data PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "-m", "engine.server"]
