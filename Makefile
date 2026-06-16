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
BINARY       := $(DIST_DIR)/cz-cli-$(UNAME_S)-$(ARCH)/bin/cz-cli
ZIP_NAME     := $(PLATFORM_DIR).zip

# Auto-increment version from latest stable git tag (override with VERSION=x.y.z)
LATEST_TAG   := $(shell git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$$' | head -1 | sed 's/^v//')
NEXT_PATCH   := $(shell printf '%s\n' "$(LATEST_TAG)" | awk -F. 'NF == 3 { print $$1"."$$2"."$$3 + 1 }')
VERSION      ?= $(if $(NEXT_PATCH),$(NEXT_PATCH),0.1.0)

ifndef DEV_SUFFIX
DEV_SUFFIX   := $(shell date +%Y%m%d%H%M%S)
endif

.PHONY: build clean release release-dev

build:
	cd $(OPENCODE_DIR) && bun run script/build.ts --single --skip-install --skip-embed-web-ui
	mkdir -p $(OUT_DIR)/$(PLATFORM_DIR)
	cp $(BINARY) $(OUT_DIR)/$(PLATFORM_DIR)/cz-cli
	test -d $(DIST_DIR)/cz-cli-$(UNAME_S)-$(ARCH)/bin/skills && cp -r $(DIST_DIR)/cz-cli-$(UNAME_S)-$(ARCH)/bin/skills $(OUT_DIR)/$(PLATFORM_DIR)/skills || true
	cp $(SCRIPTS_DIR)/setup.sh $(OUT_DIR)/$(PLATFORM_DIR)/setup.sh
	cd $(OUT_DIR)/$(PLATFORM_DIR) && zip -r ../$(ZIP_NAME) .
	@echo "✓ Package ready: $(OUT_DIR)/$(ZIP_NAME)"

clean:
	rm -rf $(OUT_DIR) $(DIST_DIR)

tag-release:
	git tag v$(VERSION)
	git push origin v$(VERSION)
	@echo "✓ Pushed stable tag v$(VERSION) — GitHub Actions will build release + promote stable"

tag-dev:
	git tag dev-v$(VERSION).$(DEV_SUFFIX)
	git push origin dev-v$(VERSION).$(DEV_SUFFIX)
	@echo "✓ Pushed dev tag dev-v$(VERSION).$(DEV_SUFFIX) — GitHub Actions will build latest"
