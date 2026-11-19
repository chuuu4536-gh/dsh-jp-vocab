# 第三方代码声明

`kuromoji.js` 与 `../dict/*.gz` 来自 npm 包 **`@patdx/kuromoji@1.0.4`**（kuromoji.js 的浏览器构建），
随扩展一并打包，用于离线词形还原（把「惹かれて」还原成「惹く」）。

- 上游项目：<https://github.com/takuyaa/kuromoji.js>
- 许可证：Apache License 2.0
- 词典：kuromoji 自带的 IPADIC 转储，随上游一同分发

本仓库只把入口文件重命名为 `kuromoji.js` 以便打包，未修改源码。
