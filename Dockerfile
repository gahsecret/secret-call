FROM node:22-alpine AS client-build
WORKDIR /app
COPY client/package*.json ./client/
RUN npm install --prefix client
COPY client ./client
RUN npm run build --prefix client

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY server/package*.json ./server/
RUN npm install --omit=dev --prefix server
COPY server ./server
COPY --from=client-build /app/client/dist ./client/dist
EXPOSE 3001
CMD ["npm", "start", "--prefix", "server"]
