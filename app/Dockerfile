FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
