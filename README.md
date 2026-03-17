# Talos

**[中文文档](docs/README.zh-CN.md)**

Talos is a CLI tool based on Ralph that supports running under Claude Code and Cursor CLI. It enables you to execute multiple Ralph Loop tasks in parallel across multiple repositories.

![Task Monitor](docs/images/task-monitor.png)

## Quick Start

### 1. Add Workspace

```bash
talos workspace add
```

### 2. Generate PRD

Create a Product Requirements Document through AI conversation.

```bash
talos prd
```

### 3. Convert PRD

Convert PRD to Ralph format for AI execution.

```bash
talos ralph --prd my-feature
```

### 4. Start Task

Start a task to execute the PRD. Interactive selection is used when no PRD is specified.

```bash
talos task start --prd my-feature
```

## Task Operations

### Monitor Task Progress

```bash
talos task monitor
```

### Attach to Task Working Directory

```bash
talos task attach <taskId> [-f]
```

### Stop Task

```bash
talos task stop <taskId>
```

### Resume Failed Task

```bash
talos task resume <taskId>
```

### Remove Task

```bash
talos task remove <taskId>
```

### Clear Failed Tasks

```bash
talos task clear [--force]
```

## Get Help

```bash
talos --help
talos <command> --help
```

## Complete Command Documentation

For all commands and parameter descriptions: [packages/cli/README.md](packages/cli/README.md)
