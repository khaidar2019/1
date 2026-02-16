FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "start"]
