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

PLATFORM_DIR := czcode-$(UNAME_S)-$(ARCH)
BINARY       := $(DIST_DIR)/opencode-$(UNAME_S)-$(ARCH)/bin/opencode
ZIP_NAME     := $(PLATFORM_DIR).zip

.PHONY: build clean

build:
	cd $(OPENCODE_DIR) && bun run script/build.ts --single --skip-install --skip-embed-web-ui
	mkdir -p $(OUT_DIR)/$(PLATFORM_DIR)
	cp $(BINARY) $(OUT_DIR)/$(PLATFORM_DIR)/czcode
	cp $(SCRIPTS_DIR)/setup.sh $(OUT_DIR)/$(PLATFORM_DIR)/setup.sh
	cd $(OUT_DIR)/$(PLATFORM_DIR) && zip -r ../$(ZIP_NAME) .
	@echo "✓ Package ready: $(OUT_DIR)/$(ZIP_NAME)"

clean:
	rm -rf $(OUT_DIR) $(DIST_DIR)
