/**
 * Self-hosted Monaco setup — NO CDN.
 *
 * `@monaco-editor/react` defaults to loading the editor + its language
 * workers from a CDN at runtime. That breaks offline use and the
 * production build (the daemon serves only our own bundle). Here we:
 *
 *  1. Point the React loader at the locally-bundled `monaco-editor`
 *     package via `loader.config({ monaco })`, so no network fetch
 *     happens.
 *  2. Wire `self.MonacoEnvironment.getWorker` to Vite-bundled web
 *     workers. The `?worker` suffix makes Vite emit each worker as its
 *     own chunk and hands us a constructor — so JSON/CSS/HTML/TS get
 *     real language services and everything else falls back to the
 *     generic editor worker.
 *
 * This module must be imported exactly once, before the first <Editor>
 * mounts. CodePanel imports it at module scope.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Vite worker imports — `?worker` returns a Worker-constructing class.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Set up the worker factory. Monaco asks for a worker by `label`; we
// return the matching language worker (with TS/JS sharing the ts worker)
// and fall back to the generic editor worker for everything else.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

// Use the bundled monaco instead of the CDN. Idempotent in practice
// because this module is only imported once.
loader.config({ monaco });
