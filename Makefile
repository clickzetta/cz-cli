OPENCODE_DIR := packages/opencode
DIST_DIR     := $(OPENCODE_DIR)/dist
SCRIPTS_DIR  := scripts
OUT_DIR      := out

# Detect platform for dist folder name
UNAME_S := $(shell uname -s | tr A-Z a-z)
UNAME_M := $(shell uname -m)

ifeq ($(UNAME_M),arm64)
  ARCH := arm64
else ifeq ($(UNAME_M),aarch64)
  ARCH := arm64
else
  ARCH := x64
endif

PLATFORM_DIR := cz-cli-$(UNAME_S)-$(ARCH)
DIST_BIN     := $(DIST_DIR)/opencode-$(UNAME_S)-$(ARCH)/bin

.PHONY: build clean

build:
	cd $(OPENCODE_DIR) && bun run script/build.ts --single --skip-install --skip-embed-web-ui
	mkdir -p $(OUT_DIR)/$(PLATFORM_DIR)
	cp $(DIST_BIN)/cz-cli $(OUT_DIR)/$(PLATFORM_DIR)/cz-cli
	cp $(SCRIPTS_DIR)/setup.sh $(OUT_DIR)/$(PLATFORM_DIR)/setup.sh
	@if [ -d "$(DIST_BIN)/cz-tool" ]; then cp -r $(DIST_BIN)/cz-tool $(OUT_DIR)/$(PLATFORM_DIR)/cz-tool; fi
	@if [ -d "$(DIST_BIN)/skills" ]; then cp -r $(DIST_BIN)/skills $(OUT_DIR)/$(PLATFORM_DIR)/skills; fi
	cd $(OUT_DIR)/$(PLATFORM_DIR) && zip -r ../$(ZIP_NAME) .
	@echo "✓ Package ready: $(OUT_DIR)/$(ZIP_NAME)"

clean:
	rm -rf $(OUT_DIR) $(DIST_DIR)
