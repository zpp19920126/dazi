#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
node tools/extract.mjs
# 本机 node 的 `node --test tests/` 目录形式不可用（把目录当入口模块加载），改用 glob 形式
node --test tests/*.test.mjs
