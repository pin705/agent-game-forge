<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>Die local-first, bring-your-own-agent 2D-Spiele-IDE.</b><br/>
  Codex oder Claude Code steuert. Web heute, Godot und Unity auf der Roadmap.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.pt-BR.md">Português (Brasil)</a> ·
  <b>Deutsch</b> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ar.md">العربية</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.uk.md">Українська</a> ·
  <a href="./README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/0x0funky/agent-game-forge/stargazers"><img src="https://img.shields.io/github/stars/0x0funky/agent-game-forge?style=flat" alt="stars"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"/></a>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

<p align="center">
  🎨 Sprite-Pipeline von <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a>
</p>

---

Agent Game Forge (**AGF**) ist eine Open-Source-Desktop-IDE, mit der ein KI-Coding-Agent komplette 2D-Spiele für dich baut — Sprites, Parallax-Hintergründe, Physik, Gefahren, Pickups, Szenen-Layouts — und dir einen visuellen Editor an die Hand gibt, um per Drag-Tweak zu korrigieren, was der Agent nicht richtig hinbekommen hat. **Du wählst den Agent** (Codex CLI oder Claude Code) und **du wählst die Bildgenerierung** — bring deinen eigenen API-Key mit, oder nutze die in Codex CLI integrierte Bildgenerierung (GPT-Image2). Heute ist die Default-Ausgabe reines JS + Canvas (null Framework-Lock-in, läuft in jedem Browser); Godot 4 und Unity als Engine-Ziele sind auf der Roadmap.

---

## ✨ Auf einen Blick

- 🤖 **Bring deinen eigenen Agent mit** — Codex CLI oder Claude Code. Umschalten in Settings. Live.
- 🎨 **Asset-Pipeline auf Produktionsniveau** — Sprite-Sheet-Chroma-Key, Multi-Action-Animation, 4-Layer-tileable-Parallax + Despill — alles first-class, nicht nachträglich drangeklebt.
- 🖼️ **Bring deine eigene Bildgenerierung mit** — gib einen API-Key für deinen bevorzugten Bildanbieter an, oder nutze die in Codex CLI integrierte Bildgenerierung (GPT-Image2). Keys bleiben auf deinem Rechner.
- 🧱 **Visueller Szenen-Editor** — ziehe Plattformen, Gefahren, Pickups, Collider; Hitbox-Overlay; Live-Reload im Play-Tab.
- 📦 **Multi-Engine auf der Roadmap** — Web (Vanilla JS + Canvas) ist heute am Start mit null Framework-Lock-in (schiebe auf GitHub Pages, es läuft). Godot 4 und Unity als Ziele geplant.
- 💻 **Local-first, Open Source** — Daemon + Web-UI auf `localhost`; deine Projektdateien bleiben auf deiner Platte; Lizenz-Intention im MIT-Stil.
- 💰 **Kosten-transparent** — das Settings-Panel zeigt die heutige Anzahl an Image-Gen-Aufrufen und die geschätzten $-Kosten pro Provider.

---

## 🎬 Demo

**Hero-Shot** — das AGF-Fenster:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF main window" width="800" />
</p>

**Settings** — wähle deinen Agent + API-Keys + Image-Gen-Defaults:

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF Settings modal" width="800" />
</p>

**Szenen-Editor** — ziehe Plattformen, Gefahren, Pickups, Collider:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF Scene editor" width="800" />
</p>

---

## 🚀 Schnellstart

**Voraussetzungen**: Node ≥ 20, npm ≥ 10, und **mindestens eines** von:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

Das startet:

- **Daemon** unter <http://localhost:7621>
- **Web-UI** unter <http://localhost:7620>

Öffne die Web-URL. Klicke auf das Zahnrad-Icon (oben rechts) → **Settings**:

1. **Agent CLI** — wähle Codex oder Claude Code (das, was du installiert hast).
2. **API keys** (nur für den Claude-Code-Pfad nötig) — füge deinen Gemini- oder OpenAI-Key ein. Der Daemon schreibt sie in `~/.ogf/secrets.json` (mode 600). Environment-Variablen (`OPENAI_API_KEY`, `GEMINI_API_KEY`) überschreiben die Datei.
3. **Image-gen defaults** — wähle bevorzugten Provider + Modell.

Schließe Settings. Öffne einen Projektordner. Tippe einen Prompt wie:

> *"Side-Scroll-Platformer über einen Hund, der nach Hause läuft, mit Dach- und Parktor-Levels."*

Senden drücken. Beobachten, wie der Agent ihn baut. **Play** drücken, wenn er fertig ist.

---

## 🧭 Wie es funktioniert

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
Du ─→   │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (routed) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │   (gen-image über
                                    │ (dein key)  │    daemon HTTP)
                                    └─────────────┘
```

**1. Du redest mit dem Agent im Chat.** Die Web-UI streamt die Konversation; SSE leitet jedes Token + jeden Tool-Call weiter.

**2. Der Agent liest die AGF-Conventions und -Skills.** Jedes Projekt wird mit `.ogf/conventions/` (universelle + genre-spezifische Regeln) und `.agents/skills/` (Sprite- und Map-Generierungs-Prozeduren) als Vendored-Copy ausgeliefert. Der Agent folgt den Recipes — er erfindet die Pipeline nicht neu.

**3. Für Bilder ruft der Agent das `/api/gen-image` des Daemons auf** (via `python .agents/tools/gen-image.py` oder direktem `curl`). Der Daemon routet zu Gemini oder OpenAI mit deinem gespeicherten API-Key. Codex-User mit dem eingebauten `image_gen`-Tool können stattdessen dieses nutzen — beide Pfade produzieren äquivalente PNGs.

**4. Der Szenen-Editor liest + schreibt dieselben JSON-Dateien**, die der Agent anlegt. Ziehe eine Plattform; der Editor committet einen JSON-Patch. Aktualisiere die Sicht des Agents; er sieht das Update.

**5. Die Runtime ist das Projekt selbst.** Generierte Spiele sind reines JS + Canvas — `index.html`, `src/*.js`, `data/*.json`, `assets/`. Schiebe den Ordner auf GitHub Pages. Fertig.

---

## 📂 Repository-Aufbau

```
open-game-forge/
├── packages/
│   └── contracts/      # geteilte TypeScript-Typen: API, events, SceneModel
├── apps/
│   ├── daemon/         # Node.js + Express daemon (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (gleiches Muster)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # ~/.ogf/secrets.json Store
│   │       ├── prefs.ts             # ~/.ogf/preferences.json Store
│   │       ├── web-scene.ts         # JSON level → SceneModel loader
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # vendored skills / conventions / recipes
│   └── web/            # Vite + React UI (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # Canvas-basierter Szenen-Editor
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ Aus dem Quellcode bauen

```bash
npm install           # Workspace-Install
npm run build         # build contracts → daemon → web
npm run dev           # Watch-Modus für alle drei (Daemon hot-reload via tsx)
```

Nützliche Befehle:

- `npm -w @ogf/daemon run dev` — nur Daemon, mit `tsx watch`
- `npm -w @ogf/web run dev` — Vite-Dev-Server
- `npm -w @ogf/contracts run build` — Type-Check des contracts-Pakets

---

## 📋 Projektstatus

| Genre | Status | Notizen |
|---|---|---|
| **Side-Scroll-Platformer** | ✅ ausgeliefert | Parallax-Pipeline, Gefahren, Pickups, Gegner, Multi-Level, Sprite-Chroma-Key |
| Top-Down-RPG | 🟡 teilweise | Foundation-Seed + Recipes; einige Recipes noch in Reifung |
| Tower Defense / Arena | 🟡 teilweise | Aus früheren Branches geerbt; braucht Polish |
| Roguelike / Metroidvania | 🟡 teilweise | Nach dem Launch |

**Engine-Ziele**:

| Engine | Status | Notizen |
|---|---|---|
| **Web** (vanilla JS + Canvas) | ✅ Default | Aktiv entwickelt. Null Framework-Abhängigkeit; schiebe auf GitHub Pages und es läuft. |
| **Godot 4** | 🟡 Legacy + Roadmap | Bestehende Godot-Projekte laden + editieren weiterhin. First-Class-Reinvestition auf der Post-Launch-Roadmap. |
| **Unity** | 🚧 geplant | Anvisiert, sobald Godot first-class ist. |

---

## 📚 Dokumentation

- [`docs/architecture.md`](docs/architecture.md) — Design-Prinzipien, Agent-first-Paradigma
- [`docs/roadmap.md`](docs/roadmap.md) — Phasenplan
- [`docs/genre-support.md`](docs/genre-support.md) — Genre-Matrix
- Convention-Dateien (pro Projekt vendored) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- Recipes (pro Projekt vendored) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 Mitwirken

Wir sind pre-launch. Die Codebase ist klein genug, dass PRs willkommen sind, aber bitte öffne zuerst ein Issue, um den Scope zu diskutieren. Beste Wege, gerade jetzt zu helfen:

- **Ausprobieren und Bugs melden** — öffne ein Issue mit dem Daemon-Log (`~/.ogf/claude-code-debug.jsonl` oder dein Shell-Terminal, in dem `npm run dev` läuft)
- **Bau ein Spiel** und zeig es uns — wir würden es gerne im README featuren
- **Auf macOS / Linux testen** — Haupt-Dev arbeitet auf Windows; plattformübergreifende Probleme lauern wahrscheinlich

---

## 🔐 Sicherheit & Daten

- **Dein Code bleibt auf deinem Rechner.** AGF ist local-first. Der Daemon bindet auf `127.0.0.1`; nichts verlässt deinen Rechner außer Aufrufe an den von dir gewählten KI-Provider.
- **API-Keys** werden in `~/.ogf/secrets.json` mit file mode 600 (nur Owner) gespeichert. Sie landen nie in git, erscheinen nie in den Logs von AGF.
- **Konversationen** werden in `~/.ogf/ogf.db` (SQLite) gespeichert. Lösche die Datei zum Zurücksetzen.

---

## 📜 Lizenz

Lizenziert unter der [Apache License, Version 2.0](LICENSE). Du darfst frei verwenden, modifizieren, forken und ausliefern — kommerziell oder nicht. Behalte einfach den Copyright- und Lizenzhinweis bei.

---

## 🙏 Credits

- Daemon-and-Spawn-Muster adaptiert von [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Sprite-Generierungs-Pipeline adaptiert von [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- Gebaut mit Codex CLI + Claude Code — ja, dieses Projekt ist größtenteils von denselben Agents geschrieben, die es steuert

---

<p align="center">
  Gebaut für Indie-Game-Devs, die gerne shippen.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">Bug melden</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
