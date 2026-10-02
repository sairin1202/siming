#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd -- "$SCRIPT_DIR/../prototype" && pwd)

SSH_TARGET=${SSH_TARGET:-root@212.64.23.79}
SSH_PORT=${SSH_PORT:-}
SSH_KEY=${SSH_KEY:-}
DEPLOY_DIR=${DEPLOY_DIR:-/opt/angel_devil}
APP_HOST=${APP_HOST:-0.0.0.0}
APP_PORT=${APP_PORT:-3000}
ENV_FILE=${ENV_FILE:-$PROJECT_DIR/.env}
SSH_BATCH_MODE=${SSH_BATCH_MODE:-no}
UPDATE_ENV=0
DRY_RUN=0

usage() {
  cat <<'HELP'
用法: ./deploy/deploy.sh [--dry-run] [--update-env]

默认发布到 root@212.64.23.79:/opt/angel_devil，服务监听 0.0.0.0:3000。
首次发布自动上传本地 prototype/.env；后续保留服务器 shared/.env。
--update-env  使用本地 ENV_FILE 替换服务器环境配置（失败时恢复旧配置）
--dry-run     只打包检查，不连接服务器

可通过环境变量覆盖:
  SSH_TARGET=root@212.64.23.79    SSH 账号@地址，也支持 ~/.ssh/config 别名
  SSH_PORT=22                   可选：覆盖 SSH 配置中的端口
  SSH_KEY=/path/to/private_key   SSH 私钥路径（默认使用 SSH 配置）
  SSH_BATCH_MODE=yes             禁用交互登录，适合 CI
  DEPLOY_DIR=/opt/angel_devil     服务器安装目录
  APP_HOST=0.0.0.0               或 127.0.0.1，供反向代理使用
  APP_PORT=3000                  应用端口，1024–65535
  ENV_FILE=/path/to/.env         本地环境配置路径

服务器需 Linux、systemd、Node.js >=22.13、npm、curl、tar；账号需 root
或免密 sudo。私钥登录/扫码认证按服务器现有 SSH 配置执行。
HELP
}

die() { printf '部署失败: %s\n' "$*" >&2; exit 1; }
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --update-env) UPDATE_ENV=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $arg（使用 --help 查看帮助）" ;;
  esac
done

[[ "$SSH_TARGET" =~ ^[a-zA-Z0-9_@.-]+$ && "$SSH_TARGET" != -* ]] || die 'SSH_TARGET 格式无效'
[[ "$DEPLOY_DIR" =~ ^/[a-zA-Z0-9_-]+(/[a-zA-Z0-9_.-]+)+$ && "$DEPLOY_DIR" != */..* ]] || die 'DEPLOY_DIR 必须是至少两级的绝对路径，不能包含 ..'
[[ "$APP_HOST" == 0.0.0.0 || "$APP_HOST" == 127.0.0.1 ]] || die 'APP_HOST 只支持 0.0.0.0 或 127.0.0.1'
if [[ -n "$SSH_PORT" ]]; then
  if ! [[ "$SSH_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || ((SSH_PORT > 65535)); then die 'SSH_PORT 无效'; fi
fi
if ! [[ "$APP_PORT" =~ ^[1-9][0-9]{3,4}$ ]] || ((APP_PORT < 1024 || APP_PORT > 65535)); then die 'APP_PORT 必须在 1024–65535 之间'; fi
[[ "$SSH_BATCH_MODE" == yes || "$SSH_BATCH_MODE" == no ]] || die 'SSH_BATCH_MODE 只支持 yes 或 no'
[[ -z "$SSH_KEY" || -f "$SSH_KEY" ]] || die 'SSH_KEY 文件不存在'
[[ "$UPDATE_ENV" == 0 || -f "$ENV_FILE" ]] || die '--update-env 需要有效的 ENV_FILE'
for command in ssh scp tar; do
  command -v "$command" >/dev/null || die "缺少本地命令: $command"
done

umask 077
# macOS 的 TMPDIR 较长，SSH 的 ControlPath 有长度限制。
WORK_DIR=$(mktemp -d /tmp/angel-devil-deploy.XXXXXXXX)
REMOTE_UPLOAD=''
SSH_READY=0
SSH_OPTIONS=(-o ConnectTimeout=10 -o "BatchMode=$SSH_BATCH_MODE"
  -o ControlMaster=auto -o ControlPersist=300 -o "ControlPath=$WORK_DIR/ssh")
if [[ -n "$SSH_PORT" ]]; then SSH_OPTIONS+=(-o "Port=$SSH_PORT"); fi
if [[ -n "$SSH_KEY" ]]; then SSH_OPTIONS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes); fi

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$SSH_READY" == 1 ]]; then
    if [[ -n "$REMOTE_UPLOAD" ]]; then
      ssh "${SSH_OPTIONS[@]}" -o BatchMode=yes "$SSH_TARGET" "rm -rf -- '$REMOTE_UPLOAD'" </dev/null >/dev/null 2>&1 || true
    fi
    ssh "${SSH_OPTIONS[@]}" -O exit "$SSH_TARGET" </dev/null >/dev/null 2>&1 || true
  fi
  rm -rf -- "$WORK_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${WORK_DIR##*.}"
printf '打包 Node 应用 → %s:%s（版本 %s）\n' "$SSH_TARGET" "$DEPLOY_DIR" "$RELEASE_ID"
COPYFILE_DISABLE=1 tar -czf "$WORK_DIR/app.tar.gz" -C "$PROJECT_DIR" \
  --exclude='.env' --exclude='.env.*' --exclude='node_modules' --exclude='dist' \
  --exclude='.DS_Store' --exclude='.git' \
  package.json package-lock.json vite.config.ts next.config.ts tsconfig.json \
  app components hooks lib public scripts
tar -tzf "$WORK_DIR/app.tar.gz" > "$WORK_DIR/files.txt"
if excluded_files=$(LC_ALL=C awk '/(^|\/)\.env($|\.)|(^|\/)node_modules\// { print; found=1 } END { exit !found }' "$WORK_DIR/files.txt"); then
  die "源码压缩包包含应排除的文件: $excluded_files"
fi
if [[ -f "$ENV_FILE" ]]; then
  cp -- "$ENV_FILE" "$WORK_DIR/env"
  chmod 600 "$WORK_DIR/env"
fi
if [[ "$DRY_RUN" == 1 ]]; then
  printf '打包检查通过: %s 个文件；源码包不包含 .env 和 node_modules。\n' "$(wc -l < "$WORK_DIR/files.txt" | tr -d ' ')"
  printf '环境配置: %s；后续发布%s服务器现有配置。\n' "${ENV_FILE}" "$(if [[ "$UPDATE_ENV" == 1 ]]; then printf '替换'; else printf '保留'; fi)"
  exit 0
fi

printf '连接服务器（如需扫码/口令，请完成 SSH 认证）…\n'
ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" true
SSH_READY=1
REMOTE_UPLOAD=$(ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" 'umask 077; mktemp -d /tmp/angel-devil-deploy.XXXXXXXX')
[[ "$REMOTE_UPLOAD" =~ ^/tmp/angel-devil-deploy\.[a-zA-Z0-9]+$ ]] || die '服务器返回了无效的临时目录'
scp "${SSH_OPTIONS[@]}" "$WORK_DIR/app.tar.gz" "$SCRIPT_DIR/remote.sh" "$SSH_TARGET:$REMOTE_UPLOAD/"
if [[ -f "$WORK_DIR/env" ]]; then
  scp -p "${SSH_OPTIONS[@]}" "$WORK_DIR/env" "$SSH_TARGET:$REMOTE_UPLOAD/env"
fi

# 所有参数先限制字符集合，再以单引号传给远程 shell；.env 永远不执行。
REMOTE_COMMAND="bash '$REMOTE_UPLOAD/remote.sh' '$DEPLOY_DIR' '$RELEASE_ID' '$APP_HOST' '$APP_PORT' '$UPDATE_ENV'"
# shellcheck disable=SC2029 # 仅将前面已校验的参数在本机拼接。
ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" "if [ \"\$(id -u)\" = 0 ]; then $REMOTE_COMMAND; else sudo -n $REMOTE_COMMAND; fi"
printf '\n发布完成: %s:%s\n' "$SSH_TARGET" "$DEPLOY_DIR"
