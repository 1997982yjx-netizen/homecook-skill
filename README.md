# homecook

按家里的食材库存，算出现在能做哪些家常菜、还差什么，做完一键扣库存。

它可以用两种方式使用：

- **AI 助手的 skill**：装进 Codex、Claude Code 等支持 Agent Skills 的助手里，直接说"今天做什么菜""帮我记一下买了 4 个番茄""这是冰箱的照片"。不需要联网，也不需要任何 API 密钥。
- **手机网页**：纯前端、没有依赖，打开 `index.html` 就能用，也可以嵌进你自己的页面。拍照识别库存要用你自己的 AI 接口（见下文）。

两边的数据格式相同，可以互相导入导出。

内置 40 道家常菜，带做法步骤和成品示意图；可以加自己的菜谱。

## 功能

- **能做啥**：按"几个人吃"换算用量，分成「现在就能做」「只差一两样」「还差得多」三组；能用掉快过期食材的菜排在前面，两天内做过的往后放。
- **库存**：支持 克 / 两 / 斤 / 千克 换算，可以记到期日；常见叫法自动识别（西红柿记成番茄）。
- **调料**：盐、生抽、葱姜蒜这类只记"有没有"，不记数量，做菜时也不扣。
- **拍照录入 / 拍小票**：识别出的食材先给你核对，确认后才写入库存。
- **做好了**：按人份从库存扣掉用掉的食材，网页上 6 秒内可以撤销。
- **购物清单**：缺的食材一键加入，买到后放回库存。
- **备份**：导出 / 导入 JSON。

---

## 作为 skill 使用

需要 Node 18 及以上，不用装依赖。把整个仓库放进助手读取 skills 的目录，文件夹名用 `homecook`：

```bash
# Codex
git clone https://github.com/1997982yjx-netizen/homecook-skill ~/.agents/skills/homecook

# Claude Code
git clone https://github.com/1997982yjx-netizen/homecook-skill ~/.claude/skills/homecook
```

助手会读 `SKILL.md`，按里面的说明调用 `scripts/cook.js`。

- 数据默认存在 `~/.homecook/data.json`。想换位置，设置环境变量 `HOMECOOK_STATE`。
- 发冰箱、台面照片或购物小票时，由助手自己看图，把结果交给 `import-items` 对照食材字典。助手会先把识别结果给你核对，你确认后才写入库存。
- 想和网页版同步：网页上「库存 → 导出备份」，然后让助手运行 `import 备份文件.json`；反过来用 `export`。

### 命令行

skill 用的命令行自己也能直接用：

```bash
node scripts/cook.js help
node scripts/cook.js stock add 番茄 4 --exp 3
node scripts/cook.js stock add 五花肉 1 斤
node scripts/cook.js match --servings 3
node scripts/cook.js recipe 番茄炒蛋
node scripts/cook.js cook 番茄炒蛋
node scripts/cook.js shop missing 红烧肉
```

每个命令加 `--json` 都会输出结构化结果。完整命令见 `help` 或 `SKILL.md`。

---

## 作为网页使用

直接用浏览器打开 `index.html` 就行，数据存在这台设备的浏览器里。

想在手机上用，可以把仓库放到任何静态托管上，或者在电脑上运行自带的小服务：

```bash
node server.js        # 默认端口 8080，PORT=3000 可以换端口
```

启动后电脑上打开 `http://localhost:8080`。手机和电脑连同一个 Wi-Fi 时，用终端里打印的"手机访问"地址打开。

### 拍照识别：用你自己的接口

拍照录入和拍小票需要一个能看图的 AI 接口。**本项目不提供识别服务，也不会收到你的照片和密钥。** 有两种接法，任选一种。

**接法一：在页面里填（最简单）**

在「库存」页点「识图设置」，填三项：

| 项 | 填什么 |
| --- | --- |
| 接口地址 | OpenAI 兼容接口的根路径，不带 `/chat/completions`。不填默认 `https://api.openai.com/v1` |
| API 密钥 | 你自己的密钥 |
| 模型 | 能看图的模型。不填默认 `gpt-4o-mini` |

只要接口是 OpenAI 兼容的 `/chat/completions`、支持图片输入，用哪家都可以。

- 密钥只存在这台设备浏览器的本地存储里，不会进「导出备份」。在「识图设置」里可以随时清除。
- 照片会从浏览器直接发到你填的接口。
- 有的接口不允许浏览器直接调用（跨域）。这时识别会提示"连不上接口"，请改用接法二。
- 别人能用到你这台设备的浏览器时，就能看到这个密钥。共用设备上请用接法二，或者用完清除。

**接法二：用自己运行的 server.js 代为调用**

密钥只放在你自己服务器的环境变量里，不经过浏览器：

```bash
VISION_API_KEY=你的密钥 node server.js
```

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `VISION_API_KEY` | （必填） | 你自己的 OpenAI 兼容接口密钥，也认 `OPENAI_API_KEY` |
| `VISION_API_BASE` | `https://api.openai.com/v1` | 接口根路径，不带 `/chat/completions` |
| `VISION_MODEL` | `gpt-4o-mini` | 要能看图 |
| `VISION_TIMEOUT_MS` | `45000` | 超时毫秒 |
| `VISION_ALLOW_ORIGIN` | （不允许跨域） | 页面和服务不在同一个网址时，填页面的来源，比如 `https://example.com` |

页面在「识图设置」里没填密钥时，会自动改用同一网址下的 `/api/vision-stock`。

接口：`POST /api/vision-stock`，JSON `{ "image": "data:image/jpeg;base64,...", "mode": "stock" | "receipt" }`。`mode` 默认 `stock`（台面 / 冰箱），`receipt` 是小票，只抽食材行。返回 `{ "ok": true, "mode", "items": [{ "name", "qty", "unit", "count", "weight_g", "note" }] }`。每个 IP 每分钟最多 8 次，请求体上限约 2 MB。页面会先把照片压到最长边 1000 像素再上传。

**如果你把 server.js 部署到公网，任何能打开页面的人都会用你的密钥和额度。** 只在自己的设备或内网里运行，或者在前面加一层登录。

没配置识图时，库存页原来的手动添加不受影响。

---

## 怎么加菜谱

| | 在页面里新建 | 改 `recipes.js` |
| --- | --- | --- |
| 操作 | 「菜谱 → 新建菜谱」 | 改文件，提交到仓库 |
| 存在哪 | 只存在这台设备的浏览器里 | 跟着代码走，网页和 skill 都能用 |
| 适合 | 临时加一两道自己的菜 | 长期保留、想分享的菜 |

页面里新建的菜会标「我的」，可以编辑或删除。换手机或清浏览器缓存前，记得导出备份。

### 改 `recipes.js`

**第 1 步：复制一段菜谱，改成你的菜。** 打开 `recipes.js`，拉到 `recipes: [`，复制任意一段 `{ ... }` 粘到最后一道菜后面。注意前一段的 `}` 后面要有逗号。

```js
    {
      name: '酸辣土豆丝', category: '素菜', minutes: 15, serves: 2,
      ingredients: { '土豆': 2, '青椒': 1 },
      seasonings: ['醋', '盐', '食用油', '干辣椒'],
      optional: ['花椒'],
      steps: [
        '土豆切细丝，泡水洗掉淀粉，沥干。',
        '热油炒香干辣椒和花椒。',
        '下土豆丝大火快炒两分钟，加青椒丝，沿锅边淋醋，加盐出锅。'
      ]
    }
```

| 字段 | 写什么 | 注意 |
| --- | --- | --- |
| `name` | 菜名 | 不能和别的菜重名 |
| `category` | `荤菜` `素菜` `蛋类` `汤` `主食` 其中一个 | |
| `minutes` | 大约几分钟 | 可以不写 |
| `serves` | 下面的用量是几人份 | 不写就当 2 人份 |
| `ingredients` | `'食材': 用量` | 只写数字，单位跟食材字典走：论克的写克数（`'五花肉': 500`），论个的写个数（`'鸡蛋': 3`） |
| `seasonings` | 必需的调料 | 家里没有就算"缺" |
| `optional` | 可选的调料 | 没有也不影响能不能做 |
| `steps` | 做法，一句一步 | |
| `image` | 成品图路径，比如 `'images/酸辣土豆丝.jpg'` | 可以不写 |

**第 2 步：食材字典里没有的，先加一行。** 菜谱里用到的每样食材，都要在 `recipes.js` 上面的 `ingredients` 里有一行：

```js
    '腊肠': ['根', '肉禽'],
    '杏鲍菇': ['克', '蔬菜'],
```

- 单位只能用：克 个 根 包 块 条 碗 朵 毫升 瓶 袋。论重量的一律写"克"，录库存时照样可以填斤或两。
- 分类只能用：蔬菜 肉禽 水产 蛋豆 主食 其他。

新调料加到 `seasonings` 列表里；想让别名也能认出来（比如"杏鲍"→"杏鲍菇"），在 `alias` 里加一行。

**第 3 步：检查。**

```bash
node tools/check-recipes.js
```

它会指出哪道菜、哪里不对。显示"没有发现问题"就可以了。

内置菜谱的成品图都是 AI 生成的示意图，风格描述在 `images/CREDITS.md` 里。新加内置菜时按同一套描述生成，裁成 800×800 的 JPEG，文件名用菜名。

---

## 嵌进你自己的页面

### 方式一：iframe

```html
<iframe src="/homecook/index.html" style="width:100%;height:100%;border:0"></iframe>
```

### 方式二：直接挂到页面上

```html
<link rel="stylesheet" href="cook.css">
<div id="cook-app" data-nav="top"></div>
<script src="recipes.js"></script>          <!-- 数据 -->
<script src="core/engine.js"></script>      <!-- 匹配引擎 -->
<script src="core/vision-map.js"></script>  <!-- 拍照录入，不需要可以不引 -->
<script src="core/vision.js"></script>      <!-- 拍照录入，不需要可以不引 -->
<script src="cook.js"></script>             <!-- 最后是页面脚本 -->
```

页面里有 `#cook-app` 或 `[data-cook-app]` 时会自动挂载。挂载点上可以写：

- `data-nav="top"`：把模块的四个标签放到顶部。你的页面自己有底部导航时用这个，默认是 `bottom`。
- `data-theme="light"` 或 `"dark"`：固定浅色或深色，默认跟随系统。
- `data-storage-key="xxx"`：本地存储用的键名，默认 `cook-module-v1`。
- `data-vision-proxy="/你的路径/vision-stock"`：识图代理的地址，默认 `/api/vision-stock`。你的后端把这个路径交给 `server/vision-proxy.js` 处理即可（见下）。

### 方式三：在 Vue / React 里手动挂载

在加载 `cook.js` 之前先设置 `window.COOK_NO_AUTOMOUNT = true`，然后：

```js
// Vue 3
onMounted(() => { app = window.CookModule.mount(el.value, { nav: 'top' }) })
onBeforeUnmount(() => app && app.destroy())

// React
useEffect(() => {
  const app = window.CookModule.mount(ref.current, { nav: 'top' })
  return () => app && app.destroy()
}, [])
```

| 选项 | 说明 |
| --- | --- |
| `nav` | `'bottom'`（默认）或 `'top'` |
| `theme` | `'auto'`（默认）、`'light'`、`'dark'` |
| `tab` | 打开时显示哪页：`'match'` `'stock'` `'recipes'` `'shop'` |
| `storageKey` | 本地存储键名 |
| `storage` | 自定义存储 `{ load() { 返回数据或 null }, save(data) {} }`，想把数据存到自己后端时用 |
| `onChange` | 数据每次变化时调用，参数是完整数据 |
| `visionProxy` | 识图代理的地址，默认 `/api/vision-stock` |

`mount` 返回的对象有：`getData()`、`setData(data)`、`go('stock')`、`destroy()`。

### 你已经有 Node 后端时

不用单独运行 `server.js`，把识图代理挂到你的后端上：

```js
const { handleVisionStock } = require('./homecook/server/vision-proxy');
// 原生 http
if (req.url.startsWith('/api/vision-stock')) return handleVisionStock(req, res);
// Express
app.post('/api/vision-stock', handleVisionStock);
app.options('/api/vision-stock', handleVisionStock);
```

路径可以随意起，挂载点上用 `data-vision-proxy` 指过去就行。

### 只用匹配引擎

`core/engine.js` 不碰页面，浏览器和 Node 都能用，适合接进别的应用或机器人：

```js
const CookEngine = require('./core/engine.js');
const E = CookEngine.create(require('./recipes.js'));
const S = E.normalize(备份数据或null);
E.addStock(S, '番茄', 4, null, 'add');
const plan = E.plan(S, { servings: 2 });   // { ok: [...], near: [...], far: [...] }
```

### 手机排版和换颜色

模块按 360px 宽的手机屏幕设计，屏幕再宽时最多 640px，居中显示。嵌进有固定标题栏和底部导航的页面时：

```css
#cook-app {
  --ck-top-offset: 48px;      /* 顶部固定标题栏的高度 */
  --ck-bottom-offset: 56px;   /* 底部固定导航的高度（提示条会避开它） */
  min-height: auto;
}
```

完整写法见 `embed-example.html`。所有颜色都是 `.ck` 上的 CSS 变量，覆盖就能换风格：

```css
#cook-app { --ck-rim: #0F766E; --ck-rim-soft: #E0F2F1; }
```

`--ck-bg` 背景，`--ck-surface` 卡片，`--ck-ink` 文字，`--ck-muted` 次要文字，`--ck-line` 分隔线，`--ck-rim` 主色，`--ck-ok` 够了，`--ck-miss` 缺，`--ck-warn` 快过期。

---

## 匹配规则

- 菜谱用量按人数换算：论个、论根这类向上取整，克和毫升取到 5 的倍数。
- **现在就能做**：每样食材都够，必需调料都有。可选调料不算在内。
- **只差一两样**：缺的食材和调料加起来不超过 2 样，并且家里至少有其中一样主料。
- 排序：先排能用掉 3 天内到期食材的菜，再排用到库存种类多的菜；两天内做过的菜往后放。

## 数据

网页的数据存在浏览器 `localStorage` 里，键名 `cook-module-v1`；skill 和命令行的数据存在 `~/.homecook/data.json`。两边格式一样：

```json
{
  "v": 1,
  "stock":   { "番茄": { "qty": 4, "exp": "2026-10-21", "at": 1760000000000 } },
  "spices":  ["盐", "生抽", "葱"],
  "custom":  { "ing": { "腊肠": { "u": "根", "c": "肉禽" } }, "recipes": [] },
  "shop":    [{ "n": "青椒", "q": 2, "u": "个", "done": false }],
  "log":     { "r:番茄炒蛋": 1760000000000 },
  "servings": 2
}
```

库存数量的单位是固定的：论克的食材一律存克数，其他的按食材字典里的单位存。网页导出的备份还可能带 `photos`（成品照片），命令行会原样保留。识图设置不在里面。

## 目录

| 路径 | 用途 |
| --- | --- |
| `SKILL.md` | 给 AI 助手看的 skill 说明 |
| `scripts/cook.js` | 命令行，skill 调用的就是它 |
| `recipes.js` | **数据**：食材字典、调料、常见叫法、菜谱。加菜只改这个文件 |
| `core/engine.js` | 匹配引擎：库存、匹配、扣库存、购物清单，不依赖页面 |
| `core/vision-map.js` | 把识图结果对照食材字典，换成库存用的名字和单位 |
| `core/vision.js` | 调用你自己的识图接口（提示词、请求、结果清理） |
| `index.html` `cook.js` `cook.css` | 网页 |
| `embed-example.html` | 嵌进别的页面的示例 |
| `server.js` `server/vision-proxy.js` | 可选：本地服务和识图代理 |
| `images/` | 内置菜谱的成品示意图（AI 生成） |
| `tools/` | 菜谱检查和测试 |

## 测试

```bash
node tools/check-recipes.js
node tools/test-engine.js
node tools/test-cli.js
node tools/test-vision.js
```

测试都不访问网络。

## 许可

代码和菜谱数据以 MIT 许可发布，见 [LICENSE](LICENSE)。

`images/` 里的成品图由 AI 生成，仅作示意，实际做出来的样子会有差别。
