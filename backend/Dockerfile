FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build
ENV NODE_ENV=production
# shortcut: dev dependencies stay in the image (drizzle-kit, tsx for `npm run seed`); slim it before real deploys.
CMD ["node", "dist/index.js"]
