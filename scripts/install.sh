#!/bin/sh
# cz-cli installer — download release archive, extract, run setup.sh.
# Usage:
#   curl -fsSL https://github.com/clickzetta/cz-code/releases/latest/download/install.sh | sh
#
# Environment variables:
#   CZ_VERSION          — pin a specific version (e.g. "0.1.0"); default: latest
#   CZ_MIRROR           — custom mirror base URL (e.g. "https://your-cdn.com/cz-code")
#   NON_INTERACTIVE     — skip all prompts (set to any non-empty value)
#   SKIP_PATH_PROMPT    — skip PATH configuration prompt
#   SKIP_SKILLS_INSTALL — skip automatic skills registration

set -e

REPO="clickzetta/cz-code"
BINARY_NAME="czcli"
INSTALL_DIR="${HOME}/.local/bin"
TEMP_DIR=$(mktemp -d)

NON_INTERACTIVE="${NON_INTERACTIVE:-}"
SKIP_PATH_PROMPT="${SKIP_PATH_PROMPT:-}"
SKIP_SKILLS_INSTALL="${SKIP_SKILLS_INSTALL:-}"

if [ -f /.dockerenv ]; then
    NON_INTERACTIVE=1
    SKIP_PATH_PROMPT=1
fi

cleanup() { [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

print_success() { echo "✓ $1"; }
print_error()   { echo "Error: $1" >&2; }

# ── Auto-detect system proxy ──────────────────────────────────────────────

detect_proxy() {
    if [ -n "$https_proxy" ] || [ -n "$HTTPS_PROXY" ]; then return; fi

    local proxy=""

    if command -v networksetup > /dev/null 2>&1; then
        local info
        info=$(networksetup -getsecurewebproxy Wi-Fi 2>/dev/null || true)
        if echo "$info" | grep -q "Enabled: Yes"; then
            local host port
            host=$(echo "$info" | grep "^Server:" | awk '{print $2}')
            port=$(echo "$info" | grep "^Port:" | awk '{print $2}')
            if [ -n "$host" ] && [ -n "$port" ] && [ "$host" != "0" ]; then
                proxy="http://${host}:${port}"
            fi
        fi
    fi

    if [ -z "$proxy" ]; then
        for port in 7890 7897 1087 8080; do
            if curl -sf --connect-timeout 1 --max-time 2 \
                -x "http://127.0.0.1:${port}" https://github.com -o /dev/null 2>/dev/null; then
                proxy="http://127.0.0.1:${port}"
                break
            fi
        done
    fi

    if [ -n "$proxy" ]; then
        export https_proxy="$proxy" http_proxy="$proxy"
        echo "Auto-detected proxy: $proxy"
    fi
}

detect_proxy

# ── Platform detection ────────────────────────────────────────────────────

get_platform() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m | tr '[:upper:]' '[:lower:]')

    case "$arch" in
        x86_64|amd64) arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
    esac

    echo "${os}-${arch}"
}

# ── Version resolution ────────────────────────────────────────────────────

get_latest_version() {
    local version=""
    local redirect_url="https://github.com/${REPO}/releases/latest"

    if command -v curl > /dev/null 2>&1; then
        version=$(curl -fsSI "$redirect_url" 2>/dev/null \
            | grep -i '^location:' | sed 's|.*/tag/||;s/[[:space:]]//g')
    elif command -v wget > /dev/null 2>&1; then
        version=$(wget --spider -S "$redirect_url" 2>&1 \
            | grep -i '^\s*location:' | sed 's|.*/tag/||;s/[[:space:]]//g')
    else
        print_error "curl or wget is required"
        exit 1
    fi

    if [ -z "$version" ]; then
        local api_url="https://api.github.com/repos/${REPO}/releases/latest"
        if command -v curl > /dev/null 2>&1; then
            version=$(curl -fsSL "$api_url" 2>/dev/null \
                | grep '"tag_name"' | head -1 \
                | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"//;s/".*//')
        else
            version=$(wget -qO- "$api_url" 2>/dev/null \
                | grep '"tag_name"' | head -1 \
                | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"//;s/".*//')
        fi
    fi

    if [ -z "$version" ]; then
        print_error "Failed to determine latest version"
        exit 1
    fi
    echo "$version"
}

# ── Download helper ───────────────────────────────────────────────────────

download() {
    local url="$1" dest="$2"
    if command -v curl > /dev/null 2>&1; then
        curl -fSL --progress-bar "$url" -o "$dest"
    else
        wget -q --show-progress -O "$dest" "$url"
    fi
}

release_url() {
    local base="${CZ_MIRROR:-https://github.com/${REPO}/releases/download}"
    echo "${base}/$1/$2"
}

# ── Main ──────────────────────────────────────────────────────────────────

main() {
    local platform version

    platform=$(get_platform)
    echo "Detected platform: $platform"

    case "$platform" in
        mingw*|msys*|cygwin*|windows-*)
            print_error "Windows is not supported by this installer."
            echo "Download the binary directly from:"
            echo "  https://github.com/${REPO}/releases/latest"
            exit 1
            ;;
    esac

    # Check dependencies based on platform
    case "$platform" in
        linux-*)
            for cmd in tar; do
                if ! command -v "$cmd" > /dev/null 2>&1; then
                    print_error "$cmd is required but not installed"
                    exit 1
                fi
            done
            ;;
        *)
            for cmd in unzip; do
                if ! command -v "$cmd" > /dev/null 2>&1; then
                    print_error "$cmd is required but not installed"
                    exit 1
                fi
            done
            ;;
    esac

    if [ -n "$CZ_VERSION" ]; then
        version="$CZ_VERSION"
        case "$version" in v*) ;; *) version="v${version}" ;; esac
    else
        echo "Fetching latest version..."
        version=$(get_latest_version)
    fi
    echo "Version: $version"

    # Skip if same version already installed (check both czcli and cz-cli symlink)
    local check_bin="$INSTALL_DIR/$BINARY_NAME"
    [ ! -x "$check_bin" ] && check_bin="$INSTALL_DIR/cz-cli"
    if [ -x "$check_bin" ]; then
        local installed_version
        installed_version=$("$check_bin" --version 2>/dev/null | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
        local v_clean="${version#v}"
        local i_clean="${installed_version#v}"
        if [ -n "$i_clean" ] && [ "$v_clean" = "$i_clean" ]; then
            print_success "cz-cli $version is already installed. Skipping."
            exit 0
        fi
    fi

    # Archive naming matches Makefile output: czcli-{os}-{arch}.zip
    local archive_name ext
    case "$platform" in
        linux-*) ext="tar.gz"; archive_name="czcli-${platform}.tar.gz" ;;
        *)       ext="zip";    archive_name="czcli-${platform}.zip" ;;
    esac

    local archive_url
    archive_url=$(release_url "$version" "$archive_name")

    echo "Downloading $archive_url ..."
    download "$archive_url" "$TEMP_DIR/$archive_name"
    print_success "Downloaded $(du -h "$TEMP_DIR/$archive_name" | cut -f1)"

    echo "Extracting..."
    local extract_dir="$TEMP_DIR/extracted"
    mkdir -p "$extract_dir"
    case "$ext" in
        tar.gz) tar -xzf "$TEMP_DIR/$archive_name" -C "$extract_dir" ;;
        zip)    unzip -qo "$TEMP_DIR/$archive_name" -d "$extract_dir" ;;
    esac

    if [ ! -f "$extract_dir/setup.sh" ]; then
        print_error "Archive does not contain setup.sh"
        exit 1
    fi

    chmod +x "$extract_dir/setup.sh"
    NON_INTERACTIVE="$NON_INTERACTIVE" \
    SKIP_PATH_PROMPT="$SKIP_PATH_PROMPT" \
    SKIP_SKILLS_INSTALL="$SKIP_SKILLS_INSTALL" \
    sh "$extract_dir/setup.sh"
}

main
