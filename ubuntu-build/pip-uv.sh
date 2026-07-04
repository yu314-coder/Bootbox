#!/bin/sh
# `pip` -> uv. uv is a static Rust binary with no Python import tree, so `pip install X` runs in
# seconds instead of slowly importing pip's vendored `rich` under emulation. Common pip subcommands
# route to `uv pip`; anything uv pip doesn't implement falls through to the real pip so nothing breaks.
case "$1" in
  install|uninstall|list|show|freeze|check) exec uv pip "$@" ;;
  *) exec /usr/bin/pip "$@" ;;
esac
