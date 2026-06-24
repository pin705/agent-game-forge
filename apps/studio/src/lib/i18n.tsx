// Tiny home-grown i18n layer for the OGF studio app — zero dependencies.
//
// Design goals (match the project's $0 / lightweight ethos):
//   • No i18next / react-intl. Just two flat dictionaries + a React context.
//   • Initial locale: localStorage("ogf_studio_lang") → navigator.language
//     (starts with "vi" → Vietnamese) → English fallback.
//   • t(key, vars?) looks up the active locale, falls back to English, then
//     the raw key. Supports {placeholder} interpolation.
//   • Switching locale updates context live (no reload) and persists.
//
// Adding a string: add the key to BOTH `en` and `vi` below, then call
// `t("your.key")` (or `t("your.key", { name })`) in the component. That's it.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = 'en' | 'vi';

/** Values interpolated into `{placeholder}` slots. */
export type TVars = Record<string, string | number>;

// ---------------------------------------------------------------------------
// Dictionaries — `en` is the source of truth; `vi` mirrors its keys.
// Keys are namespaced by surface (dashboard.*, chat.*, common.*, …).
// ---------------------------------------------------------------------------

const en = {
  // ── Common / shared ──
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.rename': 'Rename',
  'common.remove': 'Remove',
  'common.open': 'Open',
  'common.loading': 'Loading…',
  'common.refresh': 'Refresh',
  'common.clear': 'Clear',
  'common.unsaved': 'unsaved',
  'common.comingSoon': '{feature} — coming soon',

  // ── App shell / brand ──
  'app.brand': 'Forge',
  'app.settings': 'Settings',
  'app.theme': 'Toggle light / dark',
  'app.language': 'Language',
  'app.language.en': 'English',
  'app.language.vi': 'Tiếng Việt',

  // ── Dashboard ──
  'dashboard.title': 'Your games',
  'dashboard.subtitle': 'Create, edit, and publish — assets fetched free, $0 to ship.',
  'dashboard.newGame': 'New game',
  'dashboard.empty.title': 'No games yet',
  'dashboard.empty.body': 'Describe a game and Forge builds it for you.',
  'dashboard.empty.cta': 'Create your first game',
  'dashboard.card.play': 'Play',
  'dashboard.card.edit': 'Edit',
  'dashboard.card.duplicate': 'Duplicate',
  'dashboard.card.editedAgo': 'edited {when}',
  'dashboard.duplicate': 'Duplicate',
  'dashboard.publish': 'Publish',
  // relative time
  'time.recently': 'recently',
  'time.justNow': 'just now',
  'time.minutesAgo': '{n}m ago',
  'time.hoursAgo': '{n}h ago',
  'time.daysAgo': '{n}d ago',

  // ── New game ──
  'newGame.back': 'Dashboard',
  'newGame.title': 'What do you want to make?',
  'newGame.subtitle': 'Describe a game — Forge builds it with free assets and a live preview. Ships at $0.',
  'newGame.placeholder': 'A sokoban puzzle in a stone dungeon — push crates onto glowing targets…',
  'newGame.hint': '⌘ / Ctrl + Enter',
  'newGame.create': 'Create',
  'newGame.error': 'Could not create game',
  'genre.platformer': 'Platformer',
  'genre.topDown': 'Top-down',
  'genre.towerDefense': 'Tower defense',
  'genre.survivor': 'Survivor',
  'genre.shmup': 'Shmup',
  'genre.gridPuzzle': 'Grid puzzle',
  'genre.cardBattler': 'Card battler',

  // ── Build page ──
  'build.free': '$0.00 · free',
  'build.publish': 'Publish',
  'build.pendingChanges': 'Pending changes…',
  'build.reviewPack': 'Review sprite pack…',
  'build.importSession': 'Import Codex session…',
  'tab.play': 'Play',
  'tab.scene': 'Scene',
  'tab.assets': 'Assets',
  'tab.data': 'Data',
  'tab.code': 'Code',

  // ── Status bar ──
  'status.free': '$0.00 · assets free',

  // ── Chat ──
  'chat.title': 'Assistant',
  'chat.working': 'Working',
  'chat.empty': 'Describe a change and the Assistant will build it.',
  'chat.placeholder': 'Describe a change…',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.thinking': 'Thinking…',
  'chat.stalled': 'Run stalled — the agent stopped emitting events for 5+ minutes.',
  'chat.running': 'running…',
  'chat.status.streaming': 'Working…',
  'chat.status.done': 'Done',
  'chat.status.failed': 'Failed',
  'chat.status.canceled': 'Stopped',
  'chat.tool.editedFiles': 'Edited files',
  'chat.tool.ranCommand': 'Ran command',
  'chat.tool.thinking': 'Thinking',
  'chat.tool.generatedImage': 'Generated image',
  'chat.tool.fallback': 'Tool',
  'chat.tool.files': '{n} files',
  'chat.tool.truncated': '…(truncated)',

  // ── Conversation list ──
  'conversations.title': 'Chats',
  'conversations.new': 'New',
  'conversations.untitled': 'Untitled chat',
  'conversations.empty': 'No chats yet.',
  'conversations.deleteChat': 'Delete chat',
  'conversations.loadFailed': 'Could not load chats: {error}',
  'conversations.newFailed': 'New chat failed: {error}',
  'conversations.deleteFailed': 'Delete failed: {error}',

  // ── Settings dialog ──
  'settings.title': 'Settings',
  'settings.description': 'Agent, model, and image-generation API keys.',
  'settings.agent.title': 'Agent',
  'settings.agent.hint': 'Default CLI for new conversations.',
  'settings.model': 'Model',
  'settings.model.placeholder': 'Select a model',
  'settings.model.custom': '{model} · (custom)',
  'settings.reasoning': 'Reasoning effort',
  'settings.reasoning.placeholder': 'Select reasoning',
  'settings.reasoning.hint': 'Codex only — higher effort trades latency for thoroughness.',
  'settings.keys.title': 'Image generation API keys',
  'settings.keys.body':
    'For agents without built-in image gen (e.g. Claude Code). Stored by the daemon at ~/.ogf/secrets.json (mode 600). The key never reaches this UI — only a masked status.',
  'settings.usage.title': 'Image-gen usage · last 24h',
  'settings.usage.calls': '{n} calls',
  'settings.usage.call': '{n} call',
  'settings.usage.body':
    'Heuristic estimate (per-image list price × call count). Check the provider dashboard for actual billing.',
  'settings.secret.env': 'env',
  'settings.secret.set': 'set',
  'settings.secret.missing': 'missing',
  'settings.secret.shadowed': 'Shadowed by {env}',
  'settings.secret.fromEnv': '(from {env})',
  'settings.secret.overrideHint': 'Override via {env}. Unset that env var to use a value saved here.',

  // ── Rename dialog ──
  'rename.title': 'Rename game',
  'rename.description': 'Give this game a new name.',
  'rename.label': 'Name',
  'rename.placeholder': 'My game',
  'rename.success': 'Renamed to “{name}”',
  'rename.failed': 'Rename failed: {error}',

  // ── Delete confirm ──
  'delete.title': 'Delete game?',
  'delete.description':
    '“{name}” will be removed from your games. The project files on disk are left untouched — only the studio listing is removed.',
  'delete.removing': 'Removing…',
  'delete.success': 'Removed “{name}”',
  'delete.failed': 'Delete failed: {error}',

  // ── Open project dialog ──
  'openProject.title': 'Open existing project',
  'openProject.description': 'Browse to a folder and register it as a project. Projects are highlighted.',
  'openProject.home': 'Home',
  'openProject.driveList': 'Drive list',
  'openProject.upOne': 'Up one level',
  'openProject.drives': 'Drives',
  'openProject.empty': 'This folder is empty.',
  'openProject.openLabel': 'Open:',
  'openProject.pickFolder': 'Pick a folder',
  'openProject.pickDrive': 'Pick a drive',
  'openProject.openProject': 'Open project',
  'openProject.openFolder': 'Open folder',
  'openProject.success': 'Opened “{name}”',
  'openProject.failed': 'Open failed: {error}',

  // ── Assets panel ──
  'assets.title': 'Assets',
  'assets.subtitle': 'Fetched free, with CC0 / CC-BY license badges.',
  'assets.freeBadge': 'fetched free · $0.00', // rendered after the count, e.g. "3 fetched free · $0.00"
  'assets.loadFailed': 'Failed to load assets: {error}',
  'assets.loading': 'Loading assets…',
  'assets.empty': 'No assets yet. They appear here once the Assistant fetches free art and audio into assets/.',
  'assets.col.preview': 'Preview',
  'assets.col.asset': 'Asset',
  'assets.col.license': 'License',
  'assets.col.source': 'Source',
  'assets.fetchedFree': 'fetched free',
  'assets.unknownAuthor': 'unknown author',
  'assets.local': 'local',

  // ── Scene editor ──
  'scene.empty.title': 'No levels yet',
  'scene.readFailed': "Couldn't read the project files: {error}",
  'scene.empty.body':
    'This project has no level files under data/*.json. Once the Assistant generates a map, it will show up here for drag-editing.',
  'scene.levels': 'Levels',
  'scene.zoomOut': 'Zoom out',
  'scene.zoomIn': 'Zoom in',
  'scene.fit': 'Fit to view',
  'scene.object': 'object',
  'scene.objects': 'objects',
  'scene.saving': 'Saving',
  'scene.saved': 'Saved',
  'scene.saveFailed': 'Save failed',
  'scene.loading': 'Loading scene…',
  'scene.hint': 'Drag objects to move · scroll to zoom · drag empty space to pan',

  // ── Play pane (web) ──
  'play.reload': 'Reload',
  'play.openNewTab': 'Open in new tab',
  'play.stop': 'Stop',
  'play.play': 'Play',
  'play.preview': 'Game preview',
  'play.press': 'Press Play to launch your game.',
  'play.looking': 'Looking for a playable build…',
  'play.empty.title': 'Nothing to play yet',
  'play.empty.body': "Describe your game in the Assistant and it'll build a playable preview here.",
  'play.checkAgain': 'Check again',

  // ── Godot play pane ──
  'godot.clearOutput': 'Clear output',
  'godot.detecting': 'Detecting Godot…',
  'godot.notDetected': 'Godot binary not detected',
  'godot.notDetected.body':
    'The daemon looked on PATH and common install locations. Set the OGF_GODOT environment variable to your Godot executable, or add Godot to your PATH, then restart the daemon.',
  'godot.recheck': 'Re-check',
  'godot.waiting': 'Waiting for output…',
  'godot.press': 'Press Play to launch Godot.',

  // ── Code panel ──
  'code.files': 'Files',
  'code.selectFile': 'Select a file to view or edit it.',
  'code.truncated': 'File truncated — only part of it is shown. Saving would overwrite the full file.',
  'code.binary': 'Binary file — no preview available.',

  // ── Data tab ──
  'data.empty': 'No editable data files yet. The Assistant writes catalogs into data/*.json.',
  'data.catalog': 'Catalog',
  'data.pickFile': 'Pick a data file',

  // ── Entity inspector ──
  'entity.notText': 'Catalog is not editable text.',
  'entity.loading': 'Loading {id}…',
  'entity.loadFailed': 'Failed to load {catalog}: {error}',
  'entity.notFound': 'Entity {id} not found in {catalog}.',
  'entity.noScalarFields': 'No editable scalar fields on this entity. Edit it as raw JSON instead.',
  'entity.fields': 'Fields',

  // ── Table editor ──
  'table.addRow': 'Add row',
  'table.notEditableText': 'File is not editable text.',
  'table.loadFailed': 'Failed to load {file}: {error}',
  'table.loadingFile': 'Loading {file}…',
  'table.edit': 'Edit {label}',
  'table.rootArray': '(root array)',
  'table.rows': 'rows',
  'table.columns': 'columns',
  'table.notTable': 'Not a table',
  'table.noArray': 'No editable array-of-objects found.',
  'table.editRaw': 'Edit this file as raw JSON instead.',
  'table.noRows': 'No rows yet. Use Add row to create one.',
  'table.actions': 'Actions',
  'table.moveUp': 'Move up',
  'table.moveDown': 'Move down',
  'table.deleteRow': 'Delete row',

  // ── Dropzone ──
  'dropzone.limit': 'Limit reached — up to {max} references.',
  'dropzone.dropFiles': 'Drop image files (PNG, JPG, WEBP, …).',
  'dropzone.refAdded': 'Reference added',
  'dropzone.refsAdded': '{n} references added',
  'dropzone.uploadFailed': 'Upload failed: {error}',
  'dropzone.removeFailed': 'Could not remove: {error}',
  'dropzone.uploading': 'Uploading…',
  'dropzone.openProject': 'Open a project to attach references',
  'dropzone.dropImages': 'Drop images',
  'dropzone.clickAttach': 'or click to attach references',
  'dropzone.formats': 'PNG, JPG, WEBP, GIF',
  'dropzone.remove': 'Remove',
  'dropzone.addReference': 'Add reference',

  // ── Question form card ──
  'form.submitted': 'submitted',
  'form.autoSubmit': 'auto-submit in {countdown} · cancel',
  'form.need': 'Need: {fields}',
  'form.submit': 'Submit',
  'form.loadingSpec': 'Loading spec…',
  'form.specNotFound': 'spec.md not found yet — agent is still writing it',
  'form.phase': 'phase',
  'form.phases': 'phases',

  // ── Pending changes modal ──
  'pending.title': 'Pending slicing changes',
  'pending.sheet': 'sheet',
  'pending.sheets': 'sheets',
  'pending.editedLocally': 'edited locally — not yet applied to the engine.',
  'pending.empty': 'No pending changes.',
  'pending.frame': 'Frame',
  'pending.sidecar': 'Sidecar',
  'pending.usedIn': 'Used in',
  'pending.noRefs': '(no references found)',
  'pending.applyHint': 'Applying builds one prompt covering all entries for the agent. You review and send.',
  'pending.revertAll': 'Revert all',
  'pending.applyAll': 'Apply all via Codex',
  'pending.loadFailed': 'Failed to load pending changes',
  'pending.promptCopied': 'Apply prompt copied',
  'pending.promptCopied.desc': 'Paste it into the agent chat and send to apply.',
  'pending.copyFailed': 'Could not copy prompt to clipboard',
  'pending.reverted': 'Reverted {n} pending changes',
  'pending.reverted.desc': 'Sidecars deleted. Engine files were left untouched.',
  'pending.revertFailed': 'Revert failed',

  // ── Pack review modal ──
  'pack.title': 'Review pack',
  'pack.empty': 'No pending packs.',
  'pack.original': 'Original',
  'pack.new': 'New',
  'pack.frames': 'Frames',
  'pack.grid': 'Grid',
  'pack.cellSize': 'Cell size',
  'pack.fps': 'FPS',
  'pack.anchor': 'Anchor',
  'pack.layoutChanged': 'Layout changed — auto-fire a follow-up turn to patch slicing in code/data after apply',
  'pack.discard': 'Discard pack',
  'pack.apply': 'Apply pack',
  'pack.noLiveSheet': 'no live sheet',
  'pack.noStagingSheet': 'no staging sheet',
  'pack.loading': 'loading…',
  'pack.changed': 'changed',
  'pack.reviewTitle': 'Review pack: {entity} / {action}',
  'pack.pendingOf': '{current} of {total} pending · ',
  'pack.fileCount': '{n} files',
  'pack.discarding': 'Discarding…',
  'pack.applying': 'Applying…',
  'pack.applyCount': 'Apply pack ({n} files)',
  'pack.loadFailed': 'Failed to load pending packs',
  'pack.someFailic': 'Some files failed to apply',
  'pack.applied': 'Applied {n} files',
  'pack.layoutCopied': 'Layout changed — code-update prompt copied',
  'pack.layoutCopied.desc': 'Paste it into the agent chat to patch slicing in code/data.',
  'pack.applyFailed': 'Apply failed',
  'pack.discarded': 'Pack discarded',
  'pack.discarded.desc': 'The live folder was untouched.',
  'pack.discardFailed': 'Discard failed',

  // ── Import Codex session modal ──
  'import.title': 'Import Codex session',
  'import.scanning': 'Scanning Codex sessions…',
  'import.empty': 'No Codex sessions found for this project folder.',
  'import.emptyHint': 'Sessions live in ~/.codex/sessions/ and are matched by cwd.',
  'import.user': 'user',
  'import.agent': 'agent',
  'import.importing': 'Importing…',
  'import.import': 'Import',
  'import.body': 'Replays user + agent text; Codex resumes with full rollout memory.',
  'import.loadFailed': 'Could not load sessions: {error}',
  'import.success': 'Session imported — {n} messages restored. Codex resumes with full memory.',
  'import.failed': 'Import failed: {error}',

  // ── Regenerate options modal ──
  'regen.title': 'Regenerate {label}',
  'regen.sprite': 'Regenerate sprite',
  'regen.body': 'This regenerates the entire animation pack.',
  'regen.atomicHint': 'All {count} files in {dir}/ swap atomically when you apply.',
  'regen.siblingsHint': "Other actions of the same entity ({names}) won't be touched.",
  'regen.whatChange': 'What should change?',
  'regen.changePlaceholder':
    "Optional. e.g. 'more aggressive — bigger swings'. Leave blank for a fresh take with the same intent.",
  'regen.matchEntity': 'Match style of other actions of this entity',
  'regen.matchSiblings': 'Match style of sibling sprites in the same folder',
  'regen.scanning': 'scanning…',
  'regen.found': 'found',
  'regen.andMore': '… and {n} more',
  'regen.quick': 'Quick',
  'regen.quickHint': 'agent decides layout',
  'regen.manual': 'Manual',
  'regen.manualHint': 'set frames / grid / fps',
  'regen.aspect': 'Aspect ratio',
  'regen.aspect.same': 'Same as current',
  'regen.aspect.square': '1:1 (square)',
  'regen.aspect.free': 'Free (let model pick)',
  'regen.frames': 'Frames',
  'regen.in': 'in',
  'regen.auto': 'auto',
  'regen.suggestGrid': 'Suggest a grid that matches the frame count',
  'regen.gridMismatch': "cols × rows ({grid}) doesn't match frames ({frames}).",
  'regen.fps': 'FPS',
  'regen.regenerate': 'Regenerate',

  // ── Sprite slicer modal ──
  'slicer.title': 'Sprite frame editor',
  'slicer.loadingImage': 'Loading image…',
  'slicer.columns': 'Columns',
  'slicer.rows': 'Rows',
  'slicer.fps': 'FPS',
  'slicer.notImage': 'Not an image (or could not be read)',
  'slicer.saveFailed': 'Could not save slicing: {error}',
  'slicer.summary': '{frames} frames · {w}×{h}px · {anchor}',
  'slicer.saving': 'Saving…',
  'slicer.askAgentTitle': 'Save and ask the agent to apply this slicing to the engine config',
  'slicer.frameW': 'Frame W',
  'slicer.frameH': 'Frame H',
  'slicer.padding': 'Padding',
  'slicer.offsetX': 'Offset X',
  'slicer.offsetY': 'Offset Y',
  'slicer.anchor': 'Anchor',
  'slicer.preview': 'Animation preview',
  'slicer.frameOf': 'frame {frame} / {total}',
  'slicer.frames': 'frames',
  'slicer.saved': 'saved',
  'slicer.saveMetadata': 'Save metadata',
  'slicer.saveApply': 'Save + Apply via agent',
} as const;

/** Key union derived from the English dictionary — the source of truth. */
export type TKey = keyof typeof en;

const vi: Record<TKey, string> = {
  // ── Common / shared ──
  'common.save': 'Lưu',
  'common.saving': 'Đang lưu…',
  'common.cancel': 'Hủy',
  'common.delete': 'Xóa',
  'common.close': 'Đóng',
  'common.rename': 'Đổi tên',
  'common.remove': 'Gỡ bỏ',
  'common.open': 'Mở',
  'common.loading': 'Đang tải…',
  'common.refresh': 'Làm mới',
  'common.clear': 'Xóa',
  'common.unsaved': 'chưa lưu',
  'common.comingSoon': '{feature} — sắp ra mắt',

  // ── App shell / brand ──
  'app.brand': 'Forge',
  'app.settings': 'Cài đặt',
  'app.theme': 'Chuyển sáng / tối',
  'app.language': 'Ngôn ngữ',
  'app.language.en': 'English',
  'app.language.vi': 'Tiếng Việt',

  // ── Dashboard ──
  'dashboard.title': 'Trò chơi của bạn',
  'dashboard.subtitle': 'Tạo, chỉnh sửa và phát hành — tài nguyên miễn phí, xuất bản với $0.',
  'dashboard.newGame': 'Trò chơi mới',
  'dashboard.empty.title': 'Chưa có trò chơi nào',
  'dashboard.empty.body': 'Mô tả một trò chơi và Forge sẽ tạo nó cho bạn.',
  'dashboard.empty.cta': 'Tạo trò chơi đầu tiên',
  'dashboard.card.play': 'Chơi',
  'dashboard.card.edit': 'Chỉnh sửa',
  'dashboard.card.duplicate': 'Nhân bản',
  'dashboard.card.editedAgo': 'sửa {when}',
  'dashboard.duplicate': 'Nhân bản',
  'dashboard.publish': 'Phát hành',
  'time.recently': 'gần đây',
  'time.justNow': 'vừa xong',
  'time.minutesAgo': '{n} phút trước',
  'time.hoursAgo': '{n} giờ trước',
  'time.daysAgo': '{n} ngày trước',

  // ── New game ──
  'newGame.back': 'Bảng điều khiển',
  'newGame.title': 'Bạn muốn tạo gì?',
  'newGame.subtitle': 'Mô tả một trò chơi — Forge tạo nó với tài nguyên miễn phí và bản xem trước trực tiếp. Xuất bản với $0.',
  'newGame.placeholder': 'Một trò chơi xếp hộp sokoban trong hầm ngục đá — đẩy thùng vào các ô mục tiêu phát sáng…',
  'newGame.hint': '⌘ / Ctrl + Enter',
  'newGame.create': 'Tạo',
  'newGame.error': 'Không thể tạo trò chơi',
  'genre.platformer': 'Đi cảnh',
  'genre.topDown': 'Nhìn từ trên',
  'genre.towerDefense': 'Thủ thành',
  'genre.survivor': 'Sinh tồn',
  'genre.shmup': 'Bắn súng',
  'genre.gridPuzzle': 'Giải đố ô lưới',
  'genre.cardBattler': 'Đấu thẻ bài',

  // ── Build page ──
  'build.free': '$0.00 · miễn phí',
  'build.publish': 'Phát hành',
  'build.pendingChanges': 'Thay đổi đang chờ…',
  'build.reviewPack': 'Xem lại gói sprite…',
  'build.importSession': 'Nhập phiên Codex…',
  'tab.play': 'Chơi',
  'tab.scene': 'Cảnh',
  'tab.assets': 'Tài nguyên',
  'tab.data': 'Dữ liệu',
  'tab.code': 'Mã nguồn',

  // ── Status bar ──
  'status.free': '$0.00 · tài nguyên miễn phí',

  // ── Chat ──
  'chat.title': 'Trợ lý',
  'chat.working': 'Đang xử lý',
  'chat.empty': 'Mô tả một thay đổi và Trợ lý sẽ thực hiện.',
  'chat.placeholder': 'Mô tả một thay đổi…',
  'chat.send': 'Gửi',
  'chat.stop': 'Dừng',
  'chat.thinking': 'Đang suy nghĩ…',
  'chat.stalled': 'Tiến trình bị treo — tác nhân đã ngừng phát sự kiện hơn 5 phút.',
  'chat.running': 'đang chạy…',
  'chat.status.streaming': 'Đang xử lý…',
  'chat.status.done': 'Hoàn tất',
  'chat.status.failed': 'Thất bại',
  'chat.status.canceled': 'Đã dừng',
  'chat.tool.editedFiles': 'Đã sửa tệp',
  'chat.tool.ranCommand': 'Đã chạy lệnh',
  'chat.tool.thinking': 'Đang suy nghĩ',
  'chat.tool.generatedImage': 'Đã tạo ảnh',
  'chat.tool.fallback': 'Công cụ',
  'chat.tool.files': '{n} tệp',
  'chat.tool.truncated': '…(đã cắt bớt)',

  // ── Conversation list ──
  'conversations.title': 'Cuộc trò chuyện',
  'conversations.new': 'Mới',
  'conversations.untitled': 'Trò chuyện chưa đặt tên',
  'conversations.empty': 'Chưa có cuộc trò chuyện nào.',
  'conversations.deleteChat': 'Xóa cuộc trò chuyện',
  'conversations.loadFailed': 'Không thể tải cuộc trò chuyện: {error}',
  'conversations.newFailed': 'Tạo cuộc trò chuyện mới thất bại: {error}',
  'conversations.deleteFailed': 'Xóa thất bại: {error}',

  // ── Settings dialog ──
  'settings.title': 'Cài đặt',
  'settings.description': 'Tác nhân, mô hình và khóa API tạo ảnh.',
  'settings.agent.title': 'Tác nhân',
  'settings.agent.hint': 'CLI mặc định cho cuộc trò chuyện mới.',
  'settings.model': 'Mô hình',
  'settings.model.placeholder': 'Chọn mô hình',
  'settings.model.custom': '{model} · (tùy chỉnh)',
  'settings.reasoning': 'Mức độ suy luận',
  'settings.reasoning.placeholder': 'Chọn mức suy luận',
  'settings.reasoning.hint': 'Chỉ dành cho Codex — mức độ cao hơn đánh đổi tốc độ lấy sự kỹ lưỡng.',
  'settings.keys.title': 'Khóa API tạo ảnh',
  'settings.keys.body':
    'Dành cho các tác nhân không có sẵn tính năng tạo ảnh (ví dụ Claude Code). Được daemon lưu tại ~/.ogf/secrets.json (chế độ 600). Khóa không bao giờ tới giao diện này — chỉ hiển thị trạng thái đã che.',
  'settings.usage.title': 'Mức dùng tạo ảnh · 24 giờ qua',
  'settings.usage.calls': '{n} lần gọi',
  'settings.usage.call': '{n} lần gọi',
  'settings.usage.body':
    'Ước tính theo kinh nghiệm (giá niêm yết mỗi ảnh × số lần gọi). Kiểm tra bảng điều khiển nhà cung cấp để biết hóa đơn thực tế.',
  'settings.secret.env': 'env',
  'settings.secret.set': 'đã đặt',
  'settings.secret.missing': 'thiếu',
  'settings.secret.shadowed': 'Bị ghi đè bởi {env}',
  'settings.secret.fromEnv': '(từ {env})',
  'settings.secret.overrideHint': 'Ghi đè qua {env}. Bỏ đặt biến môi trường đó để dùng giá trị lưu ở đây.',

  // ── Rename dialog ──
  'rename.title': 'Đổi tên trò chơi',
  'rename.description': 'Đặt tên mới cho trò chơi này.',
  'rename.label': 'Tên',
  'rename.placeholder': 'Trò chơi của tôi',
  'rename.success': 'Đã đổi tên thành “{name}”',
  'rename.failed': 'Đổi tên thất bại: {error}',

  // ── Delete confirm ──
  'delete.title': 'Xóa trò chơi?',
  'delete.description':
    '“{name}” sẽ bị gỡ khỏi danh sách trò chơi của bạn. Các tệp dự án trên ổ đĩa vẫn được giữ nguyên — chỉ mục liệt kê trong studio bị xóa.',
  'delete.removing': 'Đang gỡ…',
  'delete.success': 'Đã gỡ “{name}”',
  'delete.failed': 'Xóa thất bại: {error}',

  // ── Open project dialog ──
  'openProject.title': 'Mở dự án có sẵn',
  'openProject.description': 'Duyệt đến một thư mục và đăng ký nó làm dự án. Các dự án được tô sáng.',
  'openProject.home': 'Trang chủ',
  'openProject.driveList': 'Danh sách ổ đĩa',
  'openProject.upOne': 'Lên một cấp',
  'openProject.drives': 'Ổ đĩa',
  'openProject.empty': 'Thư mục này trống.',
  'openProject.openLabel': 'Mở:',
  'openProject.pickFolder': 'Chọn một thư mục',
  'openProject.pickDrive': 'Chọn một ổ đĩa',
  'openProject.openProject': 'Mở dự án',
  'openProject.openFolder': 'Mở thư mục',
  'openProject.success': 'Đã mở “{name}”',
  'openProject.failed': 'Mở thất bại: {error}',

  // ── Assets panel ──
  'assets.title': 'Tài nguyên',
  'assets.subtitle': 'Lấy miễn phí, kèm huy hiệu giấy phép CC0 / CC-BY.',
  'assets.freeBadge': 'lấy miễn phí · $0.00',
  'assets.loadFailed': 'Không thể tải tài nguyên: {error}',
  'assets.loading': 'Đang tải tài nguyên…',
  'assets.empty': 'Chưa có tài nguyên nào. Chúng sẽ xuất hiện ở đây khi Trợ lý lấy hình ảnh và âm thanh miễn phí vào assets/.',
  'assets.col.preview': 'Xem trước',
  'assets.col.asset': 'Tài nguyên',
  'assets.col.license': 'Giấy phép',
  'assets.col.source': 'Nguồn',
  'assets.fetchedFree': 'lấy miễn phí',
  'assets.unknownAuthor': 'tác giả không rõ',
  'assets.local': 'cục bộ',

  // ── Scene editor ──
  'scene.empty.title': 'Chưa có màn chơi nào',
  'scene.readFailed': 'Không thể đọc các tệp dự án: {error}',
  'scene.empty.body':
    'Dự án này chưa có tệp màn chơi nào trong data/*.json. Khi Trợ lý tạo bản đồ, nó sẽ hiển thị ở đây để chỉnh sửa bằng kéo thả.',
  'scene.levels': 'Màn chơi',
  'scene.zoomOut': 'Thu nhỏ',
  'scene.zoomIn': 'Phóng to',
  'scene.fit': 'Vừa khung nhìn',
  'scene.object': 'đối tượng',
  'scene.objects': 'đối tượng',
  'scene.saving': 'Đang lưu',
  'scene.saved': 'Đã lưu',
  'scene.saveFailed': 'Lưu thất bại',
  'scene.loading': 'Đang tải cảnh…',
  'scene.hint': 'Kéo đối tượng để di chuyển · cuộn để thu phóng · kéo vùng trống để di chuyển khung',

  // ── Play pane (web) ──
  'play.reload': 'Tải lại',
  'play.openNewTab': 'Mở trong tab mới',
  'play.stop': 'Dừng',
  'play.play': 'Chơi',
  'play.preview': 'Xem trước trò chơi',
  'play.press': 'Nhấn Chơi để khởi chạy trò chơi của bạn.',
  'play.looking': 'Đang tìm bản dựng có thể chơi…',
  'play.empty.title': 'Chưa có gì để chơi',
  'play.empty.body': 'Mô tả trò chơi của bạn trong Trợ lý và nó sẽ tạo bản xem trước có thể chơi ở đây.',
  'play.checkAgain': 'Kiểm tra lại',

  // ── Godot play pane ──
  'godot.clearOutput': 'Xóa kết quả',
  'godot.detecting': 'Đang dò tìm Godot…',
  'godot.notDetected': 'Không phát hiện tệp thực thi Godot',
  'godot.notDetected.body':
    'Daemon đã tìm trong PATH và các vị trí cài đặt thông dụng. Hãy đặt biến môi trường OGF_GODOT trỏ đến tệp thực thi Godot, hoặc thêm Godot vào PATH, rồi khởi động lại daemon.',
  'godot.recheck': 'Kiểm tra lại',
  'godot.waiting': 'Đang chờ kết quả…',
  'godot.press': 'Nhấn Chơi để khởi chạy Godot.',

  // ── Code panel ──
  'code.files': 'Tệp',
  'code.selectFile': 'Chọn một tệp để xem hoặc chỉnh sửa.',
  'code.truncated': 'Tệp đã bị cắt — chỉ hiển thị một phần. Lưu sẽ ghi đè toàn bộ tệp.',
  'code.binary': 'Tệp nhị phân — không có bản xem trước.',

  // ── Data tab ──
  'data.empty': 'Chưa có tệp dữ liệu nào có thể chỉnh sửa. Trợ lý ghi danh mục vào data/*.json.',
  'data.catalog': 'Danh mục',
  'data.pickFile': 'Chọn một tệp dữ liệu',

  // ── Entity inspector ──
  'entity.notText': 'Danh mục không phải văn bản chỉnh sửa được.',
  'entity.loading': 'Đang tải {id}…',
  'entity.loadFailed': 'Không thể tải {catalog}: {error}',
  'entity.notFound': 'Không tìm thấy thực thể {id} trong {catalog}.',
  'entity.noScalarFields': 'Thực thể này không có trường vô hướng chỉnh sửa được. Hãy chỉnh sửa dưới dạng JSON thô.',
  'entity.fields': 'Trường',

  // ── Table editor ──
  'table.addRow': 'Thêm hàng',
  'table.notEditableText': 'Tệp không phải văn bản chỉnh sửa được.',
  'table.loadFailed': 'Không thể tải {file}: {error}',
  'table.loadingFile': 'Đang tải {file}…',
  'table.edit': 'Chỉnh sửa {label}',
  'table.rootArray': '(mảng gốc)',
  'table.rows': 'hàng',
  'table.columns': 'cột',
  'table.notTable': 'Không phải bảng',
  'table.noArray': 'Không tìm thấy mảng đối tượng nào có thể chỉnh sửa.',
  'table.editRaw': 'Hãy chỉnh sửa tệp này dưới dạng JSON thô.',
  'table.noRows': 'Chưa có hàng nào. Dùng Thêm hàng để tạo.',
  'table.actions': 'Thao tác',
  'table.moveUp': 'Di chuyển lên',
  'table.moveDown': 'Di chuyển xuống',
  'table.deleteRow': 'Xóa hàng',

  // ── Dropzone ──
  'dropzone.limit': 'Đã đạt giới hạn — tối đa {max} tệp tham chiếu.',
  'dropzone.dropFiles': 'Thả tệp ảnh (PNG, JPG, WEBP, …).',
  'dropzone.refAdded': 'Đã thêm tham chiếu',
  'dropzone.refsAdded': 'Đã thêm {n} tham chiếu',
  'dropzone.uploadFailed': 'Tải lên thất bại: {error}',
  'dropzone.removeFailed': 'Không thể gỡ bỏ: {error}',
  'dropzone.uploading': 'Đang tải lên…',
  'dropzone.openProject': 'Mở một dự án để đính kèm tham chiếu',
  'dropzone.dropImages': 'Thả ảnh vào đây',
  'dropzone.clickAttach': 'hoặc nhấn để đính kèm tham chiếu',
  'dropzone.formats': 'PNG, JPG, WEBP, GIF',
  'dropzone.remove': 'Gỡ bỏ',
  'dropzone.addReference': 'Thêm tham chiếu',

  // ── Question form card ──
  'form.submitted': 'đã gửi',
  'form.autoSubmit': 'tự động gửi sau {countdown} · hủy',
  'form.need': 'Cần: {fields}',
  'form.submit': 'Gửi',
  'form.loadingSpec': 'Đang tải đặc tả…',
  'form.specNotFound': 'chưa tìm thấy spec.md — tác nhân vẫn đang viết',
  'form.phase': 'giai đoạn',
  'form.phases': 'giai đoạn',

  // ── Pending changes modal ──
  'pending.title': 'Thay đổi cắt sprite đang chờ',
  'pending.sheet': 'bảng',
  'pending.sheets': 'bảng',
  'pending.editedLocally': 'đã sửa cục bộ — chưa áp dụng vào engine.',
  'pending.empty': 'Không có thay đổi đang chờ.',
  'pending.frame': 'Khung',
  'pending.sidecar': 'Tệp đi kèm',
  'pending.usedIn': 'Dùng trong',
  'pending.noRefs': '(không tìm thấy tham chiếu)',
  'pending.applyHint': 'Việc áp dụng sẽ tạo một lời nhắc bao gồm tất cả các mục cho tác nhân. Bạn xem lại và gửi.',
  'pending.revertAll': 'Hoàn tác tất cả',
  'pending.applyAll': 'Áp dụng tất cả qua Codex',
  'pending.loadFailed': 'Không thể tải các thay đổi đang chờ',
  'pending.promptCopied': 'Đã sao chép lời nhắc áp dụng',
  'pending.promptCopied.desc': 'Dán vào khung trò chuyện với tác nhân và gửi để áp dụng.',
  'pending.copyFailed': 'Không thể sao chép lời nhắc vào bộ nhớ tạm',
  'pending.reverted': 'Đã hoàn tác {n} thay đổi đang chờ',
  'pending.reverted.desc': 'Đã xóa các tệp đi kèm. Tệp engine được giữ nguyên.',
  'pending.revertFailed': 'Hoàn tác thất bại',

  // ── Pack review modal ──
  'pack.title': 'Xem lại gói',
  'pack.empty': 'Không có gói nào đang chờ.',
  'pack.original': 'Gốc',
  'pack.new': 'Mới',
  'pack.frames': 'Khung hình',
  'pack.grid': 'Lưới',
  'pack.cellSize': 'Kích thước ô',
  'pack.fps': 'FPS',
  'pack.anchor': 'Điểm neo',
  'pack.layoutChanged': 'Bố cục đã thay đổi — tự động gửi một lượt tiếp theo để vá phần cắt sprite trong mã/dữ liệu sau khi áp dụng',
  'pack.discard': 'Bỏ gói',
  'pack.apply': 'Áp dụng gói',
  'pack.noLiveSheet': 'không có bảng trực tiếp',
  'pack.noStagingSheet': 'không có bảng tạm',
  'pack.loading': 'đang tải…',
  'pack.changed': 'đã đổi',
  'pack.reviewTitle': 'Xem lại gói: {entity} / {action}',
  'pack.pendingOf': '{current} / {total} đang chờ · ',
  'pack.fileCount': '{n} tệp',
  'pack.discarding': 'Đang bỏ…',
  'pack.applying': 'Đang áp dụng…',
  'pack.applyCount': 'Áp dụng gói ({n} tệp)',
  'pack.loadFailed': 'Không thể tải các gói đang chờ',
  'pack.someFailic': 'Một số tệp áp dụng thất bại',
  'pack.applied': 'Đã áp dụng {n} tệp',
  'pack.layoutCopied': 'Bố cục đã thay đổi — đã sao chép lời nhắc cập nhật mã',
  'pack.layoutCopied.desc': 'Dán vào khung trò chuyện với tác nhân để vá phần cắt sprite trong mã/dữ liệu.',
  'pack.applyFailed': 'Áp dụng thất bại',
  'pack.discarded': 'Đã bỏ gói',
  'pack.discarded.desc': 'Thư mục trực tiếp không bị thay đổi.',
  'pack.discardFailed': 'Bỏ gói thất bại',

  // ── Import Codex session modal ──
  'import.title': 'Nhập phiên Codex',
  'import.scanning': 'Đang quét các phiên Codex…',
  'import.empty': 'Không tìm thấy phiên Codex nào cho thư mục dự án này.',
  'import.emptyHint': 'Các phiên nằm trong ~/.codex/sessions/ và được khớp theo cwd.',
  'import.user': 'người dùng',
  'import.agent': 'tác nhân',
  'import.importing': 'Đang nhập…',
  'import.import': 'Nhập',
  'import.body': 'Phát lại văn bản người dùng + tác nhân; Codex tiếp tục với toàn bộ bộ nhớ phiên.',
  'import.loadFailed': 'Không thể tải các phiên: {error}',
  'import.success': 'Đã nhập phiên — khôi phục {n} tin nhắn. Codex tiếp tục với toàn bộ bộ nhớ.',
  'import.failed': 'Nhập thất bại: {error}',

  // ── Regenerate options modal ──
  'regen.title': 'Tạo lại {label}',
  'regen.sprite': 'Tạo lại sprite',
  'regen.body': 'Thao tác này tạo lại toàn bộ gói hoạt ảnh.',
  'regen.atomicHint': 'Tất cả {count} tệp trong {dir}/ được hoán đổi đồng thời khi bạn áp dụng.',
  'regen.siblingsHint': 'Các hành động khác của cùng thực thể ({names}) sẽ không bị ảnh hưởng.',
  'regen.whatChange': 'Cần thay đổi điều gì?',
  'regen.changePlaceholder':
    "Tùy chọn. Ví dụ 'mạnh mẽ hơn — vung tay rộng hơn'. Để trống để có phiên bản mới với cùng ý định.",
  'regen.matchEntity': 'Khớp phong cách với các hành động khác của thực thể này',
  'regen.matchSiblings': 'Khớp phong cách với các sprite cùng thư mục',
  'regen.scanning': 'đang quét…',
  'regen.found': 'tìm thấy',
  'regen.andMore': '… và {n} tệp nữa',
  'regen.quick': 'Nhanh',
  'regen.quickHint': 'tác nhân quyết định bố cục',
  'regen.manual': 'Thủ công',
  'regen.manualHint': 'đặt khung / lưới / fps',
  'regen.aspect': 'Tỉ lệ khung hình',
  'regen.aspect.same': 'Giống hiện tại',
  'regen.aspect.square': '1:1 (vuông)',
  'regen.aspect.free': 'Tự do (để mô hình chọn)',
  'regen.frames': 'Khung hình',
  'regen.in': 'trong',
  'regen.auto': 'tự động',
  'regen.suggestGrid': 'Đề xuất lưới khớp với số khung hình',
  'regen.gridMismatch': 'cột × hàng ({grid}) không khớp với số khung hình ({frames}).',
  'regen.fps': 'FPS',
  'regen.regenerate': 'Tạo lại',

  // ── Sprite slicer modal ──
  'slicer.title': 'Trình chỉnh khung sprite',
  'slicer.loadingImage': 'Đang tải ảnh…',
  'slicer.columns': 'Số cột',
  'slicer.rows': 'Số hàng',
  'slicer.fps': 'FPS',
  'slicer.notImage': 'Không phải ảnh (hoặc không đọc được)',
  'slicer.saveFailed': 'Không thể lưu cắt khung: {error}',
  'slicer.summary': '{frames} khung hình · {w}×{h}px · {anchor}',
  'slicer.saving': 'Đang lưu…',
  'slicer.askAgentTitle': 'Lưu và yêu cầu tác nhân áp dụng cách cắt này vào cấu hình engine',
  'slicer.frameW': 'Rộng khung',
  'slicer.frameH': 'Cao khung',
  'slicer.padding': 'Đệm',
  'slicer.offsetX': 'Lệch X',
  'slicer.offsetY': 'Lệch Y',
  'slicer.anchor': 'Điểm neo',
  'slicer.preview': 'Xem trước hoạt ảnh',
  'slicer.frameOf': 'khung {frame} / {total}',
  'slicer.frames': 'khung hình',
  'slicer.saved': 'đã lưu',
  'slicer.saveMetadata': 'Lưu siêu dữ liệu',
  'slicer.saveApply': 'Lưu + Áp dụng qua tác nhân',
};

const dictionaries: Record<Locale, Record<TKey, string>> = { en, vi };

// ---------------------------------------------------------------------------
// Locale resolution + persistence
// ---------------------------------------------------------------------------

const LS_LANG = 'ogf_studio_lang';

function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'vi';
}

/** Resolve the initial locale: saved preference → browser language → English. */
export function resolveInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage disabled — fall through to browser detection */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav && nav.toLowerCase().startsWith('vi') ? 'vi' : 'en';
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
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale());

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

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}

/** Returns the `t(key, vars?)` translation function for the active locale. */
export function useT(): (key: TKey, vars?: TVars) => string {
  return useI18n().t;
}

/** Returns the active locale and a setter. */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}
