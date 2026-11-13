# Production image: builds the PWA and runs the Node API that also serves it.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm i --no-save tsx@4 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts/seed-demo-lib.ts ./scripts/seed-demo-lib.ts
COPY supabase ./supabase
EXPOSE 8080
CMD ["npx", "tsx", "server/node.ts"]
