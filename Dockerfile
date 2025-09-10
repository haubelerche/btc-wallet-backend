FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm i --production=false
COPY . .
EXPOSE 8080
CMD ["npm","start"]
