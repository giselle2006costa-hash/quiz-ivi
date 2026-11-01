FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data
ENV NODE_ENV=production TZ=America/Sao_Paulo
EXPOSE 3000
CMD ["node", "src/server.js"]
