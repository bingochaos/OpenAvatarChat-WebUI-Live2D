# Live2D Cubism 4 官方示例模型

前端的 Live2D 模型下拉（右侧动作栏）会读取 `../models.json`。此项目默认只内置了 **Hiyori**。要启用更多 Cubism 4 官方样例（Haru / Mao / Mark / Natori / Ren / Rice / Wanko），推荐直接跑项目根目录里的脚本，一次性下载 + 自动重建 `models.json`：

```bash
# 下载全部 8 个官方模型（已有的会跳过，可反复运行）
scripts/download-live2d-models.sh

# 仅下载指定模型
scripts/download-live2d-models.sh Haru Wanko
```

脚本会把每个模型放到 `src/renderer/public/live2d/<id>/`（id 为小写），并根据磁盘实际存在的文件自动更新 `src/renderer/public/live2d/models.json`。

如果 shell 无法直连 GitHub，任意一种代理即可：

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
# 或者指定镜像
export RAW_BASE=https://your-mirror/raw RAW_API=https://your-mirror/api
```

脚本要求：`bash` / `curl` / `python3`（都是常见系统自带）。

## 官方来源

Live2D Cubism Web Samples（Apache-2.0 / Live2D Free Material License）
https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources

## 本目录预期结构（Haru 示例）

```
haru/
├── Haru.cdi3.json
├── Haru.moc3
├── Haru.model3.json
├── Haru.physics3.json
├── Haru.pose3.json
├── Haru.userdata3.json
├── Haru.2048/
│   ├── texture_00.png
│   └── texture_01.png
├── expressions/*.exp3.json
└── motions/*.motion3.json
```

`sounds/` 目录下的 `.wav` 被脚本主动跳过：项目通过 `autoInteract: false` 禁用了 Cubism 自带的 TapBody 音效，那些音频不会被加载。

## 手动添加任意其他模型

1. 在 `src/renderer/public/live2d/` 下新建 `<your-id>/`，放入 `<Name>.model3.json` 及其依赖。
2. 在 `src/renderer/public/live2d/models.json` 的 `models` 数组追加一项 `{ "id": "<your-id>", "label": "<Display Name>", "path": "./live2d/<your-id>/<Name>.model3.json" }`。
3. 刷新页面即可。
