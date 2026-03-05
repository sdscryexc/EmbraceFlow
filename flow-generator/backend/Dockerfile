FROM node:20-bookworm

# ffmpeg + fonts (drawtext needs freetype + an installed font)
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV FONTFILE=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf

EXPOSE 8080
CMD ["node", "server.js"]