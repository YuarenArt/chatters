BINARY_NAME=chatters-server
MAIN=cmd/server/main.go
LOGS=logs/*.log

# Default values for load testing
USERS?=2000
SPAWN_RATE?=25
HOST?=http://localhost:8080
RUN_TIME?=3m


.PHONY: all build run clean swagger web test test-cover test-race loadtest

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

loadtest:
	python -m locust -f loadtest/loadtest.py --users $(USERS) --spawn-rate $(SPAWN_RATE) --host $(HOST) --run-time $(RUN_TIME) --web-port 8090