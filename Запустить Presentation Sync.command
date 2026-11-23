#!/bin/zsh
# Двойной клик по этому файлу в Finder запускает Presentation Sync.

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "Не найден Node.js" message "Установите Node.js LTS с nodejs.org, затем снова откройте этот ярлык." as critical'
  exit 1
fi

if [[ ! -x "node_modules/.bin/electron" ]]; then
  echo "Первый запуск: устанавливаю компоненты Presentation Sync…"
  npm install
fi

echo "Запускаю Presentation Sync…"
npm start
