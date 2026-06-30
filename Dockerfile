FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV HEADLESS=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
