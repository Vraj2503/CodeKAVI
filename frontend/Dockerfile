# Next.js Frontend Dockerfile
FROM node:22-alpine AS base

WORKDIR /app

RUN addgroup -g 10001 -S appgroup && adduser -u 10001 -S appuser -G appgroup

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code. The build context is frontend/, so .dockerignore keeps the
# host's node_modules, .next and .env out.
COPY . .

# Next.js writes NEXT_PUBLIC_* into the bundle at build time, so they arrive as
# build args (docker-compose.yml passes them from the root .env). Both are public:
# the Supabase URL and anon key ship to every browser anyway.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
