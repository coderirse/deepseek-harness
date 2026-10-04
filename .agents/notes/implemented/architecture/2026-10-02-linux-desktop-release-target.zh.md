# Agent Note：Linux Desktop 发布目标

Status: implemented

[English](2026-10-02-linux-desktop-release-target.md) | 中文

[打包与更新决策](2026-08-25-electron-desktop-packaging-and-updates.zh.md)拥有本笔记扩展到 Linux 的发布管线。

## 问题

Desktop 应用此前只发布 `mac-arm64`、`mac-x64` 和 `win-x64`。harness 核心（沙箱链、子进程管理、终端、原生 addon、primary runtime）早已把 Linux 当作一等平台，因此缺口只集中在 Electron 外壳：打包目标、主进程的平台守卫、CLI 注册、更新 feed，以及桌面账号身份。

## 决策

`linux-x64` 和 `linux-arm64` 是 Desktop 发布目标。打包在相同架构的 Linux 宿主上运行，与既有的 Windows 宿主门禁一致；不存在跨架构的 Linux 构建。

一次 Linux 运行产出 AppImage、deb 和 rpm。AppImage 是唯一的自动更新通道：electron-updater 的 Linux 更新器是 AppImageUpdater，通道元数据为 `nightly-linux.yml`。deb 或 rpm 安装通过 `APPIMAGE` 环境门禁停用应用内更新器，更新由包管理器负责。本次发布中 Linux 产物不签名；完整性由 feed 的 SHA-512 元数据承载，deb/rpm 的 `maintainer` 标头由操作人员通过 `DSH_DESKTOP_LINUX_MAINTAINER` 提供，GPG 或仓库签名延后处理。打包流程校验 electron-builder 生成的 AppImage `app-update.yml`，而不是重写它。

Linux 外壳使用系统标题栏，不提供托盘，关闭主窗口走普通退出流程：没有托盘和 Dock 的隐藏窗口无法找回。`dsh` 命令注册在 `~/.local/bin/dsh`，无需提权，复用 macOS 的 symlink、receipt 和备份机制；AppImage 安装不提供注册（其临时挂载在退出后消失），命令注册定位为 deb/rpm 集成。账号身份链在 Linux 桌面会话发送 `desktop-linux`（`x-client-platform: desktop-linux`）；Platform 服务端对新值的接受是外部的发布依赖，在确认之前，部署侧保持 Linux 桌面发布不对外，而不是回退身份。

桌面载荷在 Linux 上继续使用 WASM LibreOffice 引擎，直到原生 `libreoffice-kit-linux-*` 发布（引擎包尚未发布到 npm）；沙箱回退继续使用随包的 Landlock 启动器（位于 Bubblewrap 之后），asar 解包列表显式列出 `landlock-run`，因为这个静态启动器的文件名没有可区分的后缀。

已发布的 `@deepseek-ai/libreoffice-kit` 入口包在 ASAR 归档内误判已安装引擎：Electron 的 ASAR 集成 `lstatSync` 对归档内缺失路径不遵守 `throwIfNoEntry`——时而抛出、时而返回虚假 stat——kit 的 `installedPackageExists` 探测因此把未发布的 Linux 引擎误报为已安装，放弃了本应生效的 WASM 回退。`patches/@deepseek-ai__libreoffice-kit.patch` 改为通过读取包清单确认存在，归档层对缺失读取稳定报错；补丁只触及探测函数，kit 修复检测或发布 Linux 引擎后即可移除。由于运行时安装在仓库外的 staging 目录进行，pnpm 看不到根工作区，`prepare:dsh` 会把工作区的全部补丁复制进 staging 项目并声明在其自身的 `pnpm-workspace.yaml` 中；否则隔离安装会静默跳过所有补丁。

## 备选方案

只发布 AppImage（electron-builder 中的残留配置暗示的方案）被否决：需要系统集成能力的分发渠道（deb、rpm）服务的用户是 AppImage 覆盖不到的；代价是出现一种更新器无法触及的第二安装形态，更新器门禁必须诚实地处理它。首版 Linux 复用 web 身份（`desktopPlatform: null`）可以绕开 Platform 服务端依赖，但会把 Linux 桌面使用量永久错误归类，因此身份随发布一起上线，而不是等之后。带托盘的关窗隐藏本可与 Windows 一致，但 Linux 桌面缺乏统一的菜单栏指示器约定，隐藏的窗口无法找回；关窗即退出让每条退出路径都可见。原生 Linux LibreOffice 引擎可以消除 WASM 回退，但当前不存在这样的构建，且回退方案功能可用。

## 后果

- 固定下载名新增 `desktop/dsh-latest-linux-<arch>.AppImage`；上传计划携带 AppImage、blockmap、deb 和 rpm 产物。
- `DesktopPackageTargetName`、更新目标集合和凭据的 `desktopPlatform` 联合类型都加入 `linux`；依赖旧联合类型做分支的消费方必须同步拓宽。
- Linux 的关窗即退出是与 Windows 隐藏到托盘、macOS 隐藏到 Dock 不同的用户可见行为。
