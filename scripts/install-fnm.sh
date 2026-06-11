#!/bin/bash
# System-wide fnm + Node.js setup for Dotplane install scripts.
# Source from install.sh / install-agent.sh, then call install_dotplane_node.

install_dotplane_node() {
  local node_version="${1:-20}"
  local fnm_bin="/usr/local/bin/fnm"

  export FNM_DIR="${FNM_DIR:-/usr/local/share/fnm}"
  mkdir -p "$FNM_DIR"

  if [[ ! -x "$fnm_bin" ]]; then
    local arch fnm_file fnm_zip fnm_unzip
    arch="$(uname -m)"
    case "$arch" in
      x86_64)     fnm_file="fnm-linux" ;;
      aarch64)    fnm_file="fnm-arm64" ;;
      armv7*|arm) fnm_file="fnm-arm32" ;;
      *)
        echo "Unsupported architecture for fnm: $arch" >&2
        return 1
        ;;
    esac
    fnm_zip="$(mktemp)"
    fnm_unzip="$(mktemp -d)"
    curl -fsSL "https://github.com/Schniz/fnm/releases/latest/download/${fnm_file}.zip" -o "$fnm_zip"
    unzip -q "$fnm_zip" -d "$fnm_unzip"
    if [[ -f "$fnm_unzip/fnm" ]]; then
      install -m 755 "$fnm_unzip/fnm" "$fnm_bin"
    elif [[ -f "$fnm_unzip/${fnm_file}/fnm" ]]; then
      install -m 755 "$fnm_unzip/${fnm_file}/fnm" "$fnm_bin"
    else
      echo "fnm binary not found in release archive" >&2
      rm -f "$fnm_zip"
      rm -rf "$fnm_unzip"
      return 1
    fi
    rm -f "$fnm_zip"
    rm -rf "$fnm_unzip"
  fi

  export PATH="/usr/local/bin:${PATH}"
  # shellcheck disable=SC1090
  eval "$(fnm env --shell bash)"
  fnm install "$node_version"
  fnm default "$node_version"
  # Stable path for systemd ExecStart (fnm no longer ships a `which` subcommand).
  NODE_BIN="${FNM_DIR}/aliases/default/bin/node"
  if [[ ! -x "$NODE_BIN" ]]; then
    NODE_BIN="$(command -v node)"
  fi
  if [[ ! -x "$NODE_BIN" ]]; then
    echo "Node binary not found after fnm install" >&2
    return 1
  fi
  export NODE_BIN
}
