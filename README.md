# 司命 · 问时

> 拿不定主意时，说给司命听。可以掷钱起一卦，也可以依生辰观命，看这件事宜行、待时还是宜止——决定在你。

一个帮用户做决定的对话产品，有两种互不相干的问法，每问一事先择其一：

- **起卦**：不需要生辰。静心后亲手掷三枚铜钱六次成卦，司命按朱熹变爻规则取《周易》经文，只依卦理用三句文言作答；用户择「行」或「止」。
- **观命**：第一次在生辰帖上选定生辰并排盘，之后依命盘与流年流月判断时机，三句文言作答；择「行」时以竖写的吉日笺给出三个行动吉日。

两者都可以追问；决定之后，下一件事重新选择问法。整个过程以水墨视频衬底，没有声音。

设计文档：[`docs/superpowers/specs/2026-10-02-bazi-decision-design.md`](docs/superpowers/specs/2026-10-02-bazi-decision-design.md)。素材提示词写在 [`prototype/scripts/generate-media.mjs`](prototype/scripts/generate-media.mjs) 里。

## 产品原则

- **像聊天，不像填表。** 问题和时间范围从对话中读取；只有观命需要在「生辰帖」上定一次生辰，起卦不问生辰。
- **依据先于结论。** 排盘、打分、时机和吉日全部由本地代码计算，结论（宜行 / 待时 / 宜止）模型不能改；模型只把依据说成人话。
- **决定在用户。** 司命只给倾向，「行」「止」由用户自己点。
- **命理只是一个视角。** 不断言吉凶、不制造恐惧；涉及医疗、法律、钱财时提醒以专业意见为准，危机信号直接转为安全回应。

## 结构

| 位置 | 作用 |
| --- | --- |
| `prototype/lib/bazi.mjs` | 排盘（基于 [`lunar-javascript`](https://github.com/6tail/lunar-javascript)，含真太阳时）、简化扶抑喜用、决策信号、逐月时机、结论、择日 |
| `prototype/lib/gua.mjs`、`lib/zhouyi.json` | 掷钱成卦、找变卦，按朱熹《易学启蒙》的变爻规则选出该读的经文；经文为《周易》通行本（维基文库校本，繁转简，异文按王弼本），由 `scripts/build-zhouyi.mjs` 生成 |
| `prototype/lib/extract.mjs` | 从口语中读取生辰（含农历、时辰、出生地）、事情类型、时间范围 |
| `prototype/lib/guide.mjs` | 对话阶段：问心 → 择法（起卦 / 观命）→ 起卦：掷钱成卦；观命：生辰帖与确认 → 解读 → 追问 → 决定 |
| `prototype/lib/agent.mjs` | 解读与追问的模型提示词、安全分流 |
| `prototype/app/api/guide/route.ts` | 流式接口；未配置模型或模型失败时用本地文案兜底 |
| `prototype/app/page.tsx`、`components/siming/` | 水墨山水场景、毛笔八卦、对话与卡片；`login.tsx` 为手机验证码登录框 |
| `prototype/lib/aliyun-sms.mjs` | 阿里云号码认证服务 · 短信认证（`SendSmsVerifyCode` / `CheckSmsVerifyCode`），RPC 签名直接调用，不依赖 SDK |
| `prototype/lib/db.mjs`、`lib/auth.mjs` | SQLite（Node 内置 `node:sqlite`）中的用户、登录会话、问事记录与发码频率限制；会话 cookie 与手机号校验 |
| `prototype/app/api/auth/*`、`app/api/records` | 发码、登录、当前用户、退出；问事记录的读取、保存与标记 |

## 登录与记录

- 问事、择法、填生辰都不需要登录；**出结果时须登录**：卦象、命盘、解读、追问和吉日都由服务端把关，未登录时 `/api/guide` 只返回 `auth` 事件且不推进对话，前端弹出登录框，登录后原样重发这一步。
- 登录用手机号 + 短信验证码，首次登录即注册。验证码由阿里云生成和校验，本服务不保存验证码。会话令牌只存其 SHA-256，cookie 为 `HttpOnly; SameSite=Lax`（HTTPS 下加 `Secure`），有效期 30 天。
- 频率限制：每个号码 60 秒一次、每天 10 次；每个 IP 每小时 30 次；每个号码 10 分钟内错 5 次即暂停校验。阿里云侧另有自己的限流。
- 问事记录（含司命之辞）随账号存于服务端，换设备登录也能看到；登录时会把本机 localStorage 里的旧记录并入账号。生辰仍只存于本机。

### 阿里云配置

1. 开通[号码认证服务](https://dypns.console.aliyun.com/)，在「短信认证」中查看赠送的签名名称和模板 CODE（模板需包含 `${code}` 和 `${min}`）。
2. 在 RAM 新建子账号，只授予 `AliyunDypnsFullAccess`，生成 AccessKey。
3. 在 `.env` 填写 `ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_TEMPLATE_CODE`。部署脚本会检查这四项。

本地开发不想真发短信时，在 `.env` 加 `SMS_MOCK=1`，验证码固定为 `000000`（生产环境开启会直接报错）。

## 画面素材

画面是黑白水墨风格：宣纸底、浓淡墨色的山水，八卦用毛笔笔触画；标题、干支和按钮用书法字体（马善政楷书，由 next/font 下载后放在自己服务器上），并通过 SVG 滤镜做出毛边和墨晕。画面只有景，没有人物。背景、排盘和分享图都由 `prototype/scripts/generate-media.mjs` 通过 nevatoken 生成：静图用 `gpt-image-2`，动态循环和排盘视频用 happy horse 图生视频（`happyhorse-1.1-i2v`）。视频会去掉音轨，并做成往返循环。原图存在 `generated-art/ink/`，网页用的文件在 `prototype/public/`。素材缺失时，页面自动退回 CSS 绘制的场景。

```bash
cd prototype
node --env-file=.env scripts/generate-media.mjs              # 生成所有缺失的素材
node --env-file=.env scripts/generate-media.mjs --force og   # 重新生成指定素材
```

视频生成约需 2–3 分钟。中途断网时，按日志提示用 `--resume=<任务ID>` 接回原任务，不会重复提交。

## 本地运行

需要 Node.js 22.13 或更高版本：

```bash
cd prototype
npm install
cp .env.example .env   # 填入 NEVA_API_KEY；不填也能跑，解读改用本地文案
npm run dev
```

模型默认通过 `https://nevatoken.com/v1/chat/completions` 调用 `MaaS_GP_6_luna_20260922`，可在 `.env` 中覆盖。凭证只在服务端读取。

验证命令：`npm test`、`npx tsc --noEmit`、`npm run lint` 和 `npm run build`。

## Node 服务器发布

在本机项目根目录执行：

```bash
./deploy/deploy.sh --dry-run   # 只检查打包，不连接服务器
./deploy/deploy.sh            # 发布到 root@212.64.23.79:/opt/angel_devil
```

服务器需要 Linux、systemd、安装到系统路径的 Node.js >=22.13、npm、curl 和 tar；SSH 账号需要 root 或免密 sudo。使用服务器现有 SSH 密钥、口令或扫码认证。首次发布读取本机 `prototype/.env`，通过 SSH 单独传输配置，后续保留服务器已有配置。

自定义登录和配置：

```bash
SSH_TARGET=ubuntu@212.64.23.79 SSH_KEY="$HOME/.ssh/id_ed25519" ./deploy/deploy.sh
ENV_FILE=/path/to/server.env ./deploy/deploy.sh --update-env
# 使用 ~/.ssh/config 中的别名也可以：SSH_TARGET=angel-server ./deploy/deploy.sh
```

脚本上传源码和依赖锁文件，在服务器执行 `npm ci`、单元测试和生产构建。页面与 `GET /api/health` 检查通过后，才切换正式版本，启动或重启 `angel-devil.service`。运行失败会恢复旧版本及环境配置。旧版本保留在 `releases/`，发布锁防止同时部署。

服务器目录：

```text
/opt/angel_devil/
├── current -> releases/<版本号>
├── releases/<版本号>/       # 源码、Linux 依赖和生产构建
├── shared/.env              # 仅 root 和服务账号可读
└── shared/data/siming.db    # 用户、会话与问事记录（SQLite，跨版本保留，请定期备份）
```

默认访问地址为 `http://212.64.23.79:3000`，需要在服务器防火墙及腾讯云安全组允许 TCP 3000。可用 `APP_PORT=其他端口` 覆盖。服务由专用账号 `angel-devil` 运行，systemd 提供开机启动和异常重启。在服务器查看状态与日志：

```bash
sudo systemctl status angel-devil
sudo journalctl -u angel-devil -f
sudo systemctl restart angel-devil
```

若前面接 Nginx，可用 `APP_HOST=127.0.0.1` 发布，并在 `shared/.env` 设置 `VINEXT_TRUST_PROXY=1`；Nginx 应转发原始 `Host`、`X-Forwarded-Proto`，并关闭流式接口的代理缓冲。
- [ ] 完成 MVP
