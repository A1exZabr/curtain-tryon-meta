FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY web ./web
USER node
EXPOSE 8080
CMD ["npx", "tsx", "web/server.ts"]
