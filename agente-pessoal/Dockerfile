FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production TZ=America/Sao_Paulo
VOLUME /app/data
EXPOSE 3000
CMD ["node", "src/server.js"]
