FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install && npx expo install --fix && npm install

COPY . .

EXPOSE 19000 19001 19006

CMD ["npm", "run", "web", "--", "--host", "0.0.0.0", "--port", "19006"]
