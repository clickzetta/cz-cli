#!/usr/bin/env bash
set -euo pipefail
APP=cz-cli

MUTED='\033[0;2m'
RED='\033[0;31m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
NC='\033[0m'

usage() {
    cat <<EOF
cz-cli Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g., 0.3.85)
    -b, --binary <path>     Install from a local binary instead of downloading
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Environment:
    CZ_LIBC=auto|musl|glibc  Linux libc selection (default: auto). Use
                             CZ_LIBC=musl to force the statically-linked build
                             on servers whose glibc is too old.

Examples:
    curl -fsSL https://cz-cli.ai/install | bash
    curl -fsSL https://cz-cli.ai/install | bash -s -- --version 0.3.85
    CZ_LIBC=musl curl -fsSL https://cz-cli.ai/install | bash
    ./install.sh --binary /path/to/cz-cli
EOF
}

requested_version=${CZ_VERSION:-${VERSION:-}}
CHANNEL="${CZ_CHANNEL:-stable}"
# libc selection for Linux binaries: auto (default) | musl | glibc.
#   musl  -> force the statically-linked build (no glibc dependency); use this
#            on servers whose glibc is too old to run the default binary.
#   glibc -> force the glibc-linked build.
#   auto  -> detect musl distros, and fall back to musl when the host glibc is
#            older than the minimum the glibc binary requires.
CZ_LIBC="${CZ_LIBC:-auto}"
no_modify_path=false
binary_path=""

case "$CHANNEL" in
    stable|nightly)
        ;;
    *)
        echo -e "${RED}Error: invalid CZ_CHANNEL '${CHANNEL}' (expected stable or nightly)${NC}" >&2
        exit 1
        ;;
esac

case "$CZ_LIBC" in
    auto|musl|glibc)
        ;;
    *)
        echo -e "${RED}Error: invalid CZ_LIBC '${CZ_LIBC}' (expected auto, musl, or glibc)${NC}" >&2
        exit 1
        ;;
esac

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -n "${2:-}" ]]; then
                requested_version="$2"
                shift 2
            else
                echo -e "${RED}Error: --version requires a version argument${NC}"
                exit 1
            fi
            ;;
        -b|--binary)
            if [[ -n "${2:-}" ]]; then
                binary_path="$2"
                shift 2
            else
                echo -e "${RED}Error: --binary requires a path argument${NC}"
                exit 1
            fi
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${RED}Warning: Unknown option '$1'${NC}" >&2
            shift
            ;;
    esac
done

INSTALL_DIR=${CZ_INSTALL_DIR:-$HOME/.local/bin}
mkdir -p "$INSTALL_DIR"

# If --binary is provided, skip all download/detection logic
if [ -n "$binary_path" ]; then
    if [ ! -f "$binary_path" ]; then
        echo -e "${RED}Error: Binary not found at ${binary_path}${NC}"
        exit 1
    fi
    specific_version="local"
else
    raw_os=$(uname -s)
    os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
    case "$raw_os" in
      Darwin*) os="darwin" ;;
      Linux*) os="linux" ;;
      MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    esac

    arch=$(uname -m)
    if [[ "$arch" == "aarch64" ]]; then
      arch="arm64"
    fi
    if [[ "$arch" == "x86_64" ]]; then
      arch="x64"
    fi

    if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
      rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
      if [ "$rosetta_flag" = "1" ]; then
        arch="arm64"
      fi
    fi

    combo="$os-$arch"
    case "$combo" in
      linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64)
        ;;
      *)
        echo -e "${RED}Unsupported OS/Arch: $os/$arch${NC}"
        exit 1
        ;;
    esac

    archive_ext=".zip"
    if [ "$os" = "linux" ]; then
      archive_ext=".tar.gz"
    fi

    is_musl=false
    if [ "$os" = "linux" ]; then
      if [ "$CZ_LIBC" = "musl" ]; then
        is_musl=true
      elif [ "$CZ_LIBC" = "auto" ]; then
        if [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; then
          is_musl=true
        else
          # The glibc binary links symbols up to GLIBC_2.25; hosts older than
          # that (e.g. CentOS/RHEL 7 at 2.17) must use the static musl build.
          # `|| true`: under `set -euo pipefail`, a failing pipeline (e.g. ldd
          # absent, or no version match) would otherwise abort the installer;
          # instead leave glibc empty and fall through to the glibc build.
          glibc=$(ldd --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | tail -n1 || true)
          gmaj=${glibc%%.*}; gmin=${glibc##*.}
          if [ -n "$glibc" ] && { [ "$gmaj" -lt 2 ] || { [ "$gmaj" -eq 2 ] && [ "$gmin" -lt 25 ]; }; }; then
            echo -e "${MUTED}Detected glibc ${glibc} < 2.25; using statically-linked musl build${NC}"
            is_musl=true
          fi
        fi
      fi
    fi

    needs_baseline=false
    if [ "$arch" = "x64" ]; then
      if [ "$os" = "linux" ]; then
        if ! grep -qwi avx2 /proc/cpuinfo 2>/dev/null; then
          needs_baseline=true
        fi
      fi
      if [ "$os" = "darwin" ]; then
        avx2=$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)
        if [ "$avx2" != "1" ]; then
          needs_baseline=true
        fi
      fi
    fi

    target="$os-$arch"
    if [ "$needs_baseline" = "true" ]; then
      target="$target-baseline"
    fi
    if [ "$is_musl" = "true" ]; then
      target="$target-musl"
    fi

    filename="$APP-$target$archive_ext"

    if [ "$os" = "linux" ]; then
        if ! command -v tar >/dev/null 2>&1; then
             echo -e "${RED}Error: 'tar' is required but not installed.${NC}"
             exit 1
        fi
    else
        if ! command -v unzip >/dev/null 2>&1; then
            echo -e "${RED}Error: 'unzip' is required but not installed.${NC}"
            exit 1
        fi
    fi

    BASE_URL="https://cz-cli.ai/download"

    if [ -z "$requested_version" ]; then
        specific_version=$(curl -fsSL "https://cz-cli.ai/api/${CHANNEL}" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        if [[ $? -ne 0 || -z "$specific_version" ]]; then
            echo -e "${RED}Failed to fetch version information${NC}"
            exit 1
        fi
    else
        requested_version="${requested_version#v}"
        specific_version=$requested_version
    fi

    url="${BASE_URL}/${specific_version}/${target}"
fi

print_message() {
    local level=$1
    local message=$2
    local color=""
    case $level in
        info) color="${NC}" ;;
        warning) color="${NC}" ;;
        error) color="${RED}" ;;
    esac
    echo -e "${color}${message}${NC}"
}

version_weight() {
    local suffix="$1"
    if [[ -z "$suffix" ]]; then
        echo 2
        return
    fi
    if [[ "$suffix" == dev* ]]; then
        echo 0
        return
    fi
    echo 1
}

version_gt() {
    local left_raw right_raw left_core left_suffix right_core right_suffix
    left_raw="${1#v}"
    right_raw="${2#v}"
    left_raw="${left_raw#dev-v}"
    right_raw="${right_raw#dev-v}"
    left_core="${left_raw%%-*}"
    right_core="${right_raw%%-*}"
    left_suffix=""
    right_suffix=""
    if [[ "$left_raw" == *-* ]]; then
        left_suffix="${left_raw#*-}"
    fi
    if [[ "$right_raw" == *-* ]]; then
        right_suffix="${right_raw#*-}"
    fi

    local IFS=.
    read -r -a left_nums <<< "$left_core"
    read -r -a right_nums <<< "$right_core"

    for i in 0 1 2; do
        local left_num="${left_nums[$i]:-0}"
        local right_num="${right_nums[$i]:-0}"
        if (( left_num > right_num )); then
            return 0
        fi
        if (( left_num < right_num )); then
            return 1
        fi
    done

    local left_weight right_weight
    left_weight=$(version_weight "$left_suffix")
    right_weight=$(version_weight "$right_suffix")
    if (( left_weight > right_weight )); then
        return 0
    fi
    return 1
}

check_version() {
    if command -v cz-cli >/dev/null 2>&1 && [[ -z "$CZ_FORCE" ]]; then
        local existing_path
        existing_path=$(command -v cz-cli)
        # Only skip/compare if the found binary is the one we manage
        if [[ "$existing_path" == "${INSTALL_DIR}/${APP}" ]] || [[ "$existing_path" == "${INSTALL_DIR}/cz-cli" ]]; then
            installed_version=$(cz-cli --version 2>/dev/null || echo "")
            if [[ "$installed_version" == "$specific_version" ]]; then
                print_message info "${MUTED}Version ${NC}$specific_version${MUTED} already installed${NC}"
                exit 0
            elif [[ -n "$installed_version" ]] && version_gt "$installed_version" "$specific_version"; then
                if [[ -n "$requested_version" ]]; then
                    print_message info "${MUTED}Downgrading from ${NC}$installed_version${MUTED} to ${NC}$specific_version"
                else
                    print_message warning "${MUTED}A newer version is already installed: ${NC}$installed_version${MUTED} > ${NC}$specific_version"
                    exit 0
                fi
            elif [[ -n "$installed_version" ]]; then
                print_message info "${MUTED}Installed version: ${NC}$installed_version"
            fi
        fi
    fi
}

unbuffered_sed() {
    if echo | sed -u -e "" >/dev/null 2>&1; then
        sed -nu "$@"
    elif echo | sed -l -e "" >/dev/null 2>&1; then
        sed -nl "$@"
    else
        local pad="$(printf "\n%512s" "")"
        sed -ne "s/$/\\${pad}/" "$@"
    fi
}

print_progress() {
    local bytes="$1"
    local length="$2"
    [ "$length" -gt 0 ] || return 0

    local width=40
    local percent=$(( bytes * 100 / length ))
    [ "$percent" -gt 100 ] && percent=100
    local on=$(( percent * width / 100 ))
    local off=$(( width - on ))

    local filled=$(printf "%*s" "$on" "")
    filled=${filled// /▰}
    local empty=$(printf "%*s" "$off" "")
    empty=${empty// /▱}

    local mb_done=$(( bytes / 1048576 ))
    local mb_total=$(( length / 1048576 ))

    printf "\r  ${filled}${empty} %3d%% (%d/%d MB)" "$percent" "$mb_done" "$mb_total" >&4
}

download_with_progress() {
    local url="$1"
    local output="$2"

    if [ -t 2 ]; then
        exec 4>&2
    else
        exec 4>/dev/null
    fi

    local tmp_dir=${TMPDIR:-/tmp}
    local basename="${tmp_dir}/cz_cli_install_$$"
    local tracefile="${basename}.trace"

    rm -f "$tracefile"
    mkfifo "$tracefile"

    printf "\033[?25l" >&4

    trap "trap - RETURN; rm -f \"$tracefile\"; printf '\033[?25h' >&4; exec 4>&-" RETURN

    (
        curl -f --trace-ascii "$tracefile" -s -L -o "$output" "$url"
    ) &
    local curl_pid=$!

    unbuffered_sed \
        -e 'y/ACDEGHLNORTV/acdeghlnortv/' \
        -e '/^0000: content-length:/p' \
        -e '/^<= recv data/p' \
        "$tracefile" | \
    {
        local length=0
        local bytes=0

        while IFS=" " read -r -a line; do
            [ "${#line[@]}" -lt 2 ] && continue
            local tag="${line[0]} ${line[1]}"

            if [ "$tag" = "0000: content-length:" ]; then
                length="${line[2]}"
                length=$(echo "$length" | tr -d '\r')
                bytes=0
            elif [ "$tag" = "<= recv" ]; then
                local size="${line[3]}"
                bytes=$(( bytes + size ))
                if [ "$length" -gt 0 ]; then
                    print_progress "$bytes" "$length"
                fi
            fi
        done
    }

    wait $curl_pid
    local ret=$?
    echo "" >&4
    return $ret
}

download_and_install() {
    print_message info "\n${MUTED}✶ Downloading ${NC}${APP}-${specific_version}-${target}${archive_ext}"
    local tmp_dir="${TMPDIR:-/tmp}/cz_cli_install_$$"
    mkdir -p "$tmp_dir"

    if [[ "$os" == "windows" ]] || ! [ -t 2 ] || ! download_with_progress "$url" "$tmp_dir/$filename"; then
        # -f: fail (non-zero exit) on HTTP errors instead of writing the error
        # body to disk, which would later surface as a cryptic "tar: not in
        # gzip format" during extraction.
        if ! curl -fL -o "$tmp_dir/$filename" "$url"; then
            print_message error "Download failed for ${target} (${url})."
            print_message error "This build may be unavailable for your platform. Try CZ_LIBC=musl, or report the target above."
            rm -rf "$tmp_dir"
            exit 1
        fi
    fi

    if [ "$os" = "linux" ]; then
        tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"
    else
        unzip -q "$tmp_dir/$filename" -d "$tmp_dir"
    fi

    mv "$tmp_dir/$APP" "$INSTALL_DIR/"
    chmod 755 "${INSTALL_DIR}/${APP}"

    # Remove quarantine bit and re-sign on macOS. The binary was ad-hoc signed
    # during CI build, but unzip re-applies com.apple.quarantine to extracted
    # files, which causes Gatekeeper to SIGKILL the process on first run.
    if [ "$os" = "darwin" ]; then
        xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP}" 2>/dev/null || true
        if command -v codesign >/dev/null 2>&1; then
            codesign --force --sign - "${INSTALL_DIR}/${APP}" 2>/dev/null || true
        fi
    fi

    # Preserve bundled skills
    if [ -d "$tmp_dir/skills" ]; then
        rm -rf "$INSTALL_DIR/skills"
        mv "$tmp_dir/skills" "$INSTALL_DIR/skills"
    fi
    rm -rf "$tmp_dir"
}

install_from_binary() {
    print_message info "\n${MUTED}Installing ${NC}cz-cli ${MUTED}from: ${NC}$binary_path"
    cp "$binary_path" "${INSTALL_DIR}/${APP}"
    chmod 755 "${INSTALL_DIR}/${APP}"

    if [ "$(uname -s)" = "Darwin" ]; then
        xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP}" 2>/dev/null || true
        if command -v codesign >/dev/null 2>&1; then
            codesign --force --sign - "${INSTALL_DIR}/${APP}" 2>/dev/null || true
        fi
    fi

    # Bring along bundled skills that sit next to the source binary, mirroring
    # the download path which places them at "$INSTALL_DIR/skills".
    src_skills="$(dirname "$binary_path")/skills"
    if [ -d "$src_skills" ]; then
        rm -rf "$INSTALL_DIR/skills"
        cp -r "$src_skills" "$INSTALL_DIR/skills"
    fi
}

# Pre-install: detect and remove any cz-cli binary that would shadow our install
is_package_manager_binary() {
    local p="$1"
    local target=""
    if [ -L "$p" ]; then
        target=$(readlink "$p" 2>/dev/null || true)
    fi
    echo "$p$target" | grep -q "node_modules" && return 0
    echo "$p" | grep -q "\.bun" && return 0
    return 1
}

remove_shadowing_binary() {
    local p="$1"
    if is_package_manager_binary "$p"; then
        if echo "$p$(readlink "$p" 2>/dev/null)" | grep -q "\.bun"; then
            echo -e "${MUTED}Uninstalling old cz-cli via bun${NC}"
            bun remove -g @clickzetta/cz-cli 2>/dev/null || rm -f "$p" 2>/dev/null || true
        else
            echo -e "${MUTED}Uninstalling old cz-cli via npm${NC}"
            npm uninstall -g @clickzetta/cz-cli 2>/dev/null || rm -f "$p" 2>/dev/null || true
        fi
    else
        echo -e "${MUTED}Removing old cz-cli at ${NC}${p}"
        rm -f "$p" 2>/dev/null || sudo rm -f "$p" 2>/dev/null || true
    fi
}

validate_path_cz_cli() {
    local p="$1"
    local version=""
    version=$("$p" --version 2>/dev/null || true)
    if [ -z "$version" ]; then
        print_message error "PATH contains a cz-cli entry that cannot run --version: $p"
        print_message error "Remove this stale entry from PATH or delete the broken file, then run the installer again."
        exit 1
    fi
}

if command -v cz-cli >/dev/null 2>&1; then
    # Remove ALL cz-cli binaries that are not in our install dir
    while IFS= read -r existing_bin; do
        [ -z "$existing_bin" ] && continue
        validate_path_cz_cli "$existing_bin"
        if [ "$existing_bin" != "${INSTALL_DIR}/${APP}" ]; then
            remove_shadowing_binary "$existing_bin"
        fi
    done <<< "$(which -a cz-cli 2>/dev/null)"
fi

if [ -n "$binary_path" ]; then
    install_from_binary
else
    check_version
    download_and_install
fi

# Install a `cz-agent` convenience wrapper for `cz-cli agent`.
# It lives in the same dir (already on PATH), so it works in any shell and in
# scripts (unlike a shell alias). `cz-cli update` re-runs this script, so the
# wrapper is recreated on every upgrade.
cat > "${INSTALL_DIR}/cz-agent" <<EOF
#!/bin/sh
exec "${INSTALL_DIR}/${APP}" agent "\$@"
EOF
chmod 755 "${INSTALL_DIR}/cz-agent"

# Write install metadata so `cz-cli update` / auto-update know the release
# channel (stable by default; overridable via CZ_CHANNEL for nightly).
METADATA_DIR="$HOME/.clickzetta"
mkdir -p "$METADATA_DIR"
cat > "${METADATA_DIR}/install.json" <<EOF
{
  "version": 1,
  "installed_path": "${INSTALL_DIR}/${APP}",
  "channel": "${CHANNEL}",
  "binary_version": "${specific_version}",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Install bundled skills to ~/.clickzetta/skills/.builtin/
SKILLS_SRC="${INSTALL_DIR}/skills"
BUILTIN_DEST="$HOME/.clickzetta/skills/.builtin"
rm -rf "$BUILTIN_DEST"
mkdir -p "$BUILTIN_DEST"
if [ -d "$SKILLS_SRC" ]; then
    for skill_dir in "$SKILLS_SRC"/*/; do
        [ -d "$skill_dir" ] || continue
        skill_name=$(basename "$skill_dir")
        cp -r "$skill_dir" "$BUILTIN_DEST/$skill_name"
    done
fi

# Register the cz-cli skill into external agent skill directories so that
# Claude Code / Kiro / Codex / Cursor etc. can call cz-cli directly. Uses
# delete-then-install semantics; the builtin (.builtin) install above is
# unchanged. A failure on one directory must not abort the others.
for agent_dir in \
    "$HOME/.claude/skills" \
    "$HOME/.kiro/skills" \
    "$HOME/.cursor/skills" \
    "$HOME/.codex/skills" \
    "$HOME/.openclaw/workspace/skills" \
    "$HOME/.singclaw/workspace/skills"; do
    # Clean up deprecated skill aliases (do not reinstall — folded into cz-cli).
    for legacy in czagent czcli cz-cli-v2; do
        rm -rf "${agent_dir}/${legacy}" 2>/dev/null || true
    done
    # Delete-then-install the cz-cli skill.
    if [ -d "$SKILLS_SRC/cz-cli" ]; then
        mkdir -p "$agent_dir" 2>/dev/null || true
        rm -rf "${agent_dir}/cz-cli" 2>/dev/null || true
        cp -r "$SKILLS_SRC/cz-cli" "${agent_dir}/cz-cli" 2>/dev/null || true
    fi
done

add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file"; then
        print_message info "${MUTED}PATH already configured in $config_file${NC}"
    elif [[ -w $config_file ]]; then
        echo -e "\n# cz-cli" >> "$config_file"
        echo "$command" >> "$config_file"
        print_message info "${MUTED}Added ${NC}cz-cli ${MUTED}to \$PATH in ${NC}$config_file"
    else
        print_message warning "Manually add the directory to $config_file (or similar):"
        print_message info "  $command"
    fi
}

XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}

current_shell=$(basename "$SHELL")
case $current_shell in
    fish)
        config_files="$HOME/.config/fish/config.fish"
    ;;
    zsh)
        config_files="${ZDOTDIR:-$HOME}/.zshrc ${ZDOTDIR:-$HOME}/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc $XDG_CONFIG_HOME/zsh/.zshenv"
    ;;
    bash)
        config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
    ash|sh)
        config_files="$HOME/.ashrc $HOME/.profile /etc/profile"
    ;;
    *)
        config_files="$HOME/.bashrc $HOME/.bash_profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
esac

if [[ "$no_modify_path" != "true" ]]; then
    config_file=""
    for file in $config_files; do
        if [[ -f $file ]]; then
            config_file=$file
            break
        fi
    done

    if [[ -z $config_file ]]; then
        print_message warning "No config file found for $current_shell. You may need to manually add to PATH:"
        print_message info "  export PATH=$INSTALL_DIR:\$PATH"
    elif [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        case $current_shell in
            fish)
                add_to_path "$config_file" "fish_add_path $INSTALL_DIR"
            ;;
            *)
                add_to_path "$config_file" "export PATH=$INSTALL_DIR:\$PATH"
            ;;
        esac
    fi
fi

if [ -n "${GITHUB_ACTIONS-}" ] && [ "${GITHUB_ACTIONS}" == "true" ]; then
    echo "$INSTALL_DIR" >> $GITHUB_PATH
    print_message info "Added $INSTALL_DIR to \$GITHUB_PATH"
fi

echo ""
echo -e "${CYAN}  ╭─────────────────────────────────────╮${NC}"
echo -e "${CYAN}  │${NC}  ${GREEN}✓${NC} cz-cli ${MUTED}v${specific_version}${NC} installed          ${CYAN}│${NC}"
echo -e "${CYAN}  ╰─────────────────────────────────────╯${NC}"
echo ""
echo -e "  ${MUTED}Get started:${NC}"
echo ""
echo -e "  cz-cli setup          ${MUTED}# Configure connection${NC}"
echo -e "  cz-cli status         ${MUTED}# Verify connection${NC}"
echo -e "  cz-cli agent run \"…\"  ${MUTED}# Ask AI to operate warehouse${NC}"
echo -e "  cz-agent run \"…\"      ${MUTED}# Shortcut for: cz-cli agent${NC}"
echo ""
echo -e "  ${MUTED}Docs: ${NC}https://www.yunqi.tech/documents/setup_cz_cli"
echo ""
