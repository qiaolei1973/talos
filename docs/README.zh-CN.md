# Talos

**[English](../README.md)**

Talos 是一个基于 Ralph 的 CLI 工具，支持在 Claude Code、Cursor cli 下运行。它支持你并行的在多个仓库下、执行多个 Ralph Loop 任务。

![Task Monitor](images/task-monitor.png)

## 快速开始

### 1. 添加工作区

```bash
talos workspace add
```

### 2. 生成 PRD

通过 AI 对话创建产品需求文档。

```bash
talos prd
```

### 3. 转换 PRD

将 PRD 转换为 Ralph 格式，用于 AI 执行。

```bash
talos ralph --prd my-feature
```

### 4. 启动任务

启动任务执行 PRD。未指定 PRD 时交互式选择。

```bash
talos task start --prd my-feature
```

## 任务运维

### 监控任务进度

```bash
talos task monitor
```

### 进入任务工作目录

```bash
talos task attach <taskId> [-f]
```

### 停止任务

```bash
talos task stop <taskId>
```

### 恢复失败的任务

```bash
talos task resume <taskId>
```

### 删除任务

```bash
talos task remove <taskId>
```

### 清除失败任务

```bash
talos task clear [--force]
```

## 获取帮助

```bash
talos --help
talos <command> --help
```

## 完整命令文档

查看所有命令及参数说明：[packages/cli/README.md](../packages/cli/README.md)
