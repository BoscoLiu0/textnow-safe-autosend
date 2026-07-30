# TextNow 每周自动发短信（Chrome 扩展版）

这个版本直接运行在你已经登录 TextNow 的普通 Google Chrome 中，不再启动
Playwright 自动化浏览器。因此，它不会遇到 Google 显示
“This browser or app may not be secure”的问题。

扩展仅用于你自己的 TextNow 号码保号，并且只允许配置一个美国或加拿大收件号码。

## 安全设计

- 不保存或上传 TextNow 密码；
- 不导出 Cookie；
- 收件号码、短信内容和发送记录只保存在本机的 `chrome.storage.local`；
- 不使用验证码破解服务；
- 遇到登录页面或 CAPTCHA 时停止，不尝试绕过；
- 自动发送之间至少间隔 6 天；
- 只请求 TextNow、定时任务、本地存储和标签页权限。

## 安装

1. 在 GitHub 项目页面点击绿色 **Code**，选择 **Download ZIP**。
2. 双击 ZIP 解压。
3. 在 Chrome 地址栏输入：

   ```text
   chrome://extensions
   ```

4. 打开右上角的 **Developer mode（开发者模式）**。
5. 点击 **Load unpacked（加载已解压的扩展程序）**。
6. 选择解压后的 `textnow-safe-autosend-main` 文件夹。
7. 点击 Chrome 工具栏的拼图图标，把 **TextNow Weekly Sender** 固定到工具栏。

## 第一次设置

1. 用普通 Chrome 打开 <https://www.textnow.com/messaging>，确认可以看到短信列表。
2. 点击工具栏上的 **TextNow Weekly Sender**。
3. 填写一个已经同意接收这条短信的美国或加拿大号码。
4. 填写短信内容，并选择每周运行时间。
5. 点击 **保存设置**。
6. 点击 **立即测试发送**。

测试按钮会打开或切换到 TextNow 标签页。发送成功后，扩展窗口中的“最近状态”会显示
成功时间和收件号码后四位。

## 自动运行条件

- Chrome 必须处于运行状态；
- TextNow 必须保持登录；
- Mac 睡眠或关闭时不能准时运行，Chrome 恢复后可能补跑；
- 如果 TextNow 改变网页结构，扩展会停止并显示错误，不会随意向当前会话发送；
- 免费 TextNow 号码是否被回收由 TextNow 决定，每周自动发送不能提供保证。

## 修改设置

随时点击扩展图标即可修改号码、短信内容和时间。点击 **立即测试发送** 会忽略
6 天间隔并测试一次；每周计划仍会遵守至少 6 天的间隔。

## 删除扩展

打开 `chrome://extensions`，在 **TextNow Weekly Sender** 卡片中点击 **Remove（移除）**。
删除扩展后，本机保存的号码、短信内容和发送记录也会被 Chrome 删除。
