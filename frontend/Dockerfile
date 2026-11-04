# Next.js Frontend Dockerfile
FROM node:22-alpine AS base

WORKDIR /app

RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup

# Install dependencies
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy source code and the supplied mind-map template. The Compose build
# context is the repository root so the template remains part of the image.
COPY frontend/ .
COPY ["Mind Map.html", "./Mind Map.html"]

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
