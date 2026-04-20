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

运行时只需要**改 `.env`，不需要改后端**：

```env
# 切到 Live2D 渲染器
VITE_AVATAR_TYPE=live2d

# 可选：强制指定一个 .model3.json（绝对或相对前端根）
# 不填时默认使用 ./live2d/hiyori/Hiyori.model3.json
# VITE_LIVE2D_MODEL_URL=./live2d/mao/Mao.model3.json
```

| 环境变量                | 类型   | 用途                                                        | 默认值                               |
| ----------------------- | ------ | ----------------------------------------------------------- | ------------------------------------ |
| `VITE_AVATAR_TYPE`      | String | 前端渲染器强制覆盖：`''`(纯音频) / `'lam'` / `'live2d'`     | 跟随后端 `avatar_config.avatar_type` |
| `VITE_LIVE2D_MODEL_URL` | String | Live2D 模式下自定义 `.model3.json` 地址（绝对或相对前端根） | `./live2d/hiyori/Hiyori.model3.json` |

切到 `live2d` 后：前端会忽略后端 `avatar_config.avatar_assets_path`（该路径是给 LAM 的高斯泼溅资源用的），改为加载本地 `.model3.json`；后端继续按原协议下发 ARKit blendshape + PCM 音频，整条 `AvatarHandler → Processor → getExpressionData` 链路和 LAM 完全一致。

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
