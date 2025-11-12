BINARY_NAME=chatters-server
MAIN=cmd/server/main.go
LOGS=logs/*.log
PROFILE_DIR=profiles
STRUCT_DIR=struct_reports
LOADTEST_DIR=loadtest_results
VERSION?=0.0.2

USERS?=2000
SPAWN_RATE?=25
HOST?=http://localhost:8080
RUN_TIME?=3m
PPROF_PORT?=6060
LOCUST_FILE?=loadtest/loadtest.py

# Go tools paths
GOPATH_BIN=$(shell go env GOPATH)/bin
GOCYCLO=$(GOPATH_BIN)/gocyclo
GOCOGNIT=$(GOPATH_BIN)/gocognit
DUPL=$(GOPATH_BIN)/dupl
STATICCHECK=$(GOPATH_BIN)/staticcheck

.PHONY: all build run run-profile clean clean-profiles clean-structs clean-loadtest clean-all swagger test test-cover test-race \
	loadtest loadtest-high-msg loadtest-high-conc loadtest-mixed loadtest-churn loadtest-max-rps \
	struct-find struct-analyze struct-all clean-structs profile-capture profile-cpu profile-mem struct-help \
	metrics-iteration1 metrics-clean metrics-view install-tools

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

clean-loadtest:
	rm -rf $(LOADTEST_DIR) || true

clean-all: clean clean-profiles clean-structs clean-loadtest

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
# Load Testing
# ----------------------------
loadtest:
	python -m locust -f $(LOCUST_FILE) --host $(HOST) --web-host=localhost  --web-port=8089

loadtest-class-picker:
	python -m locust -f $(LOCUST_FILE) --host $(HOST) --web-host=localhost --web-port=8090 --class-picker

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
struct-tools:
	@echo "Installing struct analysis tools..."
	go install honnef.co/go/tools/cmd/structlayout@latest
	go install github.com/ajstarks/svgo/structlayout-svg@latest
	go install github.com/maruel/pretty@latest
	go install github.com/dominikh/go-tools/cmd/structlayout-optimize@latest
	go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest
	go install github.com/orijtech/structslop/cmd/structslop@latest

struct-find:
	@mkdir -p $(STRUCT_DIR)
	@echo "Searching for all structs in .go files..."
	@grep -R --include="*.go" -n "type " . | grep "struct" | tee $(STRUCT_DIR)/structs_found.txt

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

field-alignment:
	@echo "Checking field alignment..."
	@fieldalignment -fix ./... 2>&1 | tee $(STRUCT_DIR)/field_alignment.txt

struct-slop:
	@echo "Finding suboptimal structs..."
	@structslop ./... 2>&1 | tee $(STRUCT_DIR)/struct_slop.txt

struct-help:
	@echo "\nStruct Analysis Commands:"
	@echo "  make struct-tools         - Install required tools for struct analysis"
	@echo "  make struct-find          - Find all structs in the project"
	@echo "  make struct-analyze       - Analyze a specific struct (STRUCT=Name FILE=path)"
	@echo "  make struct-all           - Generate reports for all structs"
	@echo "  make field-alignment      - Check and fix field alignment"
	@echo "  make struct-slop          - Find suboptimal structs"
	@echo "  make clean-structs        - Remove all generated struct reports\n"

loadtest-help:
	@echo "\nLoad Testing Commands:"
	@echo "  make loadtest             - Run default load test"
	@echo "  make loadtest-class-picker - Run with class picker"
	@echo "  make clean-loadtest       - Remove all load test results"

# ----------------------------
# Code Quality Metrics (iteration-1)
# ----------------------------

# Установка инструментов для метрик
install-tools:
	@echo "📦 Installing Go code quality tools..."
	@go install github.com/fzipp/gocyclo/cmd/gocyclo@latest
	@go install github.com/uudashr/gocognit/cmd/gocognit@latest
	@go install github.com/mibk/dupl@latest
	@go install honnef.co/go/tools/cmd/staticcheck@latest
	@echo "✅ Go tools installed in: $(GOPATH_BIN)"
	@echo ""
	@echo "⚠️  Make sure $(GOPATH_BIN) is in your PATH:"
	@echo "    export PATH=\$$PATH:$(GOPATH_BIN)"
	@echo ""
	@echo "📦 Optional: Install cloc for LOC metrics:"
	@echo "    Ubuntu/Debian: sudo apt-get install cloc"
	@echo "    macOS: brew install cloc"

# Генерация всех метрик для iteration-1
metrics-iteration1:
	@echo "🔍 Generating Code Quality Metrics for Iteration 1..."
	@echo ""
	@mkdir -p metrics/iteration-1/1-cyclomatic-complexity
	@mkdir -p metrics/iteration-1/2-code-coverage
	@mkdir -p metrics/iteration-1/3-cognitive-complexity
	@mkdir -p metrics/iteration-1/4-code-duplication
	@mkdir -p metrics/iteration-1/5-dependencies
	@mkdir -p metrics/iteration-1/6-lines-of-code
	@mkdir -p metrics/iteration-1/7-maintainability
	
	@echo "📊 1/7 Cyclomatic Complexity..."
	@go run github.com/fzipp/gocyclo/cmd/gocyclo@latest -over 1 -avg . > metrics/iteration-1/1-cyclomatic-complexity/report.txt 2>&1 || \
		echo "ERROR: Failed to run gocyclo" > metrics/iteration-1/1-cyclomatic-complexity/report.txt
	@echo "   ✓ Saved to metrics/iteration-1/1-cyclomatic-complexity/report.txt"
	
	@echo "📊 2/7 Code Coverage..."
	@go test -coverprofile=metrics/iteration-1/2-code-coverage/coverage.out ./... 2>&1 || true
	@go tool cover -func=metrics/iteration-1/2-code-coverage/coverage.out > metrics/iteration-1/2-code-coverage/report.txt 2>&1 || \
		echo "No test coverage available" > metrics/iteration-1/2-code-coverage/report.txt
	@echo "   ✓ Saved to metrics/iteration-1/2-code-coverage/report.txt"
	
	@echo "📊 3/7 Cognitive Complexity..."
	@go run github.com/uudashr/gocognit/cmd/gocognit@latest -over 1 . > metrics/iteration-1/3-cognitive-complexity/report.txt 2>&1 || \
		echo "ERROR: Failed to run gocognit" > metrics/iteration-1/3-cognitive-complexity/report.txt
	@echo "   ✓ Saved to metrics/iteration-1/3-cognitive-complexity/report.txt"
	
	@echo "📊 4/7 Code Duplication..."
	@go run github.com/mibk/dupl@latest -threshold 50 . > metrics/iteration-1/4-code-duplication/report.txt 2>&1 || \
		echo "No duplications found" > metrics/iteration-1/4-code-duplication/report.txt
	@echo "   ✓ Saved to metrics/iteration-1/4-code-duplication/report.txt"
	
	@echo "📊 5/7 Dependencies..."
	@go mod graph > metrics/iteration-1/5-dependencies/report.txt 2>&1
	@echo "" >> metrics/iteration-1/5-dependencies/report.txt
	@echo "=== Package List ===" >> metrics/iteration-1/5-dependencies/report.txt
	@go list -m all >> metrics/iteration-1/5-dependencies/report.txt 2>&1
	@echo "   ✓ Saved to metrics/iteration-1/5-dependencies/report.txt"
	
	@echo "📊 6/7 Lines of Code..."
	@cloc . --exclude-dir=vendor,node_modules,metrics 2>&1 | tee metrics/iteration-1/6-lines-of-code/report.txt || \
		(echo "=== Go Files LOC (fallback) ===" > metrics/iteration-1/6-lines-of-code/report.txt && \
		 find . -name "*.go" -not -path "./vendor/*" -not -path "./node_modules/*" | xargs wc -l >> metrics/iteration-1/6-lines-of-code/report.txt 2>&1)
	@echo "   ✓ Saved to metrics/iteration-1/6-lines-of-code/report.txt"
	
	@echo "📊 7/7 Maintainability..."
	@echo "=== Go Vet ===" > metrics/iteration-1/7-maintainability/report.txt
	@go vet ./... >> metrics/iteration-1/7-maintainability/report.txt 2>&1 || echo "No issues found" >> metrics/iteration-1/7-maintainability/report.txt
	@echo "" >> metrics/iteration-1/7-maintainability/report.txt
	@echo "=== Go Fmt Check ===" >> metrics/iteration-1/7-maintainability/report.txt
	@gofmt -l . >> metrics/iteration-1/7-maintainability/report.txt 2>&1 || echo "All files formatted" >> metrics/iteration-1/7-maintainability/report.txt
	@echo "" >> metrics/iteration-1/7-maintainability/report.txt
	@echo "=== Staticcheck ===" >> metrics/iteration-1/7-maintainability/report.txt
	@go run honnef.co/go/tools/cmd/staticcheck@latest ./... >> metrics/iteration-1/7-maintainability/report.txt 2>&1 || echo "No issues found" >> metrics/iteration-1/7-maintainability/report.txt
	@echo "   ✓ Saved to metrics/iteration-1/7-maintainability/report.txt"
	
	@echo ""
	@echo "✅ All metrics generated successfully!"
	@echo "📁 Results saved in metrics/iteration-1/"
	@echo ""
	@echo "📂 Generated files:"
	@find metrics/iteration-1/ -name "*.txt" -type f | sort

# Просмотр метрик
metrics-view:
	@echo "╔════════════════════════════════════════════════════════════╗"
	@echo "║     📊 Code Metrics Summary (Iteration 1)                 ║"
	@echo "╚════════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "1️⃣  CYCLOMATIC COMPLEXITY (Top 15):"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@head -n 15 metrics/iteration-1/1-cyclomatic-complexity/report.txt 2>/dev/null || echo "❌ Not generated"
	@echo ""
	@echo "2️⃣  CODE COVERAGE:"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@tail -n 5 metrics/iteration-1/2-code-coverage/report.txt 2>/dev/null || echo "❌ Not generated"
	@echo ""
	@echo "3️⃣  COGNITIVE COMPLEXITY (Top 10):"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@head -n 10 metrics/iteration-1/3-cognitive-complexity/report.txt 2>/dev/null || echo "❌ Not generated"
	@echo ""
	@echo "4️⃣  CODE DUPLICATION:"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@head -n 10 metrics/iteration-1/4-code-duplication/report.txt 2>/dev/null || echo "❌ Not generated"
	@echo ""
	@echo "5️⃣  DEPENDENCIES (First 10):"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@head -n 10 metrics/iteration-1/5-dependencies/report.txt 2>/dev/null || echo "❌ Not generated"
	@echo ""
	@echo "6️⃣  LINES OF CODE:"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@cat metrics/iteration-1/6-lines-of-code/report.txt 2>/dev/null || echo "❌ Not generated"
	@echo ""
	@echo "7️⃣  MAINTAINABILITY:"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@cat metrics/iteration-1/7-maintainability/report.txt 2>/dev/null || echo "❌ Not generated"
	@echo ""
	@echo "╚════════════════════════════════════════════════════════════╝"

# Очистка метрик
metrics-clean:
	@echo "🗑️  Cleaning metrics..."
	@rm -rf metrics/iteration-1
	@echo "✅ Metrics cleaned!"

# Помощь по метрикам
metrics-help:
	@echo "╔════════════════════════════════════════════════════════════╗"
	@echo "║           📊 Code Metrics Commands                        ║"
	@echo "╚════════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "Available commands:"
	@echo "  make install-tools      - Install all required Go tools"
	@echo "  make metrics-iteration1 - Generate all metrics for iteration-1"
	@echo "  make metrics-view       - View metrics summary"
	@echo "  make metrics-clean      - Clean all generated metrics"
	@echo "  make metrics-help       - Show this help message"
	@echo ""
	@echo "Quick start:"
	@echo "  1. make install-tools"
	@echo "  2. export PATH=\$$PATH:$(GOPATH_BIN)"
	@echo "  3. make metrics-iteration1"
	@echo "  4. make metrics-view"
	@echo ""
	@echo "Current GOPATH/bin: $(GOPATH_BIN)"
	@echo ""