# Python任务安装分发包与导入使用指南

本文用于指导在 Python 任务中，从官方源或清华源安装分发包，并在后续代码中稳定导入使用。

## 适用场景

* 需要在任务运行时临时安装第三方包。
* 需要从公网官方源（PyPI）或国内镜像（清华源等）安装包。
* 需要将包安装到自定义目录（如 `/home/system_normal`）后再 `import`。

## 运行时安装说明

* Python 任务运行在临时 Pod 中，任务结束后环境会销毁。所以每次运行都需要重新安装该依赖，不要依赖“上一次安装结果”。
* 必须使用 `--target` 安装，且必须把该目录加入 `sys.path` 后再导入。因为当前python运行时环境无 Root 权限，无法安装到全局 site-packages 目录，只能安装到用户目录下（如 `/home/system_normal`）。
* 清华源（网络受限时可选）：`https://pypi.tuna.tsinghua.edu.cn/simple`

## 标准模板（推荐直接复用）

```python
import subprocess
import sys

TARGET_DIR = "/home/system_normal"
subprocess.check_call([
    sys.executable, "-m", "pip", "install",
    "config",
    "--target", TARGET_DIR,
    "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"
])
sys.path.append(TARGET_DIR)

from config import *
```


## 快速切换到清华源

仅需把模板中的 `INDEX_URL` 改为：

```python
INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple"
```

## 常见错误与排查

### 报错：`ModuleNotFoundError: No module named 'xxx'`

按顺序检查：

* 是否使用了 `--target`，但没有把该目录加入 `sys.path`。
* 是否在 `import` 之后才追加路径（顺序错误）。
* 是否把路径用 `append` 加到了末尾，导致被其他路径遮蔽。
* 包名与模块名是否一致（有些包 `pip install A`，但 `import B`）。
