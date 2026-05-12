# 照见：私密 AI 自我照见工具

这个网站由两部分组成：

- 前端：`index.html`、`styles.css`、`app.js`、`config.js`，继续放在 GitHub Pages。
- 后端：Supabase Auth / Database / Edge Functions，负责邮箱登录、保存档案、调用 DeepSeek API。

## 你现在需要做什么

下面按“小白步骤”走就可以。先不用理解所有代码，只要照顺序做。

## 第 1 步：确认 DeepSeek API Key

1. 打开 DeepSeek 开放平台控制台。
2. 创建或复制一个 API Key。
3. 先把它放在你自己的记事本里，等第 4 步会粘贴到 Supabase。

注意：DeepSeek API Key 不能放进 `config.js`，也不能放进 GitHub Pages。它只能放在 Supabase secrets 里。

## 第 2 步：确认前端配置

打开 `config.js`，确认里面是你的 Supabase 项目：

```js
window.APP_CONFIG = {
  supabaseUrl: "https://djxhsjcloaetuxlmenmh.supabase.co",
  supabaseAnonKey: "你的 Supabase anon public key",
  functionsBaseUrl: "https://djxhsjcloaetuxlmenmh.supabase.co/functions/v1"
};
```

`functionsBaseUrl` 不能留空。留空时页面只会走本地兜底，看起来就像“静态页面”。

## 第 3 步：确认 Supabase 登录跳转

进入 Supabase 后台：

1. 打开 `Authentication`。
2. 打开 `URL Configuration`。
3. `Site URL` 填你的网站地址，例如：

```text
https://zyweimian.github.io/my-website/
```

4. `Redirect URLs` 也加入同一个地址：

```text
https://zyweimian.github.io/my-website/
```

如果你本地测试，也可以额外加入：

```text
http://127.0.0.1:4175/
```

邮箱能收到信，只说明 Supabase 发信成功；登录后页面是否变成“已登录”，取决于这里的跳转地址和前端回调处理。

## 第 4 步：把 DeepSeek Key 放进 Supabase

在项目根目录打开终端，先登录 Supabase：

```bash
supabase login
```

然后设置 DeepSeek 相关 secrets：

```bash
supabase secrets set DEEPSEEK_API_KEY=你的_DeepSeek_API_Key --project-ref djxhsjcloaetuxlmenmh
supabase secrets set DEEPSEEK_MODEL=deepseek-v4-flash --project-ref djxhsjcloaetuxlmenmh
supabase secrets set DEEPSEEK_BASE_URL=https://api.deepseek.com --project-ref djxhsjcloaetuxlmenmh
```

如果你要使用更强但可能更贵/更慢的模型，可以改成：

```bash
supabase secrets set DEEPSEEK_MODEL=deepseek-v4-pro --project-ref djxhsjcloaetuxlmenmh
```

第一版建议先用 `deepseek-v4-flash`，速度和成本更适合这个网站。

## 第 5 步：部署 Edge Functions

运行：

```bash
supabase functions deploy reflect --project-ref djxhsjcloaetuxlmenmh --no-verify-jwt --use-api
supabase functions deploy chat --project-ref djxhsjcloaetuxlmenmh --no-verify-jwt --use-api
supabase functions deploy telemetry --project-ref djxhsjcloaetuxlmenmh --no-verify-jwt --use-api
supabase functions deploy entries --project-ref djxhsjcloaetuxlmenmh --use-api
supabase functions deploy account-data --project-ref djxhsjcloaetuxlmenmh --use-api
```

说明：

- `reflect`：生成“照见”回应。
- `chat`：继续追问。
- `telemetry`：记录匿名访问事件。
- `entries`：读取和删除你的私密档案。
- `account-data`：清空全部档案。

## 第 6 步：重新上传前端到 GitHub Pages

把这些文件更新到 GitHub Pages 仓库：

```text
index.html
styles.css
app.js
config.js
```

如果你用 Git：

```bash
git add index.html styles.css app.js config.js supabase README.md
git commit -m "Use DeepSeek API for private reflection"
git push
```

等 GitHub Pages 部署完成后，再打开：

```text
https://zyweimian.github.io/my-website/
```

## 第 7 步：测试

按这个顺序测：

1. 不登录，输入一句话，点击“照见”。
2. 如果成功接入 DeepSeek，页面不会提示 `fallback` 错误。
3. 点击“登录保存”，输入邮箱。
4. 打开邮件里的链接。
5. 页面右上角应该从“登录保存”变成“退出”。
6. 再输入一句话并点击“照见”。
7. 右侧“私密档案”应该出现新记录。

## 常见错误

- `missing_deepseek_api_key`
  - Supabase 没有读到 `DEEPSEEK_API_KEY`。
  - 重新运行第 4 步，然后重新部署第 5 步的 `reflect` 和 `chat`。

- `deepseek_http_401`
  - DeepSeek API Key 无效，或复制时多了空格。

- `deepseek_http_402`
  - DeepSeek 账户余额不足或计费不可用。

- `deepseek_http_429`
  - 请求太多，被限流了，等一会再试。

- `deepseek_http_404`
  - 模型名不对。先使用 `deepseek-v4-flash`。

- 登录后还是显示“登录保存”
  - 回到第 3 步检查 `Site URL` 和 `Redirect URLs`。
  - 确认 GitHub Pages 上的 `app.js` 已经是最新版。

- 页面仍然像静态页面
  - 检查 `config.js` 的 `functionsBaseUrl` 是否为空。
  - 打开浏览器开发者工具，看 Network 里有没有请求 `/functions/v1/reflect`。

## 本地预览

当前 Windows 中文路径下，`python -m http.server` 可能触发 Python 3.7 编码错误。建议用 Node 或 VS Code Live Server。

用 Node 简单预览：

```bash
node -e "const http=require('http'),fs=require('fs'),path=require('path');http.createServer((req,res)=>{const file=path.join(process.cwd(),req.url==='/'?'index.html':req.url);fs.readFile(file,(err,data)=>{if(err){res.statusCode=404;res.end('not found')}else res.end(data)})}).listen(4175,'127.0.0.1')"
```

然后打开：

```text
http://127.0.0.1:4175/
```

## 验收清单

- 未登录用户可以生成一次性回应。
- 登录邮件能收到，点击后页面变成“退出”。
- 登录用户生成后，右侧出现私密档案。
- 勾选“参考过去记录”之前，后端不会读取历史记录。
- 单条删除和清空全部档案可用。
- 页面不再出现乱码。
- DeepSeek 接入成功时，不再显示 `missing_deepseek_api_key` 或 `deepseek_http_*`。
