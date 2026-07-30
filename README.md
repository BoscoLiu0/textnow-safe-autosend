# TextNow 安全自动发短信（Mac 本机版）

这份脚本用于你自己的 TextNow 号码保号：在你的 MacBook 上保留一个独立的 Chrome 登录状态，每周只向 `config.json` 中的一个固定号码发送一次短信。

## 为什么不再使用旧 GitHub Actions 版本

旧项目把 TextNow 密码、Cookie 和第三方验证码服务放进 GitHub Secrets，并用 stealth/2captcha 绕过验证。TextNow 目前会在网页登录时显示 “Press and Hold” CAPTCHA，用于识别自动机器人。这个新版本：

- 不保存或上传 TextNow 密码；
- 不导出 Cookie；
- 不调用验证码破解服务；
- CAPTCHA 出现时会停止，要求你本人正常完成；
- 默认至少间隔 6 天，避免重复运行时连续发短信；
- 只允许配置一个美国或加拿大收件号码；
- 所有登录资料只保存在你的 Mac：`~/.textnow-safe-autosend/`。

> 注意：TextNow 没有面向个人用户的官方短信发送 API，网页布局或登录策略变化后，脚本可能需要更新。自动化也不能保证号码一定不会被回收。

## 第一次安装

需要 macOS、Google Chrome 和 Node.js 20 或更新版本。

打开“终端”，进入解压后的文件夹，然后执行：

```bash
npm install
cp config.example.json config.json
```

打开 `config.json`，填写：

```json
{
  "recipient": "+1你的收件号码",
  "message": "Keeping my TextNow number active.",
  "minimumDaysBetweenMessages": 6
}
```

收件号码必须是你本人或已经同意接收这条保号短信的人。

## 保存 TextNow 登录状态

```bash
npm run setup-login
```

Chrome 会打开 TextNow。你本人正常登录并完成人机验证，进入短信页面后回到终端按 Enter。脚本只保留这个 Chrome profile，不读取密码。

## 先测试一次

建议让浏览器保持可见：

```bash
npm run send:headed -- --force
```

确认对方收到后，再安装每周计划。

## 安装每周自动运行

下面的例子是每周一晚上 7:30（Mac 本地时间）运行：

```bash
npm run schedule -- --weekday 1 --hour 19 --minute 30
```

`--weekday`：`0` 或 `7` 是星期日，`1` 是星期一，依次到 `6` 星期六。

Mac 必须开机并且用户已登录。脚本运行记录位于：

```text
~/.textnow-safe-autosend/logs/
```

卸载定时任务：

```bash
npm run schedule -- --uninstall
```

## 登录过期或出现 CAPTCHA

脚本不会尝试绕过验证。重新执行：

```bash
npm run setup-login
```

完成正常登录后，计划任务会继续使用新的本机登录状态。

## 关于“每周一次”

你之前希望从“每小时”改成“每周一次”，本项目按这个要求设置。TextNow 官方说明没有统一的号码回收期限，并建议免费号码至少每天主动打电话或发短信一次；若号码非常重要，官方的 Lock In Number/Ad Free+ 比自动脚本更稳妥。

参考：

- TextNow CAPTCHA 说明：https://help.textnow.com/hc/en-us/articles/21085362250903-Press-and-Hold-CAPTCHA-login-issues
- TextNow 号码回收说明：https://help.textnow.com/hc/en-us/articles/360043106673-Help-My-Phone-Number-was-recycled-how-can-I-get-it-back
