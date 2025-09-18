# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk --no-cache add gcc musl-dev linux-headers

# Download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o chatters ./cmd/server

# Final stage
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies
RUN apk --no-cache add ca-certificates

# Copy binary from builder
COPY --from=builder /app/chatters .

# Copy static files and templates
COPY web/static ./web/static
COPY web/static/templates ./web/static/templates

# Expose ports
EXPOSE 8080 9090 2112

# Set environment variables
ENV GIN_MODE=release

# Command to run the application
CMD ["/app/chatters"]
