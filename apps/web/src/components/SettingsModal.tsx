import { useEffect, useState } from 'react';
import type { SecretKey, SecretStatus } from '@ogf/contracts';
import { fetchSecrets, setSecret } from '../lib/api.js';
import { I } from './icons.js';

interface SecretRowSpec {
  key: SecretKey;
  label: string;
  hint: string;
  placeholder: string;
}

const ROWS: SecretRowSpec[] = [
  {
    key: 'openai_api_key',
    label: 'OpenAI',
    hint: 'For gpt-image-1 / gpt-image-2 (DALL-E successor).',
    placeholder: 'sk-…',
  },
  {
    key: 'gemini_api_key',
    label: 'Google Gemini',
    hint: 'For Gemini 2.5 Flash Image (Nano Banana) — best multimodal + character consistency.',
    placeholder: 'AIza…',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic',
    hint: 'For Claude. Note: Claude has no image-gen API; this is for the future Claude Code agent.',
    placeholder: 'sk-ant-…',
  },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<SecretStatus[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SecretKey, string>>>({});
  const [revealing, setRevealing] = useState<Partial<Record<SecretKey, boolean>>>({});
  const [saving, setSaving] = useState<Partial<Record<SecretKey, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    void fetchSecrets()
      .then((r) => {
        if (!cancelled) setStatuses(r.secrets);
      })
      .catch(() => {
        if (!cancelled) setStatuses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: SecretKey, value: string | null) {
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const r = await setSecret(key, value);
      setStatuses(r.secrets);
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('setSecret failed', err);
      alert('Failed to save — see console.');
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        style={{ height: 'auto', width: 'min(640px, 100%)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="title">Settings</span>
          <button className="close" onClick={onClose}>
            {I.close}
          </button>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 24, overflowY: 'auto' }}>
          <section>
            <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Image-gen API keys</h3>
            <p className="muted" style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.5 }}>
              For agents that don't have built-in image generation (Claude Code, Gemini CLI, etc).
              Codex CLI users keep using Codex's built-in <code>image_gen</code> — these keys are
              an alternate path, not a replacement. Stored in{' '}
              <code>~/.ogf/secrets.json</code> (mode 600). Environment variables always win.
            </p>
            <div style={{ display: 'grid', gap: 14 }}>
              {ROWS.map((row) => {
                const status = statuses?.find((s) => s.key === row.key);
                const draft = drafts[row.key];
                const isEditing = draft !== undefined;
                const isSaving = saving[row.key];
                const reveal = revealing[row.key];
                return (
                  <div key={row.key} style={{ display: 'grid', gap: 6 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      <span>{row.label}</span>
                      {status?.fromEnv && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            background: 'var(--accent-soft)',
                            color: 'var(--accent)',
                            borderRadius: 4,
                            fontFamily: 'var(--font-mono)',
                          }}
                          title={`Shadowed by env var ${status.envVarName} — unset that to use this UI`}
                        >
                          using {status.envVarName}
                        </span>
                      )}
                      {status?.set && !status.fromEnv && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            background: 'var(--bg-2)',
                            color: 'var(--ink-2)',
                            borderRadius: 4,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          saved
                        </span>
                      )}
                    </div>
                    <p
                      className="muted"
                      style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}
                    >
                      {row.hint}
                    </p>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type={reveal ? 'text' : 'password'}
                        placeholder={
                          status?.fromEnv
                            ? `(from ${status.envVarName})`
                            : status?.set
                              ? status.masked
                              : row.placeholder
                        }
                        value={draft ?? ''}
                        disabled={status?.fromEnv || isSaving}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                        }
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      />
                      {isEditing && draft!.length > 0 && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() =>
                            setRevealing((r) => ({ ...r, [row.key]: !reveal }))
                          }
                          title={reveal ? 'Hide' : 'Show'}
                          disabled={isSaving}
                        >
                          {reveal ? 'hide' : 'show'}
                        </button>
                      )}
                      {isEditing ? (
                        <>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => void save(row.key, draft ?? '')}
                            disabled={isSaving || !draft}
                          >
                            {isSaving ? 'saving…' : 'save'}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() =>
                              setDrafts((d) => {
                                const next = { ...d };
                                delete next[row.key];
                                return next;
                              })
                            }
                            disabled={isSaving}
                          >
                            cancel
                          </button>
                        </>
                      ) : (
                        status?.set &&
                        !status.fromEnv && (
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => void save(row.key, null)}
                            disabled={isSaving}
                            title="Remove this key"
                          >
                            clear
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section
            className="muted"
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              borderTop: '1px solid var(--line)',
              paddingTop: 16,
            }}
          >
            <strong>Storage:</strong> Keys are written to{' '}
            <code>~/.ogf/secrets.json</code> with file mode 600 (owner-only on POSIX; NTFS
            user ACL on Windows). They never leave your machine except when the daemon
            calls the corresponding provider on your behalf.
            <br />
            <br />
            <strong>Environment variables:</strong> If <code>OPENAI_API_KEY</code>,
            <code> GEMINI_API_KEY</code>, or <code>ANTHROPIC_API_KEY</code> are set when
            the daemon starts, those override anything saved here. Useful for CI or
            tools like <code>op run</code> (1Password CLI). Unset the env var to fall
            back to a saved value.
          </section>
        </div>
      </div>
    </div>
  );
}
