FROM node:22-alpine
# Build context is the repo root (see docker-compose.yml) so A's ABI in docs/ is available at runtime.
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json backend/drizzle.config.ts ./
COPY backend/src ./src
COPY backend/drizzle ./drizzle
COPY docs/escrow-abi.json /app/docs/escrow-abi.json
RUN npm run build
ENV NODE_ENV=production
# shortcut: dev dependencies stay in the image (drizzle-kit, tsx for `npm run seed`); slim it before real deploys.
CMD ["node", "dist/index.js"]
