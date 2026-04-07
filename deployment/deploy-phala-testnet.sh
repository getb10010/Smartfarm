#!/bin/bash
# SmartFarmer v3 - Phala dstack Testnet Deployment ($0 Production)
# Этот скрипт собирает Docker образ ИИ-агента и разворачивает его
# в аппаратном анклаве (SGX) тестовой сети Phala Network.

echo "🌾 SmartFarmer v3 - Deploying to Phala dstack Testnet..."

# Проверка зависимостей
if ! command -v docker &> /dev/null; then
    echo "❌ Ошибка: Docker не установлен."
    exit 1
fi

if ! command -v dstack &> /dev/null; then
    echo "⚠️ dstack CLI не найден. Инструкция по установке: https://docs.phala.network/developers/dstack"
    echo "Для установки (Linux/Mac): curl -sL https://raw.githubusercontent.com/Phala-Network/dstack/main/install.sh | bash"
    exit 1
fi

# Настройки
IMAGE_NAME="smartfarmer-oracle"
IMAGE_TAG="v3-testnet"
DOCKER_REGISTRY="ghcr.io/your-username" # Замените на ваш реестр

cd "$(dirname "$0")/.."

echo "🔨 Шаг 1: Сборка Docker образа..."
docker build -t $IMAGE_NAME:$IMAGE_TAG -f deployment/Dockerfile.tee .

echo "🏷️ Шаг 2: Тегирование и публикация..."
# Требуется предварительный `docker login ghcr.io`
docker tag $IMAGE_NAME:$IMAGE_TAG $DOCKER_REGISTRY/$IMAGE_NAME:$IMAGE_TAG
docker push $DOCKER_REGISTRY/$IMAGE_NAME:$IMAGE_TAG

echo "🔐 Шаг 3: Развертывание в аппаратный анклав (Testnet)..."
cd deployment
dstack deploy -f docker-compose-dstack.yml --testnet

echo "✅ Деплой успешно инициирован!"
echo "Вы можете проверить статус оракула в Explorer: https://explorer.phala.network (Testnet tab)"
