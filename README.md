# Mainframe

A [Herdr](https://herdr.dev) layout for running many coding agents on several computers: a desk with every agent in the sidebar, and the Grid, where each agent stands in its room with what it is doing. Both screens follow your theme. It comes with Cyan Matrix.

![Mainframe](preview.png)

## What's in it

- **The Grid** (`Ctrl+Shift+Y`): one tower per computer, one room per space, one pixel character per agent, with status, model, context used and task. A screen to stay on: click an agent and its session opens beside the towers as a live terminal you type in; double-click to go to it at the desk.
- **Crew cards:** children without panes have their own places beside their parent, three to a bunk. Click a terminal-backed child to type to it, or a transcript-only child to read its task and recent messages. Click a status count to visit the next match; `?` shows the Grid controls.
- **Blender** (`Ctrl+Shift+B`): watch the 3D viewport beside the terminal. Inspect objects, dimensions, geometry, materials and modifiers; see what changed between snapshots and, optionally, which MCP commands ran.
- **Resources** (`Ctrl+Shift+M`): CPU with its recent history, temperatures, memory and swap, GPUs and drives, for this computer and every one it's connected to: Linux, macOS and Windows. It reads them only while it's open, using what each system already has (`nvidia-smi` too, if it's there).
- **44 characters.** Each agent gets one and keeps it, on its sidebar row, its tab and in the Grid.
- **One bar for everything:** Asks, Files, Changes, To-do, Timeline, an agents graph, PR review, usage and resources, in groups at the right end that shrink to icons when the tabs need room.
- **A sidebar that reads cleanly:** Over9k's, with rows that show what fits whole.
- **Help & options** in the sidebar's footer: a guide, your keys, and four options.

| The desk with Blender open | The Grid with crew cards |
|---|---|
| ![The desk](shots/desk.png) | ![The Grid](shots/grid.png) |

The agents and projects in these pictures are made up.

## Install

Ask an agent in Herdr: "add the layout at herdr.dev/layouts/LexingtonStanley/herdr-mainframe". It reads `RECIPE.md`, copies `layouts/`, `themes/` and each folder in `mods/` into `~/.config/herdr-app`, merges `keys.json`, and switches to it.

By hand: copy the same things (move each mod folder in whole), then press `Ctrl+Shift+L` until Mainframe shows.

It runs `git`, `python3` and shell scripts, and `gh` or `glab` if you have them. Linux and macOS; on Windows the sidebar does less.

### Updates

Mainframe looks at this repository every six hours for a newer version. When there is one, an **Update** tag appears on the sidebar's **Mainframe help & options** row. The dialog's **Updates** page lists what changed, and has **Check now** and **Update now**. Nothing is installed until you press Update now.

An update replaces only Mainframe's own files. Your edits to the layout are merged with the new version, and your own keys and options stay. If you changed one of Mainframe's other files yourself, the update stops and names the file, and nothing changes. Every file it replaces is copied to `data/mainframe-update/backups` in Herdr's folder first. It needs `git` and Python 3. To stop the six-hourly look, turn off **Options › Check for updates**.

From a terminal: `python3 ~/.config/herdr-app/mods/mainframe-options/update.py --check` (or `--apply`).

Installed Mainframe before the Updates page existed (before 27 November 2026)? Bring it up to date once from a terminal, and the page is there from then on:

```sh
git clone https://github.com/LexingtonStanley/herdr-mainframe ~/herdr-mainframe-update
python3 ~/herdr-mainframe-update/mods/mainframe-options/update.py --apply
```

The clone can be deleted afterwards. On Windows use `python` in place of `python3`.

### Watch Blender

Start the server in Blender’s **N sidebar → BlenderMCP** using the [Blender MCP add-on](https://github.com/ahujasid/blender-mcp). Open **Blender** in Mainframe’s toolbar. It connects to the add-on on `127.0.0.1:9876`; **Connection** changes the port. For Blender on another machine, forward the add-on’s port first, for example `ssh -N -L 9877:127.0.0.1:9876 user@studio`, then enter `9877`.

**Scene** shows the active object and render setup. **Objects** lets you inspect up to 300 objects without changing Blender’s selection. **Activity** shows observed object changes; enable command recording under **Connection** for command names, success and elapsed time. Code, parameters and command output aren’t recorded. The panel polls while visible; **Pause** freezes it, and a lost connection marks the last good snapshot stale.

## Add-ons

Two buttons appear only when their mods are installed, because each has an installer of its own:

- **Chat**: a tab's agent as a conversation. Needs [Flockbook](https://github.com/minchenlee/flockbook); then add its three views to the layout's `view` stack (the snippet is in `RECIPE.md`).
- **Nvim**: Neovim beside the tab with a file tree. Needs [herdr-nvim](https://github.com/ChmaraX/herdr-nvim); its installer adds itself to the layout.

## Credits

Mainframe is built on other people's work, all MIT licensed:

- [Over9k](https://github.com/herunan/herdr-over9k): the sidebar, usage rows, To-do, Timeline, menus and dialogs.
- [herdr-agent-ask](https://github.com/sachin-philip/herdr-agent-ask): the Asks panel and its engine.
- [Emergence](https://github.com/shoaibkhanz/emergence): the agents graph, PR review and usage panels.
- [Flockbook](https://github.com/minchenlee/flockbook) and [herdr-nvim](https://github.com/ChmaraX/herdr-nvim): the add-ons.

The Grid, the characters, the bar's grouping, the chrome, the options and the Cyan Matrix theme are new here. Licences: `LICENSE` for what is new, `LICENSES.md` for the rest.
