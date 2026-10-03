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
| `prototype/app/page.tsx`、`components/siming/` | 水墨山水场景、毛笔八卦、对话与卡片；`login.tsx` 为邮箱密码登录 / 注册框 |
| `prototype/lib/db.mjs`、`lib/auth.mjs`、`lib/password.mjs` | SQLite（Node 内置 `node:sqlite`）中的用户、登录会话、问事记录与登录频率限制；会话 cookie、邮箱校验、scrypt 密码哈希 |
| `prototype/app/api/auth/*`、`app/api/records`、`app/api/profile` | 注册、登录、当前用户（含账号生辰）、退出；问事记录的读取、保存与标记；账号生辰的并入与忘却 |

## 登录与记录

- 问事、择法不需要登录；**填生辰、掷钱之前须登录**，卦象、命盘、解读、追问和吉日更是如此。都由服务端把关（`needsAccount`），未登录时 `/api/guide` 只返回 `auth` 事件且不推进对话，前端弹出登录框，登录后原样重发这一步。登录放在填生辰之前，老用户的生辰随账号回来，不必再填。
- 用邮箱 + 密码注册和登录，不发验证邮件，邮箱不做真实性验证，密码暂不能找回。密码至少 8 位，以 scrypt 加盐哈希保存。会话令牌只存其 SHA-256，cookie 为 `HttpOnly; SameSite=Lax`（HTTPS 下加 `Secure`），有效期 30 天。
- 频率限制：每个邮箱 15 分钟内输错 5 次、每个 IP 15 分钟内输错 30 次即暂停登录；每个 IP 每小时最多注册 10 个账号。邮箱不存在与密码错误给同样的提示。
- 生辰与问事记录（含司命之辞）随账号存于服务端（`users.birth`、`records`），换设备登录也能看到。观命时以账号所存生辰为准。
- 登录时若本机 localStorage 尚存不属于任何账号的生辰或记录，先问「并入此账号」还是「舍去」，不自动合并，以免共用设备时混入他人的资料。
- 退出时清掉本机的生辰、记录与当前对话。

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

## 发布

本机的 `/root/project/siming` 就是线上版本：systemd 服务 `angel-devil.service` 直接从 `prototype/` 运行，监听 `127.0.0.1:3000`，前面由反向代理转发（`.env` 中 `VINEXT_TRUST_PROXY=1`）。

```text
prototype/.env              # 线上配置（不入 git）
prototype/data/siming.db    # 用户、会话、生辰与问事记录（SQLite，不入 git，请定期备份）
prototype/dist/             # 生产构建
```

发布新改动：

```bash
cd prototype
npm test && npm run build
systemctl restart angel-devil
curl -s localhost:3000/api/health
```

查看状态与日志：

```bash
systemctl status angel-devil
journalctl -u angel-devil -f
```
- [ ] 完成 MVP
