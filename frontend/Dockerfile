FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

ENV HOSTNAME=0.0.0.0
CMD ["npm", "run", "start"]
