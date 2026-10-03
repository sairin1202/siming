#!/usr/bin/env bash
# 由 deploy.sh 上传并调用，目标服务器上以 root 执行。
set -euo pipefail
umask 027

BASE=$1
RELEASE_ID=$2
HOST=$3
PORT=$4
UPDATE_ENV=$5
UPLOAD=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SERVICE=angel-devil.service
APP_USER=angel-devil
RELEASE="$BASE/releases/$RELEASE_ID"
SHARED_ENV="$BASE/shared/.env"
# 用户、登录会话和问事记录；放在 shared 下，跨版本保留。
DATA_DIR="$BASE/shared/data"
DB_PATH="$DATA_DIR/siming.db"
UNIT_FILE="/etc/systemd/system/$SERVICE"
CHECK_UNIT="angel-devil-check-$RELEASE_ID"
OLD_RELEASE=''
SWITCHED=0
ENV_CHANGED=0
UNIT_CHANGED=0
WAS_ENABLED=0

fail() { printf '部署失败: %s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || fail '需要 root 或免密 sudo'
[[ "$BASE" =~ ^/[a-zA-Z0-9_-]+(/[a-zA-Z0-9_.-]+)+$ && "$BASE" != */..* ]] || fail '安装目录无效'
[[ "$RELEASE_ID" =~ ^[a-zA-Z0-9-]+$ ]] || fail '版本号无效'
[[ "$HOST" == 0.0.0.0 || "$HOST" == 127.0.0.1 ]] || fail '监听地址无效'
if ! [[ "$PORT" =~ ^[1-9][0-9]{3,4}$ ]] || ((PORT < 1024 || PORT > 65535)); then fail '端口无效'; fi
[[ "$UPDATE_ENV" == 0 || "$UPDATE_ENV" == 1 ]] || fail '配置参数无效'
for command in node npm systemctl systemd-run runuser curl tar flock useradd getent; do
  command -v "$command" >/dev/null || fail "缺少 $command；请先安装服务器运行环境"
done
[[ -d /run/systemd/system ]] || fail '服务器未运行 systemd'
NODE_BIN=$(command -v node)
NPM_BIN=$(command -v npm)
case "$(readlink -f "$NODE_BIN")" in
  /root/*|/home/*|/run/user/*) fail '请将 Node 安装到系统路径（例如 /usr/local/bin），systemd 的 ProtectHome 会隔离用户目录' ;;
esac
RUNTIME_PATH="$(dirname "$NODE_BIN"):$(dirname "$NPM_BIN"):/usr/local/bin:/usr/bin:/bin"
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major>22 || (major===22 && minor>=13) ? 0 : 1)' || fail 'Node.js 需要 >=22.13'

install -d -m 755 "$BASE"
exec 9>"$BASE/.deploy.lock"
flock -n 9 || fail '已有发布任务正在运行'
[[ ! -e "$RELEASE" ]] || fail '版本目录已存在'
if [[ -e "$BASE/current" && ! -L "$BASE/current" ]]; then fail 'current 已存在且不是版本软链接'; fi
if [[ -L "$BASE/current" ]]; then
  OLD_RELEASE=$(readlink -f "$BASE/current")
  [[ "$OLD_RELEASE" == "$BASE"/releases/* && -d "$OLD_RELEASE" ]] || fail 'current 未指向有效的 releases 目录'
fi
if [[ -e "$UNIT_FILE" ]] && ! grep -Fq "WorkingDirectory=$BASE/current" "$UNIT_FILE"; then
  fail 'angel-devil.service 已属于其他目录，请先检查已有服务'
fi
if systemctl is-enabled --quiet "$SERVICE"; then WAS_ENABLED=1; fi
getent passwd "$APP_USER" >/dev/null || useradd --system --user-group --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
runuser -u "$APP_USER" -- "$NODE_BIN" --version >/dev/null || fail '服务账号无法执行 Node，请将 Node/npm 安装到可访问的系统路径'
install -d -m 755 "$BASE/releases"
install -d -m 750 -o root -g "$APP_USER" "$BASE/shared"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$BASE/.npm-cache"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR"
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$RELEASE"
if [[ -f "$SHARED_ENV" ]]; then cp -p "$SHARED_ENV" "$UPLOAD/previous.env"; fi
if [[ -f "$UNIT_FILE" ]]; then cp -p "$UNIT_FILE" "$UPLOAD/previous.service"; fi

cleanup() {
  local status=$?
  trap - EXIT
  systemctl stop "$CHECK_UNIT" >/dev/null 2>&1 || true
  systemctl reset-failed "$CHECK_UNIT" >/dev/null 2>&1 || true
  if ((status != 0)); then
    printf '发布未完成，正在恢复原版本…\n' >&2
    if [[ "$ENV_CHANGED" == 1 ]]; then
      if [[ -f "$UPLOAD/previous.env" ]]; then
        install -m 640 -o root -g "$APP_USER" "$UPLOAD/previous.env" "$SHARED_ENV"
      else
        rm -f -- "$SHARED_ENV"
      fi
    fi
    if [[ "$UNIT_CHANGED" == 1 ]]; then
      if [[ -f "$UPLOAD/previous.service" ]]; then cp -p "$UPLOAD/previous.service" "$UNIT_FILE"; else rm -f -- "$UNIT_FILE"; fi
      systemctl daemon-reload || true
    fi
    if [[ "$SWITCHED" == 1 ]]; then
      if [[ -n "$OLD_RELEASE" ]]; then
        ln -s "$OLD_RELEASE" "$BASE/.rollback-$RELEASE_ID"
        mv -Tf "$BASE/.rollback-$RELEASE_ID" "$BASE/current"
        systemctl restart "$SERVICE" || printf '原服务重启失败，请检查 systemctl status %s\n' "$SERVICE" >&2
      else
        systemctl stop "$SERVICE" >/dev/null 2>&1 || true
        rm -f -- "$BASE/current"
      fi
    fi
    if [[ "$WAS_ENABLED" == 0 ]]; then systemctl disable "$SERVICE" >/dev/null 2>&1 || true; fi
    rm -rf -- "$RELEASE"
  fi
  rm -f -- "$BASE/.current-$RELEASE_ID" "$BASE/.rollback-$RELEASE_ID" "$BASE/shared/.env.next"
  rm -f -- "$UPLOAD/previous.env" "$UPLOAD/previous.service" "$UPLOAD/env"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf '准备新版本 %s…\n' "$RELEASE_ID"
tar -xzf "$UPLOAD/app.tar.gz" -C "$RELEASE" --no-same-owner
if [[ -f "$SHARED_ENV" && "$UPDATE_ENV" == 0 ]]; then
  install -m 640 -o "$APP_USER" -g "$APP_USER" "$SHARED_ENV" "$RELEASE/.env"
elif [[ -f "$BASE/.env" && "$UPDATE_ENV" == 0 ]]; then
  install -m 640 -o "$APP_USER" -g "$APP_USER" "$BASE/.env" "$RELEASE/.env"
elif [[ -f "$UPLOAD/env" ]]; then
  install -m 640 -o "$APP_USER" -g "$APP_USER" "$UPLOAD/env" "$RELEASE/.env"
else
  fail '首次发布需要本地 ENV_FILE，或预先配置服务器 shared/.env'
fi
chown -R "$APP_USER:$APP_USER" "$RELEASE"
cd "$RELEASE"
run_app() {
  runuser -u "$APP_USER" -- env -i "HOME=$BASE" "USER=$APP_USER" "LOGNAME=$APP_USER" \
    "PATH=$RUNTIME_PATH" "npm_config_cache=$BASE/.npm-cache" "$@"
}
# 服务安装包来自源码与 lock 文件，不上传本机 node_modules。
# shellcheck disable=SC2016 # 此处是 JavaScript 模板字符串。
run_app "$NODE_BIN" --env-file=.env --input-type=module -e '
  for (const key of ["NEVA_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    if (!process.env[key]?.trim()) {
      console.error(`缺少环境配置: ${key}`); process.exit(1);
    }
  }
'
run_app "$NPM_BIN" ci --include=dev --no-audit --no-fund
run_app "$NPM_BIN" test
run_app "$NPM_BIN" run build

CHECK_PORT=$(run_app "$NODE_BIN" --input-type=module -e 'import net from "node:net"; const server=net.createServer(); server.listen(0,"127.0.0.1",()=>{console.log(server.address().port);server.close()})')
systemd-run --quiet --unit="$CHECK_UNIT" --uid="$APP_USER" --gid="$APP_USER" \
  --working-directory="$RELEASE" --setenv=NODE_ENV=production --setenv="PATH=$RUNTIME_PATH" \
  --setenv="DEPLOYMENT_ID=$RELEASE_ID" --setenv="SIMING_DB_PATH=$DB_PATH" \
  "$NODE_BIN" "$RELEASE/node_modules/vinext/dist/cli.js" start --hostname 127.0.0.1 --port "$CHECK_PORT"
wait_ready() {
  local port=$1 unit=$2 attempt
  for ((attempt=1; attempt<=30; attempt++)); do
    if systemctl is-active --quiet "$unit" && \
       curl --fail --silent --max-time 5 --dump-header "$UPLOAD/health.headers" "http://127.0.0.1:$port/api/health" >/dev/null && \
       grep -Fiq "x-deployment-id: $RELEASE_ID" "$UPLOAD/health.headers" && \
       curl --fail --silent --max-time 5 "http://127.0.0.1:$port/" >/dev/null && \
       systemctl is-active --quiet "$unit"; then return 0; fi
    if systemctl is-failed --quiet "$unit"; then break; fi
    sleep 2
  done
  printf '页面或数据库健康检查未通过: %s\n' "$unit" >&2
  # 应用日志可能含第三方响应，不在发布输出中自动打印。
  printf '在服务器查看日志: journalctl -u %s -n 80 --no-pager\n' "$unit" >&2
  return 1
}
wait_ready "$CHECK_PORT" "$CHECK_UNIT"
systemctl stop "$CHECK_UNIT"

if [[ ! -f "$SHARED_ENV" || "$UPDATE_ENV" == 1 ]]; then
  ENV_CHANGED=1
  install -m 640 -o root -g "$APP_USER" "$RELEASE/.env" "$BASE/shared/.env.next"
  mv -f "$BASE/shared/.env.next" "$SHARED_ENV"
fi
chown root:"$APP_USER" "$SHARED_ENV"
chmod 640 "$SHARED_ENV"
rm -f -- "$RELEASE/.env"
ln -s "$SHARED_ENV" "$RELEASE/.env"

cat > "$UPLOAD/new.service" <<UNIT
[Unit]
Description=Angel Devil Node service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/current
Environment=NODE_ENV=production
Environment=PATH=$RUNTIME_PATH
Environment=DEPLOYMENT_ID=$RELEASE_ID
Environment=SIMING_DB_PATH=$DB_PATH
ExecStart=$NODE_BIN $BASE/current/node_modules/vinext/dist/cli.js start --hostname $HOST --port $PORT
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
UNIT_CHANGED=1
install -m 644 "$UPLOAD/new.service" "$UNIT_FILE"
systemctl daemon-reload
SWITCHED=1
ln -s "$RELEASE" "$BASE/.current-$RELEASE_ID"
mv -Tf "$BASE/.current-$RELEASE_ID" "$BASE/current"
systemctl restart "$SERVICE"
wait_ready "$PORT" "$SERVICE"
systemctl enable "$SERVICE" >/dev/null
printf '服务运行正常: %s，监听 %s:%s\n' "$SERVICE" "$HOST" "$PORT"
printf '当前版本: %s/current → %s\n' "$BASE" "$RELEASE"
printf '日志: journalctl -u %s -f\n' "$SERVICE"
