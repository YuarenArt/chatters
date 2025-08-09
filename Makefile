# Makefile для проекта chatters
# =============================
#
# Основные цели:
#   build   — сборка сервера
#   run     — запуск сервера
#   clean   — удаление бинарников и логов
#   swagger — генерация swagger-документации
#   mod     — обновление зависимостей
#   web     — запуск веб-интерфейса

BINARY_NAME=chatters-server
MAIN=cmd/server/main.go
LOGS=logs/*.log

.PHONY: all build run clean swagger mod web

all: build

build:
	go build -o $(BINARY_NAME) $(MAIN)

run: build
	./$(BINARY_NAME)

clean:
	rm -f $(BINARY_NAME)
	rm -f $(LOGS) || true

swagger:
	swag init -g $(MAIN) -o docs

mod:
	go mod tidy

web:
	@echo "Откройте web/index.html в браузере для доступа к веб-интерфейсу"
	@echo "Или используйте простой HTTP сервер:"
	@echo "cd web && python -m http.server 3000"
	@echo "Затем откройте http://localhost:3000" 