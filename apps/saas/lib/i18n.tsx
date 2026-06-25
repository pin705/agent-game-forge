"use client";

// Tiny home-grown i18n layer for the Footage SaaS app — zero dependencies.
//
// Ported from apps/studio/src/lib/i18n.tsx and adapted for Next.js App Router:
//   • Marked "use client" — the provider holds React state + reads localStorage.
//   • SSR-safe: the initial render ALWAYS uses the default locale ('en') so the
//     server HTML and the first client render match (no hydration mismatch). The
//     persisted preference is applied in an effect after mount.
//   • No i18next / react-intl. Just two flat dictionaries + a React context.
//   • t(key, vars?) looks up the active locale, falls back to English, then the
//     raw key. Supports {placeholder} interpolation.
//
// Adding a string: add the key to BOTH `en` and `vi` below, then call
// `t("your.key")` (or `t("your.key", { name })`) in the component. `vi` is a
// `Record<TKey, string>`, so a missing key fails the type-check. That's it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = "en" | "vi";

/** Values interpolated into `{placeholder}` slots. */
export type TVars = Record<string, string | number>;

// ---------------------------------------------------------------------------
// Dictionaries — `en` is the source of truth; `vi` mirrors its keys.
// Keys are namespaced by surface (build.*, code.*, common.*, …).
// ---------------------------------------------------------------------------

const en = {
  // ── Common / shared ──
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.rename": "Rename",
  "common.remove": "Remove",
  "common.open": "Open",
  "common.loading": "Loading…",
  "common.refresh": "Refresh",
  "common.clear": "Clear",
  "common.unsaved": "unsaved",
  "common.comingSoon": "{feature} — coming soon",

  // ── Dashboard hero + game cards (studio parity) ──
  "newGame.title": "What do you want to make?",
  "newGame.subtitle":
    "Describe a game — Footage builds it with free assets and a live preview. Ships at $0.",
  "newGame.placeholder":
    "A sokoban puzzle in a stone dungeon — push crates onto glowing targets…",
  "newGame.create": "Create",
  "newGame.error": "Could not create game",
  "dashboard.createHint": "Enter to create · Shift+Enter for a new line",
  "dashboard.gamesHeading": "Your games",
  "dashboard.empty.body": "Describe a game and Footage builds it for you.",
  "dashboard.duplicate": "Duplicate",
  "dashboard.publish": "Publish",
  "dashboard.card.play": "Play",
  "dashboard.card.edit": "Edit",
  "dashboard.card.editedAgo": "edited {when}",
  "genre.platformer": "Platformer",
  "genre.topDown": "Top-down",
  "genre.towerDefense": "Tower defense",
  "genre.survivor": "Survivor",
  "genre.shmup": "Shmup",
  "genre.gridPuzzle": "Grid puzzle",
  "genre.cardBattler": "Card battler",
  "time.recently": "recently",
  "time.justNow": "just now",
  "time.minutesAgo": "{n}m ago",
  "time.hoursAgo": "{n}h ago",
  "time.daysAgo": "{n}d ago",
  "rename.title": "Rename game",
  "rename.description": "Give this game a new name.",
  "rename.label": "Name",
  "rename.placeholder": "My game",
  "rename.success": "Renamed to “{name}”",
  "rename.failed": "Rename failed: {error}",

  // ── App shell / brand ──
  "app.brand": "Footage",
  "app.settings": "Settings",
  "app.theme": "Toggle light / dark",
  "app.language": "Language",
  "app.language.en": "English",
  "app.language.vi": "Tiếng Việt",
  "app.signOut": "Sign out",
  "app.gallery": "Gallery",
  "app.billing": "Billing & credits",
  "app.newGame": "New game",

  // ── Theme (Batch 4) ──
  "theme.label": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",

  // ── Command palette (Batch 4) ──
  "palette.placeholder": "Type a command or search…",
  "palette.empty": "No matching commands.",
  "palette.open": "Command palette",
  "palette.group.navigate": "Navigate",
  "palette.group.project": "Project",
  "palette.group.files": "Files",
  "palette.group.preferences": "Preferences",
  "palette.cmd.dashboard": "Go to dashboard",
  "palette.cmd.gallery": "Go to gallery",
  "palette.cmd.billing": "Go to billing & credits",
  "palette.cmd.newProject": "New game",
  "palette.cmd.publish": "Publish this project",
  "palette.cmd.focusChat": "Focus chat",
  "palette.cmd.openFile": "Open file: {name}",
  "palette.cmd.toggleTheme": "Toggle theme (light / dark)",
  "palette.cmd.switchLanguage": "Switch language (EN / VI)",
  "palette.cmd.settings": "Open settings",
  "palette.cmd.signOut": "Sign out",
  "palette.cmd.switchProject": "Switch to: {name}",

  // ── Settings dialog (Batch 4, SaaS-appropriate) ──
  "settings.title": "Settings",
  "settings.description": "Appearance, language, and build preferences. Synced on this device.",
  "settings.appearance": "Appearance",
  "settings.defaultModel": "Default build model",
  "settings.defaultModel.hint": "Pre-selected in new chats. Premium tiers are coming soon.",
  "settings.account": "Account",
  "settings.account.email": "Signed in as",
  "settings.account.local": "Local development (not signed in)",
  "settings.account.billing": "Manage billing & credits",

  // ── Status bar (Batch 4) ──
  "status.model": "Model",
  "status.saved": "All changes saved",
  "status.unsaved": "Unsaved changes",
  "status.driver": "Driver",
  "status.project": "Project",

  // ── Delete confirm (Batch 4, reusable) ──
  "delete.title": "Delete {name}?",
  "delete.body": "This can't be undone.",
  "delete.confirm": "Delete",
  "delete.removing": "Deleting…",

  // ── Unsaved-changes guard (Batch 4) ──
  "unsaved.title": "Discard unsaved changes?",
  "unsaved.body": "You have edits in {file} that haven't been saved. Leaving will discard them.",
  "unsaved.discard": "Discard changes",
  "unsaved.keep": "Keep editing",

  // ── Regenerate (Batch 4 — stub; asset re-gen not wired in hosted model) ──
  "regen.comingSoon": "Asset regeneration is coming soon.",

  // ── Build page ──
  "build.free": "$0.00 · free",
  "build.publish": "Publish",
  "build.dashboard": "Dashboard",
  "tab.play": "Play",
  "tab.code": "Code",
  "tab.scene": "Scene",
  "tab.data": "Data",
  "tab.assets": "Assets",

  // ── Workspace panes (SaaS Batch 1) ──
  "workspace.chat": "Chat",
  "workspace.preview": "Preview",
  "workspace.code": "Code",
  "workspace.resizeChat": "Resize chat pane",
  "workspace.resizePreview": "Resize preview pane",

  // ── Chat ──
  "chat.title": "Assistant",
  "chat.placeholder": "Message the agent…",
  "chat.working": "Working…",
  "chat.thinking": "Thinking…",
  "chat.send": "Send",
  "chat.stop": "Stop",
  "chat.empty.title": "Describe your game",
  "chat.empty.body":
    "e.g. “a tiny platformer with a player on two platforms”. The agent builds it in a cloud sandbox and streams every step here.",
  "chat.done": "Done · {steps} steps · {tokens} tokens",
  "chat.awaitingInput": "Waiting for your answer below…",
  "chat.credit": "credit",
  "chat.credits": "credits",
  "chat.balance": "balance {n}",
  "chat.qaFound": "QA: found {n} runtime error(s) — fixing…",
  "chat.qaClean": "QA: game boots + plays clean",
  "chat.qaRemain": "QA: {n} runtime error(s) remain after fixes",

  // ── Conversation history (Batch 2) ──
  "conversations.title": "History",
  "conversations.history": "Conversation history",
  "conversations.new": "New",
  "conversations.untitled": "Untitled chat",
  "conversations.empty": "No conversations yet.",
  "conversations.collapse": "Close history",
  "conversations.rename": "Rename conversation",
  "conversations.deleteChat": "Delete chat",
  "conversations.deleteConfirm": "Delete this conversation and its messages?",
  "conversations.today": "Today",
  "conversations.yesterday": "Yesterday",
  "conversations.previous7": "Previous 7 days",
  "conversations.earlier": "Earlier",
  "conversations.loadFailed": "Could not load conversations: {error}",
  "conversations.newFailed": "Could not create a conversation: {error}",
  "conversations.deleteFailed": "Could not delete the conversation: {error}",
  "conversations.renameFailed": "Could not rename the conversation: {error}",

  // ── Question form (Batch 2) ──
  "form.submit": "Submit",
  "form.submitted": "Submitted",
  "form.need": "Please fill: {fields}",

  // ── Attachments / dropzone (Batch 2) ──
  "dropzone.addReference": "Attach reference image",
  "dropzone.remove": "Remove",
  "dropzone.uploading": "Uploading…",
  "dropzone.dropImages": "Drop images to attach",
  "dropzone.dropFiles": "Only image files can be attached.",
  "dropzone.limit": "You can attach at most {max} images.",
  "dropzone.refAdded": "Reference image added.",
  "dropzone.refsAdded": "{n} reference images added.",
  "dropzone.uploadFailed": "Upload failed: {error}",

  // ── Code panel ──
  "code.files": "Files",
  "code.selectFile": "Select a file to view or edit it.",
  "code.searchFiles": "Search files…",
  "code.noMatch": "No matching files.",
  "code.binary": "Binary file — no preview available.",
  "code.empty": "No files yet. They appear here after a build.",
  "code.loadFailed": "Could not load this file: {error}",
  "code.saveFailed": "Save failed: {error}",
  "code.saved": "Saved",

  // ── Play / live preview pane ──
  "play.play": "Preview",
  "play.reload": "Reload",
  "play.openNewTab": "Open in new tab",
  "play.preview": "Game preview",
  "play.looking": "Looking for a playable build…",
  "play.empty.title": "Nothing to play yet",
  "play.empty.body":
    "Describe your game in the chat and it'll build a playable preview here.",
  "play.checkAgain": "Check again",
  "play.device.desktop": "Desktop width",
  "play.device.mobile": "Mobile width",

  // ── Editor tabs shell (Batch 3) ──
  "editor.pane": "Editor",

  // ── Data / table editor (Batch 3) ──
  "data.title": "Data",
  "data.subtitle": "Edit the game's data/*.json as tables.",
  "data.files": "Data files",
  "data.empty": "No data/*.json files yet. They appear after a build.",
  "data.selectFile": "Select a data file to edit it as a table.",
  "table.loadingFile": "Loading {file}…",
  "table.loadFailed": "Could not load {file}: {error}",
  "table.notEditableText": "This file isn't editable text.",
  "table.notTable": "Not a table",
  "table.noArray": "No array of objects to edit.",
  "table.editRaw": "Edit it as raw JSON in the Code tab.",
  "table.search": "Search rows…",
  "table.addRow": "Add row",
  "table.rootArray": "root array",
  "table.rows": "rows",
  "table.columns": "columns",
  "table.noRows": "No rows yet — add one to get started.",
  "table.noMatch": "No rows match your search.",
  "table.actions": "Actions",
  "table.moveUp": "Move up",
  "table.moveDown": "Move down",
  "table.deleteRow": "Delete row",
  "table.invalidJson": "The file is not valid JSON and can't be saved.",

  // ── Scene editor (Batch 3) ──
  "scene.title": "Scene",
  "scene.empty.title": "No level to edit",
  "scene.empty.body": "Once the agent generates a data/*.json level, you can arrange it visually here.",
  "scene.readFailed": "Could not read levels: {error}",
  "scene.loadFailed": "Could not load this level: {error}",
  "scene.levels": "Levels",
  "scene.loading": "Loading level…",
  "scene.zoomIn": "Zoom in",
  "scene.zoomOut": "Zoom out",
  "scene.fit": "Fit to view",
  "scene.add": "Add object",
  "scene.duplicate": "Duplicate",
  "scene.delete": "Delete",
  "scene.undo": "Undo",
  "scene.redo": "Redo",
  "scene.object": "object",
  "scene.objects": "objects",
  "scene.saving": "Saving…",
  "scene.saved": "Saved",
  "scene.saveFailed": "Save failed",
  "scene.hint": "Drag to move · scroll to zoom · drag empty space to pan",
  "scene.properties": "Properties",
  "scene.noSelection": "Select an object to edit its properties.",

  // ── Assets panel (Batch 3) ──
  "assets.title": "Assets",
  "assets.subtitle": "Images and audio in this project.",
  "assets.freeBadge": "with credits",
  "assets.search": "Search assets…",
  "assets.filterLicense": "License",
  "assets.filterType": "Type",
  "assets.all": "All",
  "assets.loading": "Loading assets…",
  "assets.empty": "No assets yet. They appear here after a build.",
  "assets.noMatch": "No assets match your filters.",
  "assets.loadFailed": "Could not load assets: {error}",
  "assets.col.preview": "Preview",
  "assets.col.asset": "Asset",
  "assets.col.license": "License",
  "assets.col.source": "Source",
  "assets.col.actions": "Actions",
  "assets.unknownAuthor": "unknown author",
  "assets.local": "local",
  "assets.copyPath": "Copy path",
  "assets.copied": "Path copied",
  "assets.preview": "Open preview",
  "assets.delete": "Delete asset",
  "assets.deleteConfirm": "Delete {name}? This removes the file from the project.",
  "assets.deleteFailed": "Could not delete the asset: {error}",
  "assets.slice": "Slice sprite sheet",

  // ── Sprite slicer modal (Batch 3) ──
  "slicer.title": "Slice sprite sheet",
  "slicer.loadingImage": "Loading image…",
  "slicer.notImage": "This file isn't a previewable image.",
  "slicer.columns": "Columns",
  "slicer.rows": "Rows",
  "slicer.padding": "Padding",
  "slicer.offsetX": "Offset X",
  "slicer.offsetY": "Offset Y",
  "slicer.fps": "FPS",
  "slicer.anchor": "Anchor",
  "slicer.frameW": "Frame W",
  "slicer.frameH": "Frame H",
  "slicer.save": "Save slicing",
  "slicer.saved": "Saved {file}",
  "slicer.saveFailed": "Could not save slicing: {error}",
  "slicer.sidecarNote": "Writes {file} next to the sheet.",
} as const;

/** Key union derived from the English dictionary — the source of truth. */
export type TKey = keyof typeof en;

const vi: Record<TKey, string> = {
  // ── Common / shared ──
  "common.save": "Lưu",
  "common.saving": "Đang lưu…",
  "common.cancel": "Hủy",
  "common.delete": "Xóa",
  "common.close": "Đóng",
  "common.rename": "Đổi tên",
  "common.remove": "Gỡ bỏ",
  "common.open": "Mở",
  "common.loading": "Đang tải…",
  "common.refresh": "Làm mới",
  "common.clear": "Xóa",
  "common.unsaved": "chưa lưu",
  "common.comingSoon": "{feature} — sắp ra mắt",

  // ── Dashboard hero + game cards (studio parity) ──
  "newGame.title": "Bạn muốn tạo gì?",
  "newGame.subtitle":
    "Mô tả một trò chơi — Footage tạo nó với tài nguyên miễn phí và bản xem trước trực tiếp. Xuất bản với $0.",
  "newGame.placeholder":
    "Một trò chơi xếp hộp sokoban trong hầm ngục đá — đẩy thùng vào các ô mục tiêu phát sáng…",
  "newGame.create": "Tạo",
  "newGame.error": "Không thể tạo trò chơi",
  "dashboard.createHint": "Enter để tạo · Shift+Enter xuống dòng",
  "dashboard.gamesHeading": "Game của bạn",
  "dashboard.empty.body": "Mô tả một trò chơi và Footage sẽ tạo nó cho bạn.",
  "dashboard.duplicate": "Nhân bản",
  "dashboard.publish": "Phát hành",
  "dashboard.card.play": "Chơi",
  "dashboard.card.edit": "Chỉnh sửa",
  "dashboard.card.editedAgo": "sửa {when}",
  "genre.platformer": "Đi cảnh",
  "genre.topDown": "Nhìn từ trên",
  "genre.towerDefense": "Thủ thành",
  "genre.survivor": "Sinh tồn",
  "genre.shmup": "Bắn súng",
  "genre.gridPuzzle": "Giải đố ô lưới",
  "genre.cardBattler": "Đấu thẻ bài",
  "time.recently": "gần đây",
  "time.justNow": "vừa xong",
  "time.minutesAgo": "{n} phút trước",
  "time.hoursAgo": "{n} giờ trước",
  "time.daysAgo": "{n} ngày trước",
  "rename.title": "Đổi tên trò chơi",
  "rename.description": "Đặt tên mới cho trò chơi này.",
  "rename.label": "Tên",
  "rename.placeholder": "Trò chơi của tôi",
  "rename.success": "Đã đổi tên thành “{name}”",
  "rename.failed": "Đổi tên thất bại: {error}",

  // ── App shell / brand ──
  "app.brand": "Footage",
  "app.settings": "Cài đặt",
  "app.theme": "Chuyển sáng / tối",
  "app.language": "Ngôn ngữ",
  "app.language.en": "English",
  "app.language.vi": "Tiếng Việt",
  "app.signOut": "Đăng xuất",
  "app.gallery": "Thư viện",
  "app.billing": "Thanh toán & tín dụng",
  "app.newGame": "Trò chơi mới",

  // ── Theme (Batch 4) ──
  "theme.label": "Giao diện",
  "theme.light": "Sáng",
  "theme.dark": "Tối",
  "theme.system": "Hệ thống",

  // ── Command palette (Batch 4) ──
  "palette.placeholder": "Nhập lệnh hoặc tìm kiếm…",
  "palette.empty": "Không có lệnh nào khớp.",
  "palette.open": "Bảng lệnh",
  "palette.group.navigate": "Điều hướng",
  "palette.group.project": "Dự án",
  "palette.group.files": "Tệp",
  "palette.group.preferences": "Tùy chọn",
  "palette.cmd.dashboard": "Tới bảng điều khiển",
  "palette.cmd.gallery": "Tới thư viện",
  "palette.cmd.billing": "Tới thanh toán & tín dụng",
  "palette.cmd.newProject": "Trò chơi mới",
  "palette.cmd.publish": "Phát hành dự án này",
  "palette.cmd.focusChat": "Tập trung vào trò chuyện",
  "palette.cmd.openFile": "Mở tệp: {name}",
  "palette.cmd.toggleTheme": "Chuyển giao diện (sáng / tối)",
  "palette.cmd.switchLanguage": "Đổi ngôn ngữ (EN / VI)",
  "palette.cmd.settings": "Mở cài đặt",
  "palette.cmd.signOut": "Đăng xuất",
  "palette.cmd.switchProject": "Chuyển tới: {name}",

  // ── Settings dialog (Batch 4, SaaS-appropriate) ──
  "settings.title": "Cài đặt",
  "settings.description": "Giao diện, ngôn ngữ và tùy chọn dựng. Đồng bộ trên thiết bị này.",
  "settings.appearance": "Giao diện",
  "settings.defaultModel": "Mô hình dựng mặc định",
  "settings.defaultModel.hint": "Được chọn sẵn trong các cuộc trò chuyện mới. Các bậc cao cấp sắp ra mắt.",
  "settings.account": "Tài khoản",
  "settings.account.email": "Đăng nhập với tên",
  "settings.account.local": "Phát triển cục bộ (chưa đăng nhập)",
  "settings.account.billing": "Quản lý thanh toán & tín dụng",

  // ── Status bar (Batch 4) ──
  "status.model": "Mô hình",
  "status.saved": "Đã lưu mọi thay đổi",
  "status.unsaved": "Có thay đổi chưa lưu",
  "status.driver": "Trình điều khiển",
  "status.project": "Dự án",

  // ── Delete confirm (Batch 4, reusable) ──
  "delete.title": "Xóa {name}?",
  "delete.body": "Không thể hoàn tác.",
  "delete.confirm": "Xóa",
  "delete.removing": "Đang xóa…",

  // ── Unsaved-changes guard (Batch 4) ──
  "unsaved.title": "Bỏ các thay đổi chưa lưu?",
  "unsaved.body": "Bạn có chỉnh sửa trong {file} chưa được lưu. Rời đi sẽ bỏ chúng.",
  "unsaved.discard": "Bỏ thay đổi",
  "unsaved.keep": "Tiếp tục chỉnh sửa",

  // ── Regenerate (Batch 4 — stub) ──
  "regen.comingSoon": "Tính năng tạo lại tài nguyên sắp ra mắt.",

  // ── Build page ──
  "build.free": "$0.00 · miễn phí",
  "build.publish": "Phát hành",
  "build.dashboard": "Bảng điều khiển",
  "tab.play": "Chơi",
  "tab.code": "Mã nguồn",
  "tab.scene": "Cảnh",
  "tab.data": "Dữ liệu",
  "tab.assets": "Tài nguyên",

  // ── Workspace panes (SaaS Batch 1) ──
  "workspace.chat": "Trò chuyện",
  "workspace.preview": "Xem trước",
  "workspace.code": "Mã nguồn",
  "workspace.resizeChat": "Đổi cỡ khung trò chuyện",
  "workspace.resizePreview": "Đổi cỡ khung xem trước",

  // ── Chat ──
  "chat.title": "Trợ lý",
  "chat.placeholder": "Nhắn cho trợ lý…",
  "chat.working": "Đang xử lý…",
  "chat.thinking": "Đang suy nghĩ…",
  "chat.send": "Gửi",
  "chat.stop": "Dừng",
  "chat.empty.title": "Mô tả trò chơi của bạn",
  "chat.empty.body":
    "ví dụ “một game đi cảnh nhỏ với người chơi trên hai bệ”. Trợ lý sẽ dựng nó trong sandbox đám mây và truyền từng bước ở đây.",
  "chat.done": "Hoàn tất · {steps} bước · {tokens} token",
  "chat.awaitingInput": "Đang chờ câu trả lời của bạn bên dưới…",
  "chat.credit": "tín dụng",
  "chat.credits": "tín dụng",
  "chat.qaFound": "QA: phát hiện {n} lỗi runtime — đang sửa…",
  "chat.qaClean": "QA: trò chơi khởi động + chạy sạch lỗi",
  "chat.qaRemain": "QA: còn {n} lỗi runtime sau khi sửa",
  "chat.balance": "số dư {n}",

  // ── Conversation history (Batch 2) ──
  "conversations.title": "Lịch sử",
  "conversations.history": "Lịch sử trò chuyện",
  "conversations.new": "Mới",
  "conversations.untitled": "Cuộc trò chuyện chưa đặt tên",
  "conversations.empty": "Chưa có cuộc trò chuyện nào.",
  "conversations.collapse": "Đóng lịch sử",
  "conversations.rename": "Đổi tên cuộc trò chuyện",
  "conversations.deleteChat": "Xóa cuộc trò chuyện",
  "conversations.deleteConfirm": "Xóa cuộc trò chuyện này và tin nhắn của nó?",
  "conversations.today": "Hôm nay",
  "conversations.yesterday": "Hôm qua",
  "conversations.previous7": "7 ngày trước",
  "conversations.earlier": "Trước đó",
  "conversations.loadFailed": "Không thể tải các cuộc trò chuyện: {error}",
  "conversations.newFailed": "Không thể tạo cuộc trò chuyện: {error}",
  "conversations.deleteFailed": "Không thể xóa cuộc trò chuyện: {error}",
  "conversations.renameFailed": "Không thể đổi tên cuộc trò chuyện: {error}",

  // ── Question form (Batch 2) ──
  "form.submit": "Gửi",
  "form.submitted": "Đã gửi",
  "form.need": "Vui lòng điền: {fields}",

  // ── Attachments / dropzone (Batch 2) ──
  "dropzone.addReference": "Đính kèm ảnh tham chiếu",
  "dropzone.remove": "Gỡ bỏ",
  "dropzone.uploading": "Đang tải lên…",
  "dropzone.dropImages": "Thả ảnh để đính kèm",
  "dropzone.dropFiles": "Chỉ có thể đính kèm tệp ảnh.",
  "dropzone.limit": "Bạn chỉ có thể đính kèm tối đa {max} ảnh.",
  "dropzone.refAdded": "Đã thêm ảnh tham chiếu.",
  "dropzone.refsAdded": "Đã thêm {n} ảnh tham chiếu.",
  "dropzone.uploadFailed": "Tải lên thất bại: {error}",

  // ── Code panel ──
  "code.files": "Tệp",
  "code.selectFile": "Chọn một tệp để xem hoặc chỉnh sửa.",
  "code.searchFiles": "Tìm tệp…",
  "code.noMatch": "Không có tệp khớp.",
  "code.binary": "Tệp nhị phân — không có bản xem trước.",
  "code.empty": "Chưa có tệp nào. Chúng sẽ xuất hiện ở đây sau khi dựng.",
  "code.loadFailed": "Không thể tải tệp này: {error}",
  "code.saveFailed": "Lưu thất bại: {error}",
  "code.saved": "Đã lưu",

  // ── Play / live preview pane ──
  "play.play": "Xem trước",
  "play.reload": "Tải lại",
  "play.openNewTab": "Mở trong tab mới",
  "play.preview": "Xem trước trò chơi",
  "play.looking": "Đang tìm bản dựng có thể chơi…",
  "play.empty.title": "Chưa có gì để chơi",
  "play.empty.body":
    "Mô tả trò chơi của bạn trong khung trò chuyện và nó sẽ tạo bản xem trước có thể chơi ở đây.",
  "play.checkAgain": "Kiểm tra lại",
  "play.device.desktop": "Khổ máy tính",
  "play.device.mobile": "Khổ di động",

  // ── Editor tabs shell (Batch 3) ──
  "editor.pane": "Trình chỉnh sửa",

  // ── Data / table editor (Batch 3) ──
  "data.title": "Dữ liệu",
  "data.subtitle": "Chỉnh sửa data/*.json của trò chơi dưới dạng bảng.",
  "data.files": "Tệp dữ liệu",
  "data.empty": "Chưa có tệp data/*.json nào. Chúng xuất hiện sau khi dựng.",
  "data.selectFile": "Chọn một tệp dữ liệu để chỉnh sửa dưới dạng bảng.",
  "table.loadingFile": "Đang tải {file}…",
  "table.loadFailed": "Không thể tải {file}: {error}",
  "table.notEditableText": "Tệp này không phải văn bản chỉnh sửa được.",
  "table.notTable": "Không phải bảng",
  "table.noArray": "Không có mảng đối tượng để chỉnh sửa.",
  "table.editRaw": "Chỉnh sửa dưới dạng JSON thô trong tab Mã nguồn.",
  "table.search": "Tìm hàng…",
  "table.addRow": "Thêm hàng",
  "table.rootArray": "mảng gốc",
  "table.rows": "hàng",
  "table.columns": "cột",
  "table.noRows": "Chưa có hàng nào — thêm một hàng để bắt đầu.",
  "table.noMatch": "Không có hàng nào khớp tìm kiếm.",
  "table.actions": "Hành động",
  "table.moveUp": "Lên trên",
  "table.moveDown": "Xuống dưới",
  "table.deleteRow": "Xóa hàng",
  "table.invalidJson": "Tệp không phải JSON hợp lệ và không thể lưu.",

  // ── Scene editor (Batch 3) ──
  "scene.title": "Cảnh",
  "scene.empty.title": "Không có màn để chỉnh sửa",
  "scene.empty.body": "Khi trợ lý tạo một màn data/*.json, bạn có thể sắp xếp trực quan ở đây.",
  "scene.readFailed": "Không thể đọc các màn: {error}",
  "scene.loadFailed": "Không thể tải màn này: {error}",
  "scene.levels": "Các màn",
  "scene.loading": "Đang tải màn…",
  "scene.zoomIn": "Phóng to",
  "scene.zoomOut": "Thu nhỏ",
  "scene.fit": "Vừa khung",
  "scene.add": "Thêm đối tượng",
  "scene.duplicate": "Nhân bản",
  "scene.delete": "Xóa",
  "scene.undo": "Hoàn tác",
  "scene.redo": "Làm lại",
  "scene.object": "đối tượng",
  "scene.objects": "đối tượng",
  "scene.saving": "Đang lưu…",
  "scene.saved": "Đã lưu",
  "scene.saveFailed": "Lưu thất bại",
  "scene.hint": "Kéo để di chuyển · cuộn để phóng · kéo vùng trống để di khung",
  "scene.properties": "Thuộc tính",
  "scene.noSelection": "Chọn một đối tượng để chỉnh sửa thuộc tính.",

  // ── Assets panel (Batch 3) ──
  "assets.title": "Tài nguyên",
  "assets.subtitle": "Hình ảnh và âm thanh trong dự án này.",
  "assets.freeBadge": "có ghi nguồn",
  "assets.search": "Tìm tài nguyên…",
  "assets.filterLicense": "Giấy phép",
  "assets.filterType": "Loại",
  "assets.all": "Tất cả",
  "assets.loading": "Đang tải tài nguyên…",
  "assets.empty": "Chưa có tài nguyên nào. Chúng xuất hiện ở đây sau khi dựng.",
  "assets.noMatch": "Không có tài nguyên nào khớp bộ lọc.",
  "assets.loadFailed": "Không thể tải tài nguyên: {error}",
  "assets.col.preview": "Xem trước",
  "assets.col.asset": "Tài nguyên",
  "assets.col.license": "Giấy phép",
  "assets.col.source": "Nguồn",
  "assets.col.actions": "Hành động",
  "assets.unknownAuthor": "không rõ tác giả",
  "assets.local": "cục bộ",
  "assets.copyPath": "Sao chép đường dẫn",
  "assets.copied": "Đã sao chép đường dẫn",
  "assets.preview": "Mở xem trước",
  "assets.delete": "Xóa tài nguyên",
  "assets.deleteConfirm": "Xóa {name}? Thao tác này gỡ tệp khỏi dự án.",
  "assets.deleteFailed": "Không thể xóa tài nguyên: {error}",
  "assets.slice": "Cắt sprite sheet",

  // ── Sprite slicer modal (Batch 3) ──
  "slicer.title": "Cắt sprite sheet",
  "slicer.loadingImage": "Đang tải ảnh…",
  "slicer.notImage": "Tệp này không phải ảnh xem trước được.",
  "slicer.columns": "Số cột",
  "slicer.rows": "Số hàng",
  "slicer.padding": "Đệm",
  "slicer.offsetX": "Lệch X",
  "slicer.offsetY": "Lệch Y",
  "slicer.fps": "FPS",
  "slicer.anchor": "Neo",
  "slicer.frameW": "Rộng khung",
  "slicer.frameH": "Cao khung",
  "slicer.save": "Lưu cắt",
  "slicer.saved": "Đã lưu {file}",
  "slicer.saveFailed": "Không thể lưu cắt: {error}",
  "slicer.sidecarNote": "Ghi {file} cạnh sprite sheet.",
};

const dictionaries: Record<Locale, Record<TKey, string>> = { en, vi };

// ---------------------------------------------------------------------------
// Locale resolution + persistence
// ---------------------------------------------------------------------------

const LS_LANG = "ogf_saas_lang";

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "vi";
}

/**
 * Resolve the persisted/browser locale. Only ever called on the CLIENT (in an
 * effect) so SSR stays deterministic on the default. Saved preference → browser
 * language (starts with "vi") → English.
 */
function resolvePersistedLocale(): Locale {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage disabled — fall through to browser detection */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav && nav.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LS_LANG, locale);
  } catch {
    /* quota / disabled storage — silently no-op */
  }
}

/** Interpolate `{placeholder}` slots from `vars`. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

// ---------------------------------------------------------------------------
// Context + provider
// ---------------------------------------------------------------------------

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TKey, vars?: TVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // SSR-safe: render with the default locale on the server AND on the first
  // client render so the hydrated markup matches. The persisted preference is
  // applied right after mount (a brief, single re-render in the user's locale).
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const persisted = resolvePersistedLocale();
    if (persisted !== "en") setLocaleState(persisted);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  const t = useCallback(
    (key: TKey, vars?: TVars): string => {
      const active = dictionaries[locale];
      // active locale → English fallback → raw key.
      const template = active[key] ?? en[key] ?? key;
      return interpolate(template, vars);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}

/** Returns the `t(key, vars?)` translation function for the active locale. */
export function useT(): (key: TKey, vars?: TVars) => string {
  return useI18n().t;
}

/** Returns the active locale and a setter (for the Batch-4 LanguageToggle). */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}
