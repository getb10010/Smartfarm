FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Копируем package files
COPY package*.json ./
COPY tsconfig.json ./

# Устанавливаем ВСЕ зависимости для сборки TypeScript
RUN npm install

# Копируем исходники агента
COPY src ./src

# Собираем TS код
RUN npm run build

# Продакшен образ
FROM node:20-alpine

WORKDIR /usr/src/app

# Файлы для запуска (скопированные из builder)
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/dist ./dist

# Устанавливаем только продакшн зависимости (оптимизация образа)
RUN npm ci --omit=dev

# TEE Envirnoment settings для Phala dStack
ENV NODE_ENV=production
ENV TEE_ENV=phala_tee
ENV ORACLE_SINGLE_RUN=false

# Запускаем автономный оракул
CMD ["node", "dist/index.js"]
