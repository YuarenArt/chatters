BINARY_NAME=chatters-server
MAIN=cmd/server/main.go
LOGS=logs/*.log

.PHONY: all build run clean swagger web test test-cover test-race

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

test:
	go test ./...

test-cover:
	go test -cover ./...

test-race:
	go test -race ./... 