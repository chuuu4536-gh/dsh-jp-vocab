<!--
  自定义模板示例。默认不启用：只有在本插件配置里把 templatePath 指向本文件才会用到。
  可用变量：{{date}} {{count}}，以及每个词条的 {{header}} {{word}} {{reading}} {{pitch}} {{posText}} {{gloss}} {{block}}
  {{block}} 是内置版式算好的整块（词头 + 大纲），自定义时最省事。
-->
# {{date}}

{{#words}}{{block}}

{{/words}}
