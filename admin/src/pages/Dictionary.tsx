import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { loadTerms, mergeTerms, updateTerm, type TermRow, type TermSort } from '../lib/api';
import { dateTime, levelShort, num, shortId } from '../lib/format';

const PAGE_SIZE = 25;
const LEVELS = [0, 1, 2, 3, 4, 5, 6];

export default function Dictionary() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  const [sort, setSort] = useState<TermSort>('learners');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<TermRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: 'edit' | 'merge' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadTerms({ search: query, level, sort, page, pageSize: PAGE_SIZE }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được từ điển');
    } finally {
      setLoading(false);
    }
  }, [query, level, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = rows[0]?.total_count ?? 0;
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

  return (
    <section>
      <div className="spread">
        <div>
          <h1>Từ điển</h1>
          <p className="muted small">
            Từ dùng chung cho mọi người: sửa nghĩa/IPA/level ở đây là sửa cho tất cả. Tiến trình học của
            từng người vẫn riêng.
          </p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>

      {notice && <p className="ok" style={{ marginTop: 12 }}>{notice}</p>}
      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

      <div className="card" style={{ marginTop: 16 }}>
        <form
          className="row"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setPage(0);
            setQuery(search);
          }}
        >
          <input
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Tìm từ…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            value={level === null ? '' : String(level)}
            onChange={(event) => {
              setLevel(event.target.value === '' ? null : Number(event.target.value));
              setPage(0);
            }}
          >
            <option value="">Mọi level</option>
            {LEVELS.map((value) => (
              <option key={value} value={value}>{levelShort(value)}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as TermSort);
              setPage(0);
            }}
          >
            <option value="learners">Nhiều người học</option>
            <option value="newest">Mới thêm</option>
            <option value="level">Level cao</option>
            <option value="az">A → Z</option>
          </select>
          <button className="btn" type="submit">Tìm</button>
        </form>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Từ</th>
                <th>Nghĩa</th>
                <th>Level</th>
                <th className="num">Người học</th>
                <th className="num">Đến hạn</th>
                <th>Cập nhật</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  open={open?.id === row.id ? open.mode : null}
                  onOpen={(mode) => setOpen(open?.id === row.id && open.mode === mode ? null : { id: row.id, mode })}
                  onChanged={(message) => {
                    setNotice(message);
                    setOpen(null);
                    void load();
                  }}
                />
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: 18 }}>
                    Không có từ nào khớp. Từ điển sẽ có dữ liệu sau khi app tạo từ lần đầu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <button className="btn" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
            ← Trước
          </button>
          <span className="small muted">Trang {page + 1}/{lastPage + 1} · {num(total)} từ</span>
          <button className="btn" disabled={page >= lastPage || loading} onClick={() => setPage((p) => p + 1)}>
            Sau →
          </button>
        </div>
      </div>
    </section>
  );
}

function Row({
  row,
  open,
  onOpen,
  onChanged,
}: {
  row: TermRow;
  open: 'edit' | 'merge' | null;
  onOpen: (mode: 'edit' | 'merge') => void;
  onChanged: (message: string) => void;
}) {
  return (
    <>
      <tr>
        <td>
          <div>{row.term}</div>
          <div className="muted small">
            {[row.part_of_speech, row.ipa, row.level_source === 'ai' ? 'AI xếp' : row.level_source]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </td>
        <td style={{ maxWidth: 280 }}>{row.meaning_vi ?? <span className="muted">—</span>}</td>
        <td><span className="badge">{levelShort(row.level)}</span></td>
        <td className="num">{num(Number(row.learners))}</td>
        <td className="num">{num(Number(row.due_now))}</td>
        <td>{dateTime(row.updated_at)}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn small-btn" onClick={() => onOpen('edit')}>Sửa</button>{' '}
          <button className="btn small-btn" onClick={() => onOpen('merge')}>Gộp</button>
        </td>
      </tr>
      {open === 'edit' && (
        <tr>
          <td colSpan={7}>
            <EditForm row={row} onSaved={() => onChanged(`Đã lưu "${row.term}".`)} />
          </td>
        </tr>
      )}
      {open === 'merge' && (
        <tr>
          <td colSpan={7}>
            <MergePanel row={row} onMerged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function EditForm({ row, onSaved }: { row: TermRow; onSaved: () => void }) {
  const [form, setForm] = useState({
    meaning_vi: row.meaning_vi ?? '',
    definition_en: row.definition_en ?? '',
    ipa: row.ipa ?? '',
    part_of_speech: row.part_of_speech ?? '',
    example_en: row.example_en ?? '',
    example_vi: row.example_vi ?? '',
    level: row.level,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateTerm(row.id, {
        meaning_vi: form.meaning_vi.trim() || null,
        definition_en: form.definition_en.trim() || null,
        ipa: form.ipa.trim() || null,
        part_of_speech: form.part_of_speech.trim() || null,
        example_en: form.example_en.trim() || null,
        example_vi: form.example_vi.trim() || null,
        level: form.level,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} style={{ margin: '8px 0' }}>
      <h3>Sửa “{row.term}”</h3>
      <p className="muted small">
        Thay đổi áp dụng cho mọi người đang học từ này. Không đụng tới tiến trình của họ.
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Nghĩa tiếng Việt</span>
          <input
            value={form.meaning_vi}
            onChange={(e) => setForm({ ...form, meaning_vi: e.target.value })}
          />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Định nghĩa tiếng Anh</span>
          <input
            value={form.definition_en}
            onChange={(e) => setForm({ ...form, definition_en: e.target.value })}
          />
        </label>
        <label className="field" style={{ width: 140 }}>
          <span>Level</span>
          <select
            value={form.level}
            onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}
          >
            {LEVELS.map((value) => (
              <option key={value} value={value}>{levelShort(value)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="field" style={{ width: 200 }}>
          <span>IPA</span>
          <input value={form.ipa} onChange={(e) => setForm({ ...form, ipa: e.target.value })} />
        </label>
        <label className="field" style={{ width: 170 }}>
          <span>Từ loại</span>
          <input
            value={form.part_of_speech}
            onChange={(e) => setForm({ ...form, part_of_speech: e.target.value })}
            placeholder="noun, verb…"
          />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>
          <span>Ví dụ (Anh)</span>
          <input value={form.example_en} onChange={(e) => setForm({ ...form, example_en: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>
          <span>Ví dụ (Việt)</span>
          <input value={form.example_vi} onChange={(e) => setForm({ ...form, example_vi: e.target.value })} />
        </label>
      </div>
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </form>
  );
}

function MergePanel({ row, onMerged }: { row: TermRow; onMerged: (message: string) => void }) {
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<TermRow[]>([]);
  const [target, setTarget] = useState<TermRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTerms = useCallback(async () => {
    setError(null);
    try {
      const list = await loadTerms({ search, level: null, sort: 'learners', page: 0, pageSize: 8 });
      setCandidates(list.filter((item) => item.id !== row.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tìm được');
    }
  }, [search, row.id]);

  useEffect(() => {
    void searchTerms();
  }, [searchTerms]);

  async function confirmMerge() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mergeTerms(row.id, target.id);
      onMerged(
        `Đã gộp "${result.removed}" vào "${result.kept}": chuyển ${result.words_moved} tiến trình, ` +
          `bỏ ${result.duplicates_removed} bản trùng, ${result.reviews} lượt ôn được giữ.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không gộp được');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ margin: '8px 0' }}>
      <h3>Gộp từ trùng</h3>
      <p className="muted small">
        Chọn bản ghi trùng để gộp <strong>vào “{row.term}”</strong>. Tiến trình, album và lịch sử ôn của
        người học được chuyển sang bản giữ lại; nếu một người đã có cả hai, bản trùng bị bỏ.
      </p>

      <div className="row" style={{ marginTop: 8 }}>
        <input
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Tìm bản ghi trùng…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Từ</th>
              <th>Nghĩa</th>
              <th className="num">Người học</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {candidates.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.term}
                  <div className="muted small mono">{shortId(item.id)}</div>
                </td>
                <td>{item.meaning_vi ?? '—'}</td>
                <td className="num">{num(Number(item.learners))}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className={`btn small-btn ${target?.id === item.id ? 'primary' : ''}`}
                    onClick={() => setTarget(target?.id === item.id ? null : item)}
                  >
                    {target?.id === item.id ? 'Đang chọn' : 'Chọn'}
                  </button>
                </td>
              </tr>
            ))}
            {candidates.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 12 }}>Không có bản ghi nào khớp.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {target && (
        <div className="note" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>
            Gộp <strong>{target.term}</strong> ({num(Number(target.learners))} người học) vào{' '}
            <strong>{row.term}</strong> ({num(Number(row.learners))} người học)? Không hoàn tác được.
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn danger" onClick={() => void confirmMerge()} disabled={busy}>
              {busy ? 'Đang gộp…' : 'Gộp'}
            </button>
            <button className="btn ghost" onClick={() => setTarget(null)} disabled={busy}>Huỷ</button>
          </div>
        </div>
      )}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
