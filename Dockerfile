# Build stage
FROM node:24-bookworm-slim AS build

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code
COPY server/src ./server/src
COPY server/tsconfig.json ./server/
COPY web/src ./web/src
COPY web/angular.json ./web/
COPY web/tsconfig.json ./web/
COPY web/tsconfig.app.json ./web/
COPY web/tsconfig.spec.json ./web/

# Build both server and web
RUN npm run build

# Runtime stage
FROM node:24-bookworm-slim

WORKDIR /app

# Copy package files from build stage
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/web/package.json ./web/

# Copy built artifacts from build stage
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist/web/browser ./web/dist/web/browser

# Install production dependencies only (server workspace + hoisted root)
RUN npm ci --omit=dev --workspace=server --include-workspace-root

# Set production environment
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
