# talos-cli

Talos is a CLI tool based on Ralph that supports running under Claude Code and Cursor CLI. It enables you to execute multiple Ralph Loop tasks in parallel across multiple repositories.

## Complete Command Reference

### Main Process Management

```bash
talos start [--silent]              # Start Talos main process
talos stop                          # Stop Talos main process
talos restart                       # Restart Talos main process
talos status                        # Check main process status
talos logs [-f] [-n <number>]       # View logs
```

### Task Management

```bash
# Start task
talos task start [--prd <path>] [--tool <tool>] [--debug] [--model <model>]

# Monitor task
talos task monitor [--workspace <name>] [--once] [--all]

# Task list
talos task list [--json] [--all]

# Task operations
talos task attach <taskId> [--follow]
talos task stop <taskId> [--reason <reason>]
talos task resume <taskId> [--tool <tool>] [--debug] [--model <model>]
talos task health <taskId> [--json]
talos task remove <taskId> [--force]
talos task clear [--force]
```

**Parameter Descriptions**:
- `--prd <path>` - Specify PRD path
- `--tool <tool>` - Specify tool (claude or cursor)
- `--debug` - Enable debug mode (capture full output)
- `--model <model>` - Specify AI model
  - cursor: composer-1.5, sonnet-4, auto
  - claude: sonnet-4, opus
- `--workspace <name>` - Workspace name
- `--once` - Single display mode (disable continuous monitoring)
- `--all` - Show tasks from all workspaces
- `--follow` - Real-time log output tracking
- `--reason <reason>` - Stop reason
- `--force` - Force execution (skip confirmation)
- `--json` - JSON format output

### Workspace Management

```bash
talos workspace add [--path <path>] [--name <name>]  # Add workspace
talos workspace list [--json]                        # List all workspaces
```

### PRD Management

```bash
talos prd                                    # Create PRD through AI conversation
talos ralph --prd <prdFiles...> [--force]     # Convert PRD(s) to Ralph format (merge multiple PRDs into one)
talos archive [identifier] [--all] [--force]  # Archive completed PRDs
```

**PRD Workflow**:
1. `talos prd` - Generate PRD through AI conversation (saved as `tasks/prd-{name}.md`)
2. `talos ralph --prd <name>` - Convert to Ralph format (saved as `ralph/{name}/prd.json`)
3. `talos task start --prd <name>` - Start task execution

### Other Commands

```bash
talos health                        # System health check
talos help                          # View help
```

## Advanced Features

### Debug Mode

Use `--debug` flag to capture the complete execution process of Claude Code:

```bash
talos task start --prd my-feature --debug
talos task resume <taskId> --debug
```

**Log Content Differences**:
- Normal mode: Only contains final output
- Debug mode: Includes thinking process, tool call details, tool return results, timestamps

**Log Path**: `.talos/logs/{taskId}.log`

### Interactive Multi-Select PRD

`talos task start` supports interactive multi-select for incomplete PRDs:
- 0 incomplete PRDs: Display "All PRDs completed"
- 1 incomplete PRD: Start directly
- 2+ incomplete PRDs: Display interactive multi-select interface

## Development Guide

For detailed development documentation: [CLAUDE.md](./CLAUDE.md)
