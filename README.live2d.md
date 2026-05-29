# OpenAvatarChat WebUI · Live2D 分支说明

这份文档只承载**本分支在上游之上新增的 Live2D 相关内容**。所有通用的前端部署 / Manager / Electron / InitConfig 等说明请直接看 [`README.md`](./README.md)，那部分保持和上游一致。

## 与上游仓库的关系

- 上游：[HumanAIGC-Engineering/OpenAvatarChat-WebUI](https://github.com/HumanAIGC-Engineering/OpenAvatarChat-WebUI) — 官方前端，只带 `LAMRenderer`（高斯泼溅）和纯音频两种渲染。
- 本分支：[bingochaos/OpenAvatarChat-WebUI-Live2D](https://github.com/bingochaos/OpenAvatarChat-WebUI-Live2D) — 在上游之上新增 `Live2DRenderer`（基于 `pixi-live2d-display` + `pixi.js`），以及配套的官方示例模型下载脚本。
- 通用改动原则：**只在必要的地方改上游代码**，其余结构、接口、部署方式、ARKit → 表情参数的数据链路与上游完全一致 —— 保证随时 rebase 上游主线。

本分支新增 / 修改的文件一览：

| 路径                                                  | 作用                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/handlers/avatarRenderers/live2d.ts` | `Live2DRenderer` 实现：PIXI stage、模型加载、帧驱动、ARKit blendshape → Cubism 参数映射、动态 LipSync 参数兼容。 |
| `src/renderer/public/live2d/live2dcubismcore.min.js`  | Live2D Cubism Core 运行时，随 `index.html` 一起加载。                                                            |
| `src/renderer/public/live2d/models.json`              | 前端可选模型清单，由下载脚本自动维护。                                                                           |
| `src/renderer/public/live2d/<id>/...`                 | 实际模型文件，**不入库**（见下方 `.gitignore` 一节），运行下载脚本后才出现。                                     |
| `scripts/download-live2d-models.sh`                   | 从上游 `Live2D/CubismWebSamples` sparse-clone 下载官方免费示例模型，并按 moc3 版本过滤 / 刷新 `models.json`。    |
| `README.md`                                           | 顶部加了一行指向本文档的指针，其余和上游保持一致。                                                               |

## 启用方式

**本分支已经默认开启 Live2D** —— `pnpm run build` 产出的 `dist/` 出厂即为 Live2D 模式，OpenAvatarChat 只要换上这份 `dist/` 就能直接用（见下方[「作为 OpenAvatarChat 子模块使用」](#作为-openavatarchat-子模块使用开箱即用-live2d)）。这套默认值由仓库里**入库的 `.env.production`** 提供：

```env
# .env.production —— 随仓库入库，vite build (mode=production) 自动加载
VITE_AVATAR_TYPE=live2d
VITE_LIVE2D_MODEL_URL=./live2d/hiyori/Hiyori.model3.json
# 留空 => 由浏览器 location.* 自动探测后端地址（与 OpenAvatarChat 同源），
# 不要在这里写死 IP/端口/SSL，否则打出来的 dist 只能连那一个 host。
VITE_SERVER_IP=
VITE_SERVER_PORT=
VITE_USE_SSL=
```

> Vite 会从仓库根目录加载 `.env`、本机覆盖文件 `.env.local`，以及当前 mode 对应的 `.env.[mode]` / `.env.[mode].local`；越靠后的文件优先级越高，production 构建里 `.env.production` 会覆盖 `.env.local` 的同名 key。所以开发者本地的 `.env`（通常把开发代理指向 `127.0.0.1`，仍被 `.gitignore` 忽略）不会污染生产构建：`.env.production` 把这几个 server 变量显式清空，生产包始终回落到 `location.*` 自动探测。
>
> 注意 `vite.config.ts` 用 `loadEnv(mode, …)` + `envDir` 指向仓库根目录来读取这些文件——`root` 指向 `src/renderer`，若不这样 Vite 默认只会在 `src/renderer/` 下找 `.env`，`VITE_AVATAR_TYPE` 之类的变量根本不会被 bake 进包里。

如果要在本地开发时临时**关掉** Live2D 或换默认模型，可以建一个 `.env.local`（被忽略，仅本机生效）覆盖，例如 `VITE_AVATAR_TYPE=` 退回跟随后端，或 `VITE_LIVE2D_MODEL_URL=./live2d/mao/Mao.model3.json` 换模型。若要改变 `pnpm run build` 产出的生产包，请用 `.env.production.local` 覆盖，或直接调整入库的 `.env.production`。

| 环境变量                | 类型   | 用途                                                        | 默认值（本分支 `.env.production`）   |
| ----------------------- | ------ | ----------------------------------------------------------- | ------------------------------------ |
| `VITE_AVATAR_TYPE`      | String | 前端渲染器强制覆盖：`''`(纯音频) / `'lam'` / `'live2d'`     | `live2d`                             |
| `VITE_LIVE2D_MODEL_URL` | String | Live2D 模式下自定义 `.model3.json` 地址（绝对或相对前端根） | `./live2d/hiyori/Hiyori.model3.json` |

> 不设 `.env.production` 单独构建时，`VITE_AVATAR_TYPE` 默认跟随后端 `avatar_config.avatar_type`，`VITE_LIVE2D_MODEL_URL` 默认回落到 `./live2d/hiyori/Hiyori.model3.json`。

切到 `live2d` 后：前端会忽略后端 `avatar_config.avatar_assets_path`（该路径是给 LAM 的高斯泼溅资源用的），改为加载本地 `.model3.json`；后端继续按原协议下发 ARKit blendshape + PCM 音频，整条 `AvatarHandler → Processor → getExpressionData` 链路和 LAM 完全一致。

## 作为 OpenAvatarChat 子模块使用（开箱即用 Live2D）

目标：OpenAvatarChat 把**整个本仓库**当成一个 git submodule，然后用本仓库 `dist/` 的内容替换它的前端静态资源目录 `src/service/frontend_service/frontend/dist/`，即可在**不动后端**的前提下切到 Live2D。

### 1. 在 OpenAvatarChat 仓库里加 submodule

```bash
# 在 OpenAvatarChat 仓库根目录
git submodule add -b feature/live2d \
  https://github.com/bingochaos/OpenAvatarChat-WebUI-Live2D.git \
  third_party/webui-live2d
git submodule update --init --recursive
```

> 路径 `third_party/webui-live2d` 只是示例，放哪都行——关键是后面要把它的 `dist/` 落到 `src/service/frontend_service/frontend/dist/`。

### 2. 把 dist/ 落到后端的前端目录

本仓库 `dist/` 已经入库（出厂即 Live2D 模式，自带默认 Hiyori 模型 + `live2dcubismcore.min.js` + `models.json`），所以**不需要在 OpenAvatarChat 那边重新编译**，直接同步即可：

```bash
# 在 OpenAvatarChat 仓库根目录
rm -rf src/service/frontend_service/frontend/dist
cp -r third_party/webui-live2d/dist src/service/frontend_service/frontend/dist
```

启动后端后访问 `https://<your-host>:8282`，会自动重定向到前端并以 Live2D 模式加载 Hiyori。前端通过浏览器 `location.*` 自动探测后端地址，**无论部署在哪个 host 都不用改 `.env`**。

### 3. 升级前端

本仓库出新版本时，在 OpenAvatarChat 里 `cd third_party/webui-live2d && git pull` 拉到对应提交，再重复第 2 步的 `cp` 即可。

### dist 里打包了什么 / 想换或加模型

- 入库的 `dist/` **只打包默认的 Hiyori 模型**（约 5MB），`dist/live2d/models.json` 也只列 Hiyori，所以前端模型切换器只显示一个。这是为了控制仓库体积。
- 想在打包产物里带上更多模型：先在本仓库跑下载脚本拉模型，再重新构建、把多出来的模型目录一起提交进 `dist/`（详见上面[「下载官方示例模型」](#下载官方示例模型)）。注意 `vite build` 会用 `emptyOutDir` 清空 `dist/` 再从 `src/renderer/public/live2d/` 拷贝，**所以要打进 dist 的模型必须先下载到 `public/live2d/` 下**；`src/renderer/public/live2d/*/` 默认被 `.gitignore` 忽略，只有 Hiyori 的模型文件入了库，这也是「干净 clone + `pnpm run build` 就能复现出可用 dist」的原因。
- OpenAvatarChat 侧如果只想自己换模型而不想重新编译：直接往 `src/service/frontend_service/frontend/dist/live2d/<id>/` 丢模型文件，并在 `dist/live2d/models.json` 里加一条，或用 `VITE_LIVE2D_MODEL_URL` 指向它（需重新构建才能 bake）。

## 下载官方示例模型

`src/renderer/public/live2d/<id>/` 下的模型文件**不入库**，需要本地执行一次下载脚本：

```bash
# 下载全部（自动按当前 SDK 支持的 moc3 版本过滤）
scripts/download-live2d-models.sh

# 只下载指定模型
scripts/download-live2d-models.sh Haru Wanko

# 放开 moc3 版本上限（默认 5，当前 core 能吃 v1..v5；未来升级 core 后可以调高）
MAX_MOC_VERSION=6 scripts/download-live2d-models.sh

# 换源或换分支
REF=master scripts/download-live2d-models.sh
CLONE_URL=https://your.mirror/CubismWebSamples.git scripts/download-live2d-models.sh
```

脚本做的事情：

1. 对 [`Live2D/CubismWebSamples`](https://github.com/Live2D/CubismWebSamples) 做 `--depth 1 --filter=blob:none --sparse` 浅克隆，只拉 `Samples/Resources/`；
2. 把每个模型目录同步到 `src/renderer/public/live2d/<id>/`（`rsync --exclude sounds/*`，前端不使用音频采样）；
3. 读取每个 `.moc3` 文件头第 5 字节的版本号，**大于 `MAX_MOC_VERSION` 的模型直接删除目录并从清单里排除**，避免运行时 Cubism Core 抛 "unsupported moc3 version"；
4. 重新生成 `src/renderer/public/live2d/models.json`，只列出"下载成功且版本兼容"的模型，供前端切换菜单使用。

## 兼容性矩阵（上游 `develop` 分支快照）

当前 `src/renderer/public/live2d/live2dcubismcore.min.js` 支持 **moc3 v1 ~ v5**（即 Cubism 2.1 ~ 5.0），`MAX_MOC_VERSION` 默认设为 `5`。

| 模型   | moc3 版本 | 默认是否纳入 | LipSync 参数（从 `model3.json` 读取） | 备注                                                                |
| ------ | --------- | ------------ | ------------------------------------- | ------------------------------------------------------------------- |
| Haru   | v1        | ✅           | `ParamMouthOpenY`                     | Cubism 3.3                                                          |
| Hiyori | v3        | ✅           | `ParamMouthOpenY`                     | Cubism 4 默认免费示例                                               |
| Mao    | v5        | ✅           | `ParamA`                              | Cubism 5.0；LipSync 走传统日式元音通道（见下节）                    |
| Mark   | v3        | ✅           | _(空)_ → 回落 `ParamMouthOpenY`       | 模型本身未定义 LipSync 组                                           |
| Natori | v1        | ✅           | `ParamMouthOpenY`                     |                                                                     |
| Ren    | v6        | ❌           | —                                     | 需要更高版本 Cubism Core，当前 SDK 无法加载，**由下载脚本自动剔除** |
| Rice   | v3        | ✅           | _(空)_ → 回落 `ParamMouthOpenY`       |                                                                     |
| Wanko  | v1        | ✅           | `PARAM_MOUTH_OPEN_Y`                  | Cubism 2.1 旧命名约定                                               |

今后上游再出新模型时，脚本会按同样的版本 + 清单策略自动处理，不用手工维护白名单。

## LipSync 参数动态兼容

不同版本 / 不同作者的 Cubism 模型，嘴巴张合用的参数名并不统一，`Live2DRenderer` 在加载模型时会调用 `pixi-live2d-display` 的 `settings.getLipSyncParameters()` 读取 model3.json 里 `Groups[name=LipSync].Ids`，然后把计算出的 `mouthOpen ∈ [0, 1]` 写入**所有**返回的参数 ID：

| 约定                 | 典型模型               | 行为                                                                                       |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `ParamMouthOpenY`    | Hiyori / Haru / Natori | Cubism 3/4 默认，直接映射张嘴幅度                                                          |
| `ParamA`（日式元音） | Mao                    | 模型没有独立的 "张嘴" 通道，用元音 A 通道近似张嘴；没有 phoneme 数据所以不再细分 A/I/U/E/O |
| `PARAM_MOUTH_OPEN_Y` | Wanko                  | Cubism 2.1 旧命名约定                                                                      |
| _(无 LipSync 组)_    | Mark / Rice            | 回落写入 `ParamMouthOpenY`                                                                 |

`mouthOpen` 的计算方式沿用上游 LAM 的逻辑：以后端 ARKit `jawOpen`（×8 放大到 `[0,1]`）为主信号，音频 RMS 作为 floor 兜底。其他表情通道（眨眼 / 眉毛 / 头部旋转 / 口型形状）仍按 Cubism 4 标准写入，同一个 `applyArkitToCubism4` 函数。

## `.gitignore`

下载下来的模型目录体积大、会随上游升级，所以被集中 ignore：

```gitignore
src/renderer/public/live2d/*/
```

顶层的 `models.json`、`README.md`、`live2dcubismcore.min.js` 继续纳入版本管理，保证一个干净克隆也能立刻知道"跑哪个脚本 + 默认会出现哪些模型"。

## 许可声明

- 官方 Live2D 示例模型（Haru / Hiyori / Mao / Mark / Natori / Rice / Wanko / Ren …）来自 [Live2D CubismWebSamples](https://github.com/Live2D/CubismWebSamples)，采用 [Live2D Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)，可免费用于**非商业 / 研发 / 演示**场景。**商业使用必须单独向 Live2D 申请许可**，仓库里每个模型目录内一般都有 `LICENSE.txt`，请以官方条款为准。
- `live2dcubismcore.min.js` 来自 Live2D Cubism SDK for Web，遵循 [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)。
- 本分支自身代码仍采用上游的 MIT 许可证（见 [`LICENSE`](./LICENSE)），**不覆盖** Live2D 资源的授权条款。
