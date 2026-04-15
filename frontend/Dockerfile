FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

ENV HOSTNAME=0.0.0.0
# docker-compose overrides this to `npm run dev` for local development.
# For a production image, re-add `RUN npm run build` above and keep this CMD.
CMD ["npm", "run", "start"]
