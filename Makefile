BINARY_NAME=chatters-server
MAIN=cmd/server/main.go
LOGS=logs/*.log
PROFILE_DIR=profiles
STRUCT_DIR=struct_reports
VERSION?=0.0.2

USERS?=2000
SPAWN_RATE?=25
HOST?=http://localhost:8080
RUN_TIME?=3m
PPROF_PORT?=6060

.PHONY: all build run run-profile clean clean-profiles clean-all swagger test test-cover test-race loadtest \
	struct-find struct-analyze struct-all clean-structs profile-capture profile-cpu profile-mem

# ----------------------------
# Build & Run
# ----------------------------
all: build

build:
	go build -o $(BINARY_NAME) -ldflags="-X main.version=$(VERSION)" $(MAIN)

run: build
	./$(BINARY_NAME)

run-profile: build
	mkdir -p $(PROFILE_DIR)
	@echo "Starting server with profiling enabled (version: $(VERSION))"
	@echo "Profiles will be saved to: $(PROFILE_DIR)"
	@echo "Access pprof web UI at: http://localhost:$(PPROF_PORT)/debug/pprof/"
	PROFILING=true ./$(BINARY_NAME) 2>&1 | tee $(PROFILE_DIR)/profile_$(VERSION).log

# ----------------------------
# Clean
# ----------------------------
clean:
	rm -f $(BINARY_NAME)
	rm -f $(LOGS) || true

clean-profiles:
	rm -rf $(PROFILE_DIR) || true

clean-structs:
	rm -rf $(STRUCT_DIR) || true

clean-all: clean clean-profiles clean-structs

# ----------------------------
# Swagger
# ----------------------------
swagger:
	swag init -g $(MAIN) -o docs

# ----------------------------
# Tests
# ----------------------------
test:
	go test ./...

test-cover:
	go test -cover ./...

test-race:
	go test -race ./...

# ----------------------------
# Load testing
# ----------------------------
loadtest:
	python -m locust -f loadtest/loadtest.py --users $(USERS) --spawn-rate $(SPAWN_RATE) --host $(HOST) --run-time $(RUN_TIME) --web-port 8090

# ----------------------------
# Profiling
# ----------------------------
profile-capture:
	@mkdir -p $(PROFILE_DIR)
	@curl -s http://localhost:$(PPROF_PORT)/debug/pprof/profile > $(PROFILE_DIR)/profile_$(VERSION).prof
	@curl -s http://localhost:$(PPROF_PORT)/debug/pprof/heap > $(PROFILE_DIR)/mem_$(VERSION).prof
	@curl -s http://localhost:$(PPROF_PORT)/debug/pprof/goroutine > $(PROFILE_DIR)/goroutine_$(VERSION).txt
	@echo "Profiles saved to $(PROFILE_DIR)/"

profile-cpu: $(PROFILE_DIR)/profile_$(VERSION)_*.prof
	@go tool pprof -http=:1092 $(word 1, $^)

profile-mem: $(PROFILE_DIR)/mem_$(VERSION)_*.prof
	@go tool pprof -http=:1091 $(word 1, $^)

# ----------------------------
# Struct Analysis & Optimization
# ----------------------------

# Install required tools for struct analysis
struct-tools:
	@echo "Installing struct analysis tools..."
	go install honnef.co/go/tools/cmd/structlayout@latest
	go install github.com/ajstarks/svgo/structlayout-svg@latest
	go install github.com/maruel/pretty@latest
	go install github.com/dominikh/go-tools/cmd/structlayout-optimize@latest
	go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest
	go install github.com/orijtech/structslop/cmd/structslop@latest

# Find all structs in the project
struct-find:
	@mkdir -p $(STRUCT_DIR)
	@echo "Searching for all structs in .go files..."
	@grep -R --include="*.go" -n "type " . | grep "struct" | tee $(STRUCT_DIR)/structs_found.txt

# Analyze a specific struct
struct-analyze:
	@if [ -z "$(STRUCT)" ] || [ -z "$(FILE)" ]; then \
		echo "Usage: make struct-analyze STRUCT=StructName FILE=path/to/file.go"; \
		echo "Example: make struct-analyze STRUCT=Client FILE=./pkg/websocket/client.go"; \
		exit 1; \
	fi
	@mkdir -p $(STRUCT_DIR)
	@echo "Analyzing struct $(STRUCT) in $(FILE)"
	@structlayout -json "$(STRUCT)" "$(FILE)" > $(STRUCT_DIR)/$(STRUCT)_layout.json
	@structlayout-pretty "$(STRUCT)" "$(FILE)" > $(STRUCT_DIR)/$(STRUCT)_pretty.txt
	@structlayout "$(STRUCT)" "$(FILE)" | structlayout-optimize > $(STRUCT_DIR)/$(STRUCT)_optimized.txt
	@structlayout -json "$(STRUCT)" "$(FILE)" | structlayout-svg > $(STRUCT_DIR)/$(STRUCT).svg
	@echo "Reports generated in $(STRUCT_DIR)/"
	@echo "- $(STRUCT)_layout.json - Raw layout data"
	@echo "- $(STRUCT)_pretty.txt - Human-readable layout"
	@echo "- $(STRUCT)_optimized.txt - Optimization suggestions"
	@echo "- $(STRUCT).svg - Visual representation"

# Generate reports for all structs in the project
struct-all: clean-structs
	@mkdir -p $(STRUCT_DIR)
	@echo "Analyzing all structs in the project..."
	@find . -name "*.go" -not -path "./vendor/*" -not -path "./third_party/*" | while read -r file; do \
		grep -E "^type [A-Z][A-Za-z0-9_]* struct" "$$file" 2>/dev/null | while read -r line; do \
			struct=$$(echo "$$line" | awk '{print $$2}'); \
			echo "Analyzing $$struct in $$file"; \
			structlayout-pretty "$$struct" "$$file" > "$(STRUCT_DIR)/$${struct}_pretty.txt" 2>/dev/null || true; \
			structlayout "$$struct" "$$file" 2>/dev/null | structlayout-optimize > "$(STRUCT_DIR)/$${struct}_optimized.txt" 2>/dev/null || true; \
			structlayout -json "$$struct" "$$file" 2>/dev/null | structlayout-svg > "$(STRUCT_DIR)/$${struct}.svg" 2>/dev/null || true; \
		done; \
	done
	@echo "\nAll struct reports saved to $(STRUCT_DIR)/"

# Check field alignment in the entire project
field-alignment:
	@echo "Checking field alignment..."
	@fieldalignment -fix ./... 2>&1 | tee $(STRUCT_DIR)/field_alignment.txt

# Find structs that could be optimized with better field ordering
struct-slop:
	@echo "Finding suboptimal structs..."
	@structslop ./... 2>&1 | tee $(STRUCT_DIR)/struct_slop.txt

# Help target for struct analysis
struct-help:
	@echo "\nStruct Analysis Commands:"
	@echo "  make struct-tools         - Install required tools for struct analysis"
	@echo "  make struct-find          - Find all structs in the project"
	@echo "  make struct-analyze       - Analyze a specific struct (STRUCT=Name FILE=path)"
	@echo "  make struct-all           - Generate reports for all structs"
	@echo "  make field-alignment      - Check and fix field alignment"
	@echo "  make struct-slop          - Find suboptimal structs"
	@echo "  make clean-structs        - Remove all generated struct reports\n"
	@echo "Example: make struct-analyze STRUCT=Client FILE=./pkg/websocket/client.go"
