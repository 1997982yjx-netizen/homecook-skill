# 内置菜谱成品图说明

`images/` 里的成品图都是 AI 生成的示意图，不是实拍照片，也不是从网上下载的图片。每道内置菜谱一张，文件名就是菜名，例如 `images/番茄炒蛋.jpg`。

为了让列表里看起来统一，所有图片用同一套风格描述生成，只换菜名和这道菜的主要食材、颜色：

```
Photo-realistic food photograph, 45-degree overhead angle, of a home-cooked Chinese dish: <菜名> (<英文菜名>): <主要食材、颜色、形状>. Served on a plain round white ceramic plate (汤、粥、汤面用 plain round white ceramic bowl) on a light natural wood table, soft natural window light, clean minimal background, appetizing, no text, no watermark, no hands, no people, no chopsticks or utensil clutter, square composition.
```

生成后裁成正方形，压缩成 800×800 的 JPEG（每张约 90–140 KB），方便手机加载。

以后新增内置菜谱也按这套描述生成图片，不再混用实拍照片。图片只是示意，实际做出来的样子会有差别。
