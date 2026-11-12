# 文件与 Volume

`cz-cli fs` 通过 SDK `FsUtil` 操作本地文件和 Lakehouse Volume 文件，传输文件字节，不转换数据格式。

## 当前行为

| 命令        | 用途与边界                                         |
| ----------- | -------------------------------------------------- |
| `ls`        | 列目录，默认最多 100 项；`--limit 0` 不截断        |
| `head`      | 读取 UTF-8 文本开头，默认最多 65536 字节           |
| `mb`        | 创建 Managed Volume 对象，要求 `--write`           |
| `rb`        | 删除空的 Managed Volume 对象，要求 `--write`       |
| `mkdir`     | 在本地或已有 Volume 内创建目录及父目录             |
| `cp` / `mv` | 复制、移动；`-R` 控制递归，`--overwrite` 允许覆盖  |
| `rm`        | 删除文件或目录，要求 `--write`；`--dry-run` 只预览 |

远程路径使用 `czfs:`，例如 `czfs:/Volumes/<workspace>/<schema>/<volume>/`；User、Table Volume 分别使用 `@user`、`@table` 路径。命名空间根可列举元数据，但不接受递归列举；具体文件操作使用完整 Volume 路径。

## 维护约束

- 文件操作与 Volume 对象生命周期分开。`rb` 拒绝 External Volume 和非空 Managed Volume；`rm` 不承担删除 Volume 对象的职责。
- `cp`、`mv` 默认拒绝覆盖。`rm --force` 仅忽略路径不存在，不代替 `--write`，也不能掩盖其他错误。
- `head` 的字节截断若产生无效 UTF-8，则返回 `FS_NOT_TEXT`；不能将网络或 Volume 查询失败改写成文本错误。
- 根目录保护、路径穿越校验、目标冲突检查和元数据类型校验由 SDK 执行；失败或不完整元数据不能当成空目录。

## 实现与验证入口

- [CLI 命令及帮助](../../packages/cz-cli/src/commands/fs.ts)、[SDK 文件实现](../../packages/clickzetta-sdk/src/fsutil.ts)。
- [CLI 文件回归](../../packages/cz-cli/test/fs-command.test.ts)、[SDK 路径、传输及 Volume 回归](../../packages/clickzetta-sdk/test/fsutil.test.ts)。
